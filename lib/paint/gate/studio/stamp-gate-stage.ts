// stamp-gate-stage.ts: a wet stage run alone for the GPU gate's page (stamp-gate-page.ts), over a layer and wet field
// the gate writes (stamp-gate-flow.ts, stamp-gate-stripe.ts) on a device of its own, the layer read back around it.

import { stampMixedPainting, type CompiledStampDeposit, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { stampPaintMedia, type StampWetness } from '#lib/paint/painting/models/stamp-wetness.ts';
import { compileStampWetness } from '#lib/paint/painting/models/stamp-wash-waits.ts';
import { stampRoundTipsOf } from '#lib/paint/painting/models/stamp-tip-support.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { requestStudioGpuDevice } from '#lib/platform/gpu/studio/gpu-device-owner.ts';
import { stampWashMovedWgsl } from '#lib/paint/painting/studio/stamp-paint-pigment-compositor.ts';
import type { StampWetBank, StampWetDepositMoment, StampWetStageContext } from '#lib/paint/painting/studio/stamp-wet-stages.ts';
import { putStampWetLand, STAMP_WET_FIELD_FORMATS, STAMP_WET_LAND, stampWetField, stampWetScales } from '#lib/paint/painting/studio/stamp-wet-field.ts';
import { gpuHalfBits, gpuHalfValue } from '#lib/platform/gpu/models/gpu-half-float.ts';

const STAMP_GATE_FLOW_HOLD_WGSL = /* wgsl */ `
fn washHold(l: u32, at: vec2f, tooth: vec2f, depth: f32, held: vec4f, wrap: vec2f) -> vec4f {
  return vec4f(1.0 + 0.6 * sin(0.9 * at.x) * cos(0.7 * at.y));
}`;

/**
 * A layer the gate writes for a stage run alone: its array layers, the fresh paint's (flow's), the footprint, and the
 * wash's wet field as the stage finds it (stamp-wet-field.ts), the oracle the renderer's field is held to elsewhere.
 */
export type StampGateWritten = {
  width: number; height: number; layer: readonly Float32Array[]; fresh?: readonly Float32Array[]; footprint: Float32Array; field: { paper: Float32Array; rim: Float32Array };
};

/**
 * What a gate stage runs with: the stage context over the case, the painting as one bank whose every box is the whole
 * case, and `land`, which lands a deposit's water (whole, as its stamps all shown) in the field's landing.
 */
export type StampGateStageRun = {
  context: StampWetStageContext; bank: StampWetBank; wetness: StampWetness;
  land: (encoder: GPUCommandEncoder, deposit: CompiledStampDeposit) => StampWetDepositMoment;
};

/** `written` on a device of its own, `run` given the stage over it and an encoder; the layer read back before and after. */
export async function runStampGateStage(
  id: string, painting: CompiledStampPaint, medium: PaintMedium, written: StampGateWritten,
  run: (stage: StampGateStageRun, encoder: GPUCommandEncoder) => void,
): Promise<{ before: Float32Array; after: Float32Array }> {
  const { width, height } = written, layers = written.layer.length, stage = stampStage({ width, height });
  const wetness = compileStampWetness(painting, stampPaintMedia(stampMixedPainting(painting), () => medium), stampRoundTipsOf());
  const device = await requestStudioGpuDevice();
  try {
    const texture = (count: number, arrays: readonly Float32Array[]) => {
      const made = device.createTexture({ size: [width, height, count], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
      arrays.forEach((values, l) => device.queue.writeTexture({ texture: made, origin: [0, 0, l] }, Uint16Array.from(values, gpuHalfBits), { bytesPerRow: width * 8, rowsPerImage: height }, [width, height, 1]));
      return made;
    };
    const arrayViews = (made: GPUTexture) => ({
      texture: made, view: made.createView({ dimension: '2d-array' }),
      layers: Array.from({ length: layers }, (_, l) => made.createView({ dimension: '2d', baseArrayLayer: l, arrayLayerCount: 1 })),
    });
    const layer = texture(layers, written.layer), footprint = texture(1, [written.footprint]);
    const read = async () => {
      const buffer = device.createBuffer({ size: width * 8 * height * layers, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: layer }, { buffer, bytesPerRow: width * 8, rowsPerImage: height }, [width, height, layers]);
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      return Float32Array.from(new Uint16Array(buffer.getMappedRange().slice(0)), gpuHalfValue);
    };
    const fieldTexture = (format: GPUTextureFormat, values: Float32Array | null) => {
      const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST;
      const made = device.createTexture({ size: [width, height], format, usage }), half = format === 'rgba16float';
      if (values) device.queue.writeTexture({ texture: made }, half ? Uint16Array.from(values, gpuHalfBits) : values, { bytesPerRow: width * (half ? 8 : 16) }, [width, height]);
      return { texture: made, view: made.createView() };
    };
    const blank = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
    const field = stampWetField(device, stage, {
      paper: fieldTexture(STAMP_WET_FIELD_FORMATS.paper, written.field.paper), rim: fieldTexture(STAMP_WET_FIELD_FORMATS.rim, written.field.rim),
      landing: fieldTexture(STAMP_WET_FIELD_FORMATS.landing, null), scale: fieldTexture(STAMP_WET_FIELD_FORMATS.scale, null),
    }, blank.createView());
    device.pushErrorScope('validation');
    const whole = { x: 0, y: 0, w: width, h: height };
    // The case's footprint stands for a stamp laid whole: what it laid is where it touched.
    const footprintView = footprint.createView({ dimension: '2d' });
    const context: StampWetStageContext = {
      device, stage, layer: arrayViews(layer),
      // A hold rippling across the case, so paint is held to its sums however unevenly the paper takes it.
      wash: { layersOf: () => layers, movedWgsl: () => stampWashMovedWgsl(layers, medium.body), holdWgsl: () => STAMP_GATE_FLOW_HOLD_WGSL },
      footprint: { texture: footprint, view: footprintView },
      fresh: arrayViews(texture(layers, written.fresh ?? written.layer.map((values) => new Float32Array(values.length)))),
      field: field.views,
    };
    const bank: StampWetBank = { device, landings: wetness.landings, dryings: [...wetness.washes.values()].flatMap(({ dryings }) => dryings), boxOf: () => whole, wallOf: () => null };
    const scales = stampWetScales(device, wetness.landings.keys());
    const land = (encoder: GPUCommandEncoder, deposit: CompiledStampDeposit): StampWetDepositMoment => {
      const landing = wetness.landings.get(deposit)!;
      const uniform = device.createBuffer({ size: STAMP_WET_LAND.words * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), words = new ArrayBuffer(STAMP_WET_LAND.words * 4);
      putStampWetLand({ floats: new Float32Array(words), ints: new Int32Array(words), words: new Uint32Array(words) }, { deposit, landing, box: whole, found: whole, scale: scales.of(deposit) });
      device.queue.writeBuffer(uniform, 0, words);
      const landed = encoder.beginComputePass();
      field.land(landed, { buffer: uniform }, scales.buffer, footprintView, footprintView, whole, true);
      landed.end();
      return { deposit, landing, box: whole, seed: 0, paperDepth: 0 };
    };
    const before = await read();
    const encoder = device.createCommandEncoder();
    run({ context, bank, wetness, land }, encoder);
    device.queue.submit([encoder.finish()]);
    const error = await device.popErrorScope();
    if (error) throw new Error(`stamp gate: ${id}: ${error.message}`);
    return { before, after: await read() };
  } finally {
    device.destroy();
  }
}

// stamp-gate-page.ts: the GPU gate's browser side, run by engine/stamp-gate.ts through withBrowserModulePage. It runs
// the formula grids (stamp-gate-formulas.ts) on the renderer's own WGSL, paints the gate's paintings
// (stamp-gate-paintings.ts) with the studio's renderer, holds a traced resolve to the frame it draws, and paints each
// wash case, reading its layer back for the properties it's held to (stamp-gate-washes.ts, stamp-gate-water-marks.ts),
// animates the animation cases (stamp-gate-animation.ts) and runs the flow, bloom and rim stages alone over layers it writes
// (stamp-gate-flow.ts, stamp-gate-stripe.ts), and draws the region cases (stamp-gate-regions.ts). Paintings are built
// here, as a compiled painting's typed arrays don't survive the trip from Node.

import { PAINT_KUBELKA_MUNK_WGSL } from '#lib/paint/materials/models/paint-kubelka-munk.ts';
import { PAINT_PAPER_WGSL } from '#lib/paint/materials/models/paint-paper.ts';
import { COVERAGE_FORMULAS_WGSL } from '#lib/paint/brush/models/coverage-formulas.ts';
import { STAMP_ACCUMULATION_LAY_WGSL, STAMP_ACCUMULATION_RESOLVE_WGSL } from '#lib/paint/painting/models/stamp-deposit-stages.ts';
import { STAMP_PAINT_FIELD_SHARE } from '#lib/paint/painting/models/stamp-paint-field.ts';
import { stampPassDeposits, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { STAMP_WET_LAND_WGSL } from '#lib/paint/painting/models/stamp-wet-landing.ts';
import { STAMP_WET_LIFT_WGSL } from '#lib/paint/painting/models/stamp-wet-lift.ts';
import { STAMP_WET_BLOOM_WGSL } from '#lib/paint/painting/models/stamp-wet-bloom.ts';
import { STAMP_DRYING_RIM_WGSL } from '#lib/paint/painting/models/stamp-wet-rim.ts';
import { STAMP_TIP_TOUCH_WGSL } from '#lib/paint/painting/models/stamp-wet-contact.ts';
import { STAMP_GRID_AT_WGSL, STAMP_POLYGON_DISTANCE_WGSL, STAMP_REGION_WGSL } from '#lib/paint/painting/models/stamp-region.ts';
import { STAMP_AREA_COVERAGE_WGSL } from '#lib/paint/painting/models/stamp-area.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { STAMP_LANDED_WETNESS_WGSL, STAMP_WET_PAPER_WGSL, stampPaintMedia } from '#lib/paint/painting/models/stamp-wetness.ts';
import { compileStampWetness } from '#lib/paint/painting/models/stamp-wash-waits.ts';
import { stampRoundTipsOf } from '#lib/paint/painting/models/stamp-tip-support.ts';
import { requestStudioGpuDevice } from '#lib/platform/gpu/studio/gpu-device-owner.ts';
import { STAMP_WET_FLOW_STAGE } from '#lib/paint/painting/studio/stamp-wet-flow.ts';
import { STAMP_BLOOM_STAGE } from '#lib/paint/painting/studio/stamp-wet-bloom.ts';
import { STAMP_DRYING_RIM_STAGE } from '#lib/paint/painting/studio/stamp-wet-rim.ts';
import { STAMP_WET_STAGES } from '#lib/paint/painting/studio/stamp-wet-stage-list.ts';
import { planStampWetStage } from '#lib/paint/painting/studio/stamp-wet-stages.ts';
import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { StampBrush, StampBrushAsset } from '#lib/paint/brush/models/stamp-brush.ts';
import type { StampBrushProbeMedium } from '#lib/paint/brush-packs/models/stamp-brush-profile-probes.ts';
import { stampPaintPackAssetUrl, type StampPaintPackUrls } from '#lib/paint/brush-packs/models/stamp-paint-pack-urls.ts';
import { createStampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { createStampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { checkStampGateHalfPixel, stampGateHalfPixelPainting } from '#lib/paint/gate/models/stamp-gate-half-pixel.ts';
import { STAMP_GATE_BEND, stampGateBendPainting } from '#lib/paint/gate/models/stamp-gate-bend.ts';
import { checkStampGateLive, STAMP_GATE_LIVE_POSE, stampGateLivePainting, stampGateLiveState } from '#lib/paint/gate/models/stamp-gate-live.ts';
import { checkStampGateMedia, STAMP_GATE_MEDIA_GROUPS, STAMP_GATE_MEDIA_IDS, stampGateMediaPainting } from '#lib/paint/gate/models/stamp-gate-media.ts';
import {
  checkStampGateBloomBoil, checkStampGateBoil, checkStampGateBoilWash, checkStampGateCutOut, checkStampGateDrift, checkStampGateWarp, checkStampGateEffectsSunset, checkStampGateKnockout, checkStampGateLent,
  checkStampGateRecolour, checkStampGateRepaint, checkStampGateSunset, STAMP_GATE_ANIMATION_FPS, STAMP_GATE_ANIMATION_IDS, STAMP_GATE_DRIFT_FRAMES, STAMP_GATE_EFFECTS_SUNSET_HOURS,
  STAMP_GATE_KNOCKOUT_FAR, STAMP_GATE_RECOLOUR_KEYS, stampGateBloomBoilPainting, stampGateBoilPainting, stampGateBoilWashPainting, stampGateCutOutPainting, stampGateDriftPainting,
  stampGateEffectsSunsetPainting, stampGateKnockoutPainting, stampGateRecolourPainting,
  stampGateSunsetPainting,
} from '../models/stamp-gate-animation.ts';
import {
  checkStampGateFlow, STAMP_GATE_FLOW_SIZE, stampGateFlowCase, stampGateFlowField, stampGateFlowLayer, stampGateFlowPainting,
} from '../models/stamp-gate-flow.ts';
import { stampGatePrivatePainting, type StampGatePrivateCase } from '../models/stamp-gate-private-cases.ts';
import { drawn, drawnImages, gateRenderer, withGateRenderer, withGateSurface } from './stamp-gate-page-surface.ts';
import { checkStampGateStageCase, checkStampGateThreeCase } from './stamp-gate-stage-page.ts';
import { checkStampGateRegion, stampGateRegionPaintings, type StampGateRegionId } from '../models/stamp-gate-regions.ts';
import { checkStampGateContact, STAMP_GATE_CONTACT_IDS, stampGateContactPainting } from '../models/stamp-gate-contact.ts';
import { checkStampGateMask, stampGateMaskPaintings, type StampGateMaskId } from '../models/stamp-gate-masks.ts';
import {
  checkStampGateRimStrength, checkStampGateStripe, STAMP_GATE_RIM_STRENGTHS, STAMP_GATE_STRIPE_SIZE, stampGateStripeCase, stampGateStripeField, stampGateStripeLayer, stampGateStripePainting,
} from '../models/stamp-gate-stripe.ts';
import { stampGateFrameDifference, stampGateFramePasses, type StampGateFrameDifference } from '../models/stamp-gate-frames.ts';
import { runStampGateStage } from './stamp-gate-stage.ts';
import { checkStampGateFenced, checkStampGateLifted, checkStampGateSet, checkStampGateSpread, stampGateLastGroupPigments, stampGateWashCase } from '../models/stamp-gate-washes.ts';
import {
  checkStampGateBloomed, checkStampGateLipped, checkStampGateRimmed, checkStampGateUnlined, checkStampGateUnlipped, checkStampGateUnrimmed,
} from '../models/stamp-gate-water-marks.ts';
import { checkStampGateConserved, type StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { stampGatePainting, stampGateTracePainting, type StampGatePainting } from '../models/stamp-gate-paintings.ts';

const WORKGROUP = 64;

/** A formula grid as the page is handed it: its call, row width and rows, and the storage its call reads. */
type PageGrid = { call: string; width: number; rows: number[]; points?: number[]; grid?: number[]; boundaries?: number[] };

const kernel = ({ call, width, points, grid }: PageGrid) => /* wgsl */ `
${COVERAGE_FORMULAS_WGSL}
${PAINT_KUBELKA_MUNK_WGSL}
${PAINT_PAPER_WGSL}
${STAMP_ACCUMULATION_LAY_WGSL}
${STAMP_ACCUMULATION_RESOLVE_WGSL}
${STAMP_REGION_WGSL}
${STAMP_PAINT_FIELD_SHARE.wgsl}
${STAMP_WET_LAND_WGSL}
${STAMP_WET_LIFT_WGSL}
${STAMP_TIP_TOUCH_WGSL}
${STAMP_LANDED_WETNESS_WGSL}
${STAMP_WET_PAPER_WGSL}
${STAMP_WET_BLOOM_WGSL}
${STAMP_DRYING_RIM_WGSL}
@group(0) @binding(0) var<storage, read> inputs: array<f32>;
@group(0) @binding(1) var<storage, read_write> outputs: array<f32>;
${points ? `@group(0) @binding(2) var<storage, read> points: array<vec2f>;\n@group(0) @binding(4) var<storage, read> boundaries: array<vec4f>;\n${STAMP_POLYGON_DISTANCE_WGSL}\n${STAMP_AREA_COVERAGE_WGSL}` : ''}
${grid ? `@group(0) @binding(3) var<storage, read> grid: array<f32>;\n${STAMP_GRID_AT_WGSL}` : ''}
var<private> row: u32;
fn x(i: u32) -> f32 { return inputs[row * ${width}u + i]; }
@compute @workgroup_size(${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&outputs)) { return; }
  row = id.x;
  outputs[id.x] = ${call};
}`;

/** Each grid's results, row by row, from the GPU. */
async function runStampGateFormulas(grids: readonly PageGrid[]): Promise<number[][]> {
  const device = await requestStudioGpuDevice();
  try {
    device.pushErrorScope('validation');
    const storage = (values: readonly number[]) => {
      const buffer = device.createBuffer({ size: Math.max(16, values.length * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buffer, 0, new Float32Array(values));
      return buffer;
    };
    const results = await Promise.all(grids.map(async (grid) => {
      const count = grid.rows.length / grid.width;
      const output = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const read = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: kernel(grid) }) } });
      // Only what the call reads is in the automatic layout, so only that is bound.
      const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: storage(grid.rows) } }, { binding: 1, resource: { buffer: output } }];
      if (grid.points) entries.push({ binding: 2, resource: { buffer: storage(grid.points) } });
      if (grid.grid) entries.push({ binding: 3, resource: { buffer: storage(grid.grid) } });
      if (grid.boundaries) entries.push({ binding: 4, resource: { buffer: storage(grid.boundaries) } });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }));
      pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP));
      pass.end();
      encoder.copyBufferToBuffer(output, 0, read, 0, count * 4);
      device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      return Array.from(new Float32Array(read.getMappedRange()));
    }));
    const error = await device.popErrorScope();
    if (error) throw new Error(`stamp gate formulas: ${error.message}`);
    return results;
  } finally {
    device.destroy();
  }
}

/** `gate` drawn at its time: its frame as RGB bytes, row by row, in base64. */
function paintedFrame(gate: Omit<StampGatePainting, 'images'>, url: (asset: StampBrushAsset) => string): Promise<string> {
  return withGateRenderer(gate, url, async (renderer, frame) => {
    await renderer.draw({ kind: 'once', t: gate.t, state: gate.frameAt?.(gate.t) });
    await renderer.finish();
    const rgba = frame(), rgb = new Uint8Array(gate.width * gate.height * 3);
    for (let i = 0; i < gate.width * gate.height; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
    let binary = '';
    for (let i = 0; i < rgb.length; i += 0x8000) binary += String.fromCharCode(...rgb.subarray(i, i + 0x8000));
    return btoa(binary);
  });
}

/** `texture`'s rgba8unorm pixels, row by row without padding. */
async function readGateTexture(device: GPUDevice, texture: GPUTexture): Promise<Uint8ClampedArray> {
  const { width, height } = texture, row = Math.ceil((width * 4) / 256) * 256;
  const buffer = device.createBuffer({ size: row * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: row }, [width, height]);
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const padded = new Uint8Array(buffer.getMappedRange()), rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) rgba.set(padded.subarray(y * row, y * row + width * 4), y * width * 4);
  buffer.destroy();
  return rgba;
}

/** The gate painting `id`, as paintedFrame gives it. */
function paintStampGate(id: string): Promise<string> {
  const gate = stampGatePainting(id);
  return paintedFrame(gate, drawnImages(gate));
}

/** A private case of a pack's `brush` in its style's `medium`, their images at `packUrls`, as paintedFrame gives it. */
function paintStampGatePrivate(brush: StampBrush, packUrls: StampPaintPackUrls, privateCase: StampGatePrivateCase, medium: StampBrushProbeMedium): Promise<string> {
  return paintedFrame(stampGatePrivatePainting(brush, privateCase, medium), (asset) => stampPaintPackAssetUrl(packUrls, asset));
}

/**
 * The trace painting traced, then drawn as usual on the same renderer: how far the traced coverage sits from the
 * traced frame, how far the traced frame sits from the ordinary one (it must be the same draw), and each deposit's
 * stage order.
 */
async function traceStampGate(): Promise<{ worst: number; mean: number; ordinary: StampGateFrameDifference; orders: string[] }> {
  const gate = stampGateTracePainting();
  const { width, height } = gate;
  return withGateRenderer(gate, drawnImages(gate), async (renderer, frame) => {
    const deposits = gate.painting.groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass)));
    const traces = await renderer.trace({ kind: 'once', t: gate.t }, deposits.map((deposit) => ({ deposit, crop: { x: 0, y: 0, w: width, h: height } })));
    await renderer.finish();
    const traced = frame();
    await renderer.draw({ kind: 'once', t: gate.t });
    await renderer.finish();
    const ordinary = stampGateFrameDifference(traced, frame());
    let worst = 0, sum = 0;
    for (let i = 0; i < width * height; i++) {
      // The strokes lie apart, so at most one covers a pixel; black on white, its darkness is that coverage.
      const coverage = 1 - traces.reduce((kept, trace) => kept * (1 - trace.coverage[i]), 1);
      const difference = Math.abs(coverage * 255 - (255 - traced[i * 4]));
      worst = Math.max(worst, difference);
      sum += difference;
    }
    return { worst, mean: sum / (width * height), ordinary, orders: traces.map((trace) => trace.stages.map(({ stage }) => stage).join(',')) };
  });
}

/**
 * Wash case `id`: its frame the same drawn twice, and, against the same painting without the ops under
 * test, its pigment conserved or its lift bounded, read from the last group's layer at its end.
 */
async function checkStampGateWash(id: string): Promise<StampGateWashCheck[]> {
  const washCase = stampGateWashCase(id), { subject } = washCase, url = drawnImages(subject);
  const end = subject.t;
  const painted = await withGateRenderer(subject, url, async (renderer, frame) => ({
    end: await drawn(renderer, frame, end), again: await drawn(renderer, frame, end), layer: await renderer.readLayer({ kind: 'once', t: end }),
  }));
  const ends = stampGateFrameDifference(painted.end, painted.again);
  const checks: StampGateWashCheck[] = [{
    id: `${id}: drawn again`, passed: stampGateFramePasses(ends),
    detail: `its end drawn again: max ${ends.max}, mean ${ends.mean.toFixed(4)}`,
  }];
  if (washCase.property === 'drawn') return checks;
  if (washCase.property === 'frame') return [...checks, washCase.read(painted.end)];
  const pigments = stampGateLastGroupPigments(subject);
  if (washCase.property === 'fenced') return [...checks, checkStampGateFenced(id, pigments, painted.layer, washCase.fenced)];
  if (washCase.property === 'unlined') {
    const withoutBlooms = await withGateRenderer(subject, url, (renderer) => renderer.readLayer({ kind: 'once', t: end }), { wetStages: STAMP_WET_STAGES.filter((stage) => stage.id !== 'bloom') });
    return [...checks, checkStampGateUnlined(id, pigments, painted.layer, withoutBlooms)];
  }
  if (washCase.property === 'unrimmed') {
    const withoutRim = await withGateRenderer(subject, url, (renderer) => renderer.readLayer({ kind: 'once', t: end }), { wetStages: STAMP_WET_STAGES.filter((stage) => stage.id !== 'drying-rim') });
    return [...checks, checkStampGateUnrimmed(id, pigments, painted.layer, withoutRim)];
  }
  if (stampGateLastGroupPigments(washCase.without).join() !== pigments.join()) throw new Error(`stamp gate: ${id} and its painting without the ops under test lay different pigments`);
  const without = await withGateRenderer(washCase.without, url, (renderer) => renderer.readLayer({ kind: 'once', t: end }));
  if (washCase.property === 'conserved') return [...checks, checkStampGateConserved(id, pigments, painted.layer, without)];
  if (washCase.property === 'rimmed') return [...checks, checkStampGateRimmed(id, pigments, painted.layer, without)];
  if (washCase.property === 'bloomed') return [...checks, checkStampGateBloomed(id, pigments, painted.layer, without)];
  if (washCase.property === 'unlipped') return [...checks, checkStampGateUnlipped(id, pigments, painted.layer, without)];
  if (washCase.property === 'lipped') return [...checks, checkStampGateLipped(id, pigments, painted.layer, without)];
  if (washCase.property === 'spread') return [...checks, checkStampGateSpread(id, pigments, painted.layer, without)];
  if (washCase.property === 'set') {
    const layerOf = (gate: StampGatePainting) => withGateRenderer(gate, drawnImages(gate), (renderer) => renderer.readLayer({ kind: 'once', t: end }));
    const wet = { subject: await layerOf(washCase.fresh.subject), without: await layerOf(washCase.fresh.without) };
    return [...checks, checkStampGateSet(id, pigments, washCase.rewetting, { subject: painted.layer, without }, wet)];
  }
  return [...checks, checkStampGateLifted(id, pigments, washCase.pigments, painted.layer, without)];
}

/** Frame `k`'s time at the animations' frame rate. */
const frameAt = (k: number) => k / STAMP_GATE_ANIMATION_FPS;
/** Each deposit's traced coverage of `gate` at its time, on a renderer of its own. */
const tracedCoverages = (gate: StampGatePainting) => withGateRenderer(gate, drawnImages(gate), async (renderer) => {
  const deposits = gate.painting.groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass)));
  const traces = await renderer.trace({ kind: 'once', t: gate.t }, deposits.map((deposit) => ({ deposit, crop: { x: 0, y: 0, w: gate.width, h: gate.height } })));
  return traces.map((trace) => trace.coverage);
});
/** The coverage channel of `gate`'s last group's layer at its time, drawn with `stages`. */
async function lastLayerCoverage(gate: StampGatePainting, stages = STAMP_WET_STAGES) {
  const { layers, values } = await withGateRenderer(gate, drawnImages(gate), (renderer) => renderer.readLayer({ kind: 'once', t: gate.t }), { wetStages: stages });
  return Float32Array.from({ length: values.length / 4 / layers }, (_, i) => values[i * 4]);
}
/** `gate`'s frame at its time, on a renderer of its own. */
const frameAtItsTime = (gate: StampGatePainting) => withGateRenderer(gate, drawnImages(gate), (renderer, frame) => drawn(renderer, frame, gate.t));
/** `gate`'s first frame, in its frame state then, on a renderer of its own. */
const firstFrame = (gate: StampGatePainting) => withGateRenderer(gate, drawnImages(gate), (renderer, frame) => drawn(renderer, frame, 0, gate.frameAt?.(0)));

/** Animation case `id` (stamp-gate-animation.ts), drawn frame by frame on one renderer and held to its property. */
async function checkStampGateAnimation(id: string): Promise<StampGateWashCheck> {
  if (id === 'animation/drift') {
    const gate = stampGateDriftPainting();
    const frames = await withGateRenderer(gate, drawnImages(gate), (renderer, frame) => STAMP_GATE_DRIFT_FRAMES.reduce<Promise<{ frame: number; rgba: Uint8ClampedArray }[]>>(
      async (done, k) => [...await done, { frame: k, rgba: await drawn(renderer, frame, frameAt(k)) }], Promise.resolve([])));
    return checkStampGateDrift(frames, gate.width);
  }
  if (id === 'animation/boil') {
    const gate = stampGateBoilPainting();
    return withGateRenderer(gate, drawnImages(gate), async (renderer, frame) => {
      const frames = await [0, 1, 2, 3, 4, 5].reduce<Promise<Uint8ClampedArray[]>>(async (done, k) => [...await done, await drawn(renderer, frame, frameAt(k))], Promise.resolve([]));
      return checkStampGateBoil(frames, await drawn(renderer, frame, 0), gate.width, gate.height);
    });
  }
  if (id === 'animation/boil-wash') {
    const gate = stampGateBoilWashPainting();
    return withGateRenderer(gate, drawnImages(gate), async (renderer, frame) => checkStampGateBoilWash(
      await [0, 2, 4].reduce<Promise<Uint8ClampedArray[]>>(async (done, k) => [...await done, await drawn(renderer, frame, frameAt(k))], Promise.resolve([]))));
  }
  if (id === 'animation/bloom-boil') {
    const gate = stampGateBloomBoilPainting();
    return withGateRenderer(gate, drawnImages(gate), async (renderer, frame) => checkStampGateBloomBoil(
      await [0, 1, 2].reduce<Promise<Uint8ClampedArray[]>>(async (done, k) => [...await done, await drawn(renderer, frame, frameAt(k))], Promise.resolve([]))));
  }
  if (id === 'animation/sunset') {
    return checkStampGateSunset(await tracedCoverages(stampGateSunsetPainting('day')), await tracedCoverages(stampGateSunsetPainting('dusk')));
  }
  if (id === 'animation/effects-sunset') {
    const effectless = STAMP_WET_STAGES.filter((stage) => stage.id !== 'bloom' && stage.id !== 'drying-rim');
    const hours = await STAMP_GATE_EFFECTS_SUNSET_HOURS.reduce<Promise<{ on: Float32Array; off: Float32Array }[]>>(async (done, hour) => {
      const before = await done, gate = stampGateEffectsSunsetPainting(hour);
      return [...before, { on: await lastLayerCoverage(gate), off: await lastLayerCoverage(gate, effectless) }];
    }, Promise.resolve([]));
    return checkStampGateEffectsSunset(hours);
  }
  if (id === 'animation/recolour') {
    const [from, to] = STAMP_GATE_RECOLOUR_KEYS, middle = (from + to) / 2;
    const still = stampGateRecolourPainting('halfway'), keyed = stampGateRecolourPainting('keyed');
    const stillFrame = await withGateRenderer(still, drawnImages(still), (renderer, frame) => drawn(renderer, frame, middle));
    const freshEnd = await withGateRenderer(keyed, drawnImages(keyed), (renderer, frame) => drawn(renderer, frame, to));
    return withGateRenderer(keyed, drawnImages(keyed), async (renderer, frame) => {
      const halfway = await drawn(renderer, frame, middle), end = await drawn(renderer, frame, to);
      return checkStampGateRecolour({
        still: stillFrame, halfway, freshEnd, end, halfwayAgain: await drawn(renderer, frame, middle), past: await drawn(renderer, frame, to + 2),
      });
    });
  }
  const drift = (gate: StampGatePainting) => withGateRenderer(gate, drawnImages(gate), async (renderer, frame) => {
    const frames = await STAMP_GATE_DRIFT_FRAMES.reduce<Promise<{ frame: number; rgba: Uint8ClampedArray }[]>>(
      async (done, k) => [...await done, { frame: k, rgba: await drawn(renderer, frame, frameAt(k), gate.frameAt?.(frameAt(k))) }], Promise.resolve([]));
    return { frames, again: await drawn(renderer, frame, 0, gate.frameAt?.(0)) };
  });
  if (id === 'animation/cut-out') {
    const own = stampGateCutOutPainting('own');
    return checkStampGateCutOut({ own: await drift(own), ground: await drift(stampGateCutOutPainting('ground')), width: own.width });
  }
  if (id === 'animation/warp') {
    const own = stampGateCutOutPainting('own', 'warp');
    const unbent = await (['own', 'ground'] as const).reduce<Promise<{ warped: Uint8ClampedArray; still: Uint8ClampedArray }[]>>(async (done, paper) => [
      ...await done, { warped: await firstFrame(stampGateCutOutPainting(paper, 'still-warp')), still: await firstFrame(stampGateCutOutPainting(paper, 'still')) },
    ], Promise.resolve([]));
    // The bend and the other bend on one renderer, the other's lattice and films warm under another key; then fresh.
    const bend = stampGateBendPainting(STAMP_GATE_BEND.shift), other = stampGateBendPainting(-STAMP_GATE_BEND.shift);
    const bent = await withGateRenderer(bend, drawnImages(bend), async (renderer, frame) => {
      const atFirst = await drawn(renderer, frame, 0, bend.frameAt?.(0)), cached = await drawn(renderer, frame, 0, other.frameAt?.(0));
      return { bent: atFirst, cached, again: await drawn(renderer, frame, 0, bend.frameAt?.(0)) };
    });
    const bendCheck = { still: await firstFrame(stampGateBendPainting(null)), bent: bent.bent, other: { cached: bent.cached, cold: await firstFrame(other) }, again: bent.again };
    return checkStampGateWarp({ own: await drift(own), ground: await drift(stampGateCutOutPainting('ground', 'warp')), unbent, bend: bendCheck, width: own.width });
  }
  if (id === 'animation/half-pixel') {
    return checkStampGateHalfPixel({ still: await firstFrame(stampGateHalfPixelPainting(false)), shifted: await firstFrame(stampGateHalfPixelPainting(true)) });
  }
  if (id === 'animation/live') {
    // The rest frame first, so the live frame lays the sky from the film the painting as written kept.
    const rest = stampGateLivePainting();
    const frames = await withGateRenderer(rest, drawnImages(rest), async (renderer, frame) => {
      const atRest = await drawn(renderer, frame, 0), live = await drawn(renderer, frame, 0, stampGateLiveState());
      // The same key again lays the live group from the film it kept.
      const held = await drawn(renderer, frame, 0, stampGateLiveState());
      return { rest: atRest, live, held, again: await drawn(renderer, frame, 0) };
    });
    return checkStampGateLive({ ...frames, posed: await firstFrame(stampGateLivePainting(STAMP_GATE_LIVE_POSE)) });
  }
  if (id === 'animation/knockout') {
    const knockout = stampGateKnockoutPainting();
    const { first: drawnFirst, far, again } = await withGateRenderer(knockout, drawnImages(knockout), async (renderer, frame) => {
      const atFirst = await drawn(renderer, frame, 0), atFar = await drawn(renderer, frame, frameAt(STAMP_GATE_KNOCKOUT_FAR));
      return { first: atFirst, far: atFar, again: await drawn(renderer, frame, 0) };
    });
    return checkStampGateKnockout({
      first: drawnFirst, far, again, sky: await firstFrame(stampGateKnockoutPainting({ knockout: false })), bare: await firstFrame(stampGateKnockoutPainting({ sky: false, knockout: false })),
      painted: await firstFrame(stampGateKnockoutPainting({ painted: true })),
    });
  }
  if (id === 'animation/repaint') {
    // The bloom-boil leaves a wash's footprint, its bloom and rim scratch and a layer of paint in the shared targets.
    const first = stampGateBloomBoilPainting(), then = stampGateDriftPainting();
    const fresh = await withGateRenderer(then, drawnImages(then), (renderer, frame) => drawn(renderer, frame, frameAt(2)));
    return withGateSurface(then, drawnImages(then), async (surface, frame) => {
      const before = await gateRenderer(first, surface);
      await drawn(before, frame, frameAt(1));
      before.dispose();
      return checkStampGateRepaint(fresh, await drawn(await gateRenderer(then, surface), frame, frameAt(2)));
    });
  }
  if (id === 'animation/lent') {
    const gate = stampGateDriftPainting(), url = drawnImages(gate), { width, height } = gate;
    const onCanvas = await withGateRenderer(gate, url, (renderer, frame) => drawn(renderer, frame, frameAt(2)));
    const owner = await createStampPaintGpuOwner(url), { webgpu } = owner;
    try {
      const texture = (format: GPUTextureFormat) => webgpu.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const refusesSrgb = await createStampPaintSurface(owner, { frame: texture('rgba8unorm-srgb') }).then(() => false, () => true);
      const frame = texture('rgba8unorm');
      const surface = await createStampPaintSurface(owner, { frame });
      const renderer = await gateRenderer(gate, surface);
      await renderer.draw({ kind: 'once', t: frameAt(2) });
      const lent = await readGateTexture(webgpu, frame);
      surface.dispose();
      // An error scope the surface left open would catch this one's error, and the pop below would report none.
      webgpu.pushErrorScope('validation');
      webgpu.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: 0 });
      const caught = await webgpu.popErrorScope();
      return checkStampGateLent({ onCanvas, lent, refusesSrgb, scopesBalanced: caught !== null });
    } finally {
      owner.dispose();
    }
  }
  throw new Error(`stamp gate: no animation case ${JSON.stringify(id)}; the gate animates ${STAMP_GATE_ANIMATION_IDS.join(', ')}`);
}

/** Flow case `id` (stamp-gate-flow.ts): the flow stage run once after its fresh deposit over the layer written. */
async function checkStampGateFlowCase(id: string): Promise<StampGateWashCheck> {
  const { medium: name, kind } = stampGateFlowCase(id), medium = PAINT_MEDIA[name];
  const painting = stampGateFlowPainting(kind), pass = painting.groups[0].passes[0], deposit = stampPassDeposits(pass)[1];
  const { before, after } = await runStampGateStage(id, painting, medium, { ...STAMP_GATE_FLOW_SIZE, ...stampGateFlowLayer(kind), field: stampGateFlowField() }, ({ context, bank, land }, encoder) => {
    planStampWetStage(STAMP_WET_FLOW_STAGE.load(context), bank).encode(encoder, land(encoder, deposit));
  });
  return checkStampGateFlow(id, before, after);
}

/** The stripe's wet field (stampGateStripeField), each patch wet from its flood's painting second in `medium`. */
function stripeField(painting: CompiledStampPaint, medium: PaintMedium) {
  const wetness = compileStampWetness(painting, stampPaintMedia(painting, () => medium), stampRoundTipsOf());
  const [left, right] = stampPassDeposits(painting.groups[0].passes[0]).filter((deposit) => deposit.kind === 'flood').map((deposit) => wetness.landings.get(deposit)!.tau);
  return stampGateStripeField({ left, right });
}

/**
 * Stripe case `id` (stamp-gate-stripe.ts): the bloom after the drop, or the rim at the wash's one drying, run once
 * over the layer written; or that rim at each strength.
 */
async function checkStampGateStripeCase(id: string): Promise<StampGateWashCheck> {
  const { stage, medium: name } = stampGateStripeCase(id), medium = PAINT_MEDIA[name];
  if (stage === 'rim-strength') {
    const runs = await Promise.all(STAMP_GATE_RIM_STRENGTHS.map(async (rim) => {
      const painting = stampGateStripePainting(rim), pass = painting.groups[0].passes[0];
      let ownsEdges = false;
      const { before, after } = await runStampGateStage(id, painting, medium, { ...STAMP_GATE_STRIPE_SIZE, ...stampGateStripeLayer(), field: stripeField(painting, medium) }, ({ context, bank, wetness }, encoder) => {
        const planned = planStampWetStage(STAMP_DRYING_RIM_STAGE.load(context), bank), [drying] = wetness.washes.get(pass)!.dryings;
        ownsEdges = drying.deposits.every((deposit) => planned.ownsWetEdges?.(deposit) ?? false);
        planned.encode(encoder, { drying, seed: 0 });
      });
      return { rim, before, after, ownsEdges };
    }));
    return checkStampGateRimStrength(id, runs);
  }
  const painting = stampGateStripePainting(), pass = painting.groups[0].passes[0], drop = stampPassDeposits(pass).at(-1)!;
  const { before, after } = await runStampGateStage(id, painting, medium, { ...STAMP_GATE_STRIPE_SIZE, ...stampGateStripeLayer(), field: stripeField(painting, medium) }, ({ context, bank, wetness, land }, encoder) => {
    if (stage === 'rim') {
      planStampWetStage(STAMP_DRYING_RIM_STAGE.load(context), bank).encode(encoder, { drying: wetness.washes.get(pass)!.dryings[0], seed: 0 });
      return;
    }
    planStampWetStage(STAMP_BLOOM_STAGE.load(context), bank).encode(encoder, land(encoder, drop));
  });
  return checkStampGateStripe(id, before, after);
}

/** Region case `id` (stamp-gate-regions.ts): each of its paintings drawn at its time, held to its property. */
async function checkStampGateRegionCase(id: StampGateRegionId): Promise<StampGateWashCheck> {
  const frames = await stampGateRegionPaintings(id).reduce<Promise<Uint8ClampedArray[]>>(async (done, gate) => [
    ...await done, await withGateRenderer(gate, drawnImages(gate), (renderer, frame) => drawn(renderer, frame, gate.t)),
  ], Promise.resolve([]));
  return checkStampGateRegion(id, frames);
}

/** Contact case `id` (stamp-gate-contact.ts): its deposit traced, its coverage held to the touch law cell by cell. */
async function checkStampGateContactCase(id: string): Promise<StampGateWashCheck> {
  const known = STAMP_GATE_CONTACT_IDS.find((candidate) => candidate === id);
  if (!known) throw new Error(`stamp gate: no contact case ${JSON.stringify(id)}; the gate has ${STAMP_GATE_CONTACT_IDS.join(', ')}`);
  const gate = stampGateContactPainting(known), { width, height } = gate;
  return withGateRenderer(gate, drawnImages(gate), async (renderer) => {
    const [deposit] = stampPassDeposits(gate.painting.groups[0].passes[0]);
    const [trace] = await renderer.trace({ kind: 'once', t: gate.t }, [{ deposit, crop: { x: 0, y: 0, w: width, h: height } }]);
    return checkStampGateContact(known, trace.coverage);
  });
}

/** Mask case `id` (stamp-gate-masks.ts): each of its paintings drawn at its time, held to its property. */
async function checkStampGateMaskCase(id: StampGateMaskId): Promise<StampGateWashCheck> {
  const frames = await stampGateMaskPaintings(id).reduce<Promise<Uint8ClampedArray[]>>(async (done, gate) => [
    ...await done, await withGateRenderer(gate, drawnImages(gate), (renderer, frame) => drawn(renderer, frame, gate.t)),
  ], Promise.resolve([]));
  return checkStampGateMask(id, frames);
}

/** Media case `id` (stamp-gate-media.ts): the painting of three media against each group painted alone in its own. */
async function checkStampGateMediaCase(id: string): Promise<StampGateWashCheck[]> {
  if (id !== 'media/mixed') throw new Error(`stamp gate: no media case ${JSON.stringify(id)}; the gate has ${STAMP_GATE_MEDIA_IDS.join(', ')}`);
  return checkStampGateMedia({
    together: await frameAtItsTime(stampGateMediaPainting(STAMP_GATE_MEDIA_GROUPS)),
    alone: { wash: await frameAtItsTime(stampGateMediaPainting(['wash'], { alone: true })), body: await frameAtItsTime(stampGateMediaPainting(['body'], { alone: true })), wax: await frameAtItsTime(stampGateMediaPainting(['wax'], { alone: true })) },
    bare: await frameAtItsTime(stampGateMediaPainting([])),
    glazed: await frameAtItsTime(stampGateMediaPainting(STAMP_GATE_MEDIA_GROUPS, { bodyIn: 'watercolour' })),
  });
}

/** The GPU the gate draws on, as a baseline records it. */
async function stampGateAdapter(): Promise<string> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('stamp gate: no WebGPU adapter');
  const { vendor, architecture, device, description } = adapter.info;
  return [vendor, architecture, device, description].filter(Boolean).join(' ');
}

Object.assign(globalThis, {
  runStampGateFormulas, paintStampGate, paintStampGatePrivate, traceStampGate, checkStampGateWash, checkStampGateAnimation, checkStampGateFlowCase, checkStampGateStripeCase, checkStampGateRegionCase,
  checkStampGateContactCase, checkStampGateMaskCase, checkStampGateMediaCase, checkStampGateThreeCase, checkStampGateStageCase, stampGateAdapter,
});

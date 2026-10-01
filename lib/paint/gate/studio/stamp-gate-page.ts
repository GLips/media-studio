// stamp-gate-page.ts: the GPU gate's browser side, run by engine/stamp-gate.ts through withBrowserModulePage. It runs
// the formula grids (stamp-gate-formulas.ts) on the renderer's own WGSL, paints the gate's paintings
// (stamp-gate-paintings.ts) with the studio's renderer, holds a traced resolve to the frame it draws, and paints each
// wash case, reading its layer back for the properties it's held to (stamp-gate-washes.ts), animates the animation
// cases (stamp-gate-animation.ts) and runs the flow, bloom and rim stages alone over layers it writes
// (stamp-gate-flow.ts, stamp-gate-stripe.ts), and draws the region cases (stamp-gate-regions.ts). Paintings are built
// here, as a compiled painting's typed arrays don't survive the trip from Node.

import { PAINT_KUBELKA_MUNK_WGSL } from '#lib/paint/materials/models/paint-kubelka-munk.ts';
import { PAINT_PAPER_WGSL } from '#lib/paint/materials/models/paint-paper.ts';
import { COVERAGE_FORMULAS_WGSL } from '#lib/paint/brush/models/coverage-formulas.ts';
import { STAMP_ACCUMULATION_LAY_WGSL, STAMP_ACCUMULATION_RESOLVE_WGSL } from '#lib/paint/painting/models/stamp-deposit-stages.ts';
import { STAMP_FLOOD_FRONT_SHARE_WGSL } from '#lib/paint/painting/models/stamp-fill.ts';
import { STAMP_PAINT_FIELD_SHARE } from '#lib/paint/painting/models/stamp-paint-field.ts';
import { stampPassDeposits, type CompiledStampDeposit, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { STAMP_WET_LAND_WGSL } from '#lib/paint/painting/models/stamp-wet-landing.ts';
import { STAMP_WET_LIFT_WGSL } from '#lib/paint/painting/models/stamp-wet-lift.ts';
import { STAMP_GRID_AT_WGSL, STAMP_POLYGON_DISTANCE_WGSL, STAMP_REGION_WGSL } from '#lib/paint/painting/models/stamp-region.ts';
import { STAMP_AREA_COVERAGE_WGSL } from '#lib/paint/painting/models/stamp-area.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { compileStampWetness } from '#lib/paint/painting/models/stamp-wetness.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { createStampPaintDevice } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import { STAMP_WET_FLOW_STAGE } from '#lib/paint/painting/studio/stamp-wet-flow.ts';
import { STAMP_BLOOM_STAGE } from '#lib/paint/painting/studio/stamp-wet-bloom.ts';
import { STAMP_DRYING_RIM_STAGE } from '#lib/paint/painting/studio/stamp-wet-rim.ts';
import { STAMP_WET_STAGES, type StampWetStageContext } from '#lib/paint/painting/studio/stamp-wet-stages.ts';
import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { stampWashMovedWgsl } from '#lib/paint/painting/studio/stamp-paint-pigment-compositor.ts';
import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { createStampPaintRenderer } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { createStampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
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
  checkStampGateFlow, STAMP_GATE_FLOW_SIZE, stampGateFlowCase, stampGateFlowLayer, stampGateFlowPainting, stampGateHalfBits, stampGateHalfValue,
} from '../models/stamp-gate-flow.ts';
import { stampGatePrivatePainting, type StampGatePrivateCase } from '../models/stamp-gate-private-cases.ts';
import { drawn, drawnImages, gateRenderer, withGateRenderer, withGateSurface } from './stamp-gate-page-surface.ts';
import { checkStampGateStageCase } from './stamp-gate-stage-page.ts';
import {
  checkStampGateOutsideLayer, STAMP_GATE_OUTSIDE_IDS, STAMP_GATE_OUTSIDE_SLOT, stampGateOutsideContent, stampGateOutsideKind, stampGateOutsidePainting,
} from '../models/stamp-gate-outside-layer.ts';
import { checkStampGateRegion, stampGateRegionPaintings, type StampGateRegionId } from '../models/stamp-gate-regions.ts';
import {
  checkStampGateRimStrength, checkStampGateStripe, STAMP_GATE_RIM_STRENGTHS, STAMP_GATE_STRIPE_SIZE, stampGateStripeCase, stampGateStripeLayer, stampGateStripePainting,
} from '../models/stamp-gate-stripe.ts';
import { stampGateFrameDifference, stampGateFramePasses, type StampGateFrameDifference } from '../models/stamp-gate-frames.ts';
import {
  checkStampGateBloomed, checkStampGateFenced, checkStampGateRimmed, checkStampGateUnlined, checkStampGateUnrimmed, checkStampGateUnlipped, checkStampGateLipped, checkStampGateLifted, checkStampGateSet, checkStampGateSpread, stampGateLastGroupPigments, stampGateWashCase,
} from '../models/stamp-gate-washes.ts';
import { checkStampGateConserved, type StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { stampGatePainting, stampGateTracePainting, type StampGatePainting } from '../models/stamp-gate-paintings.ts';

const WORKGROUP = 64;

/** A formula grid as the page is handed it: its call, row width and rows, and the storage its call reads. */
type PageGrid = { call: string; width: number; rows: number[]; points?: number[]; grid?: number[] };

const kernel = ({ call, width, points, grid }: PageGrid) => /* wgsl */ `
${COVERAGE_FORMULAS_WGSL}
${PAINT_KUBELKA_MUNK_WGSL}
${PAINT_PAPER_WGSL}
${STAMP_ACCUMULATION_LAY_WGSL}
${STAMP_ACCUMULATION_RESOLVE_WGSL}
${STAMP_REGION_WGSL}
${STAMP_PAINT_FIELD_SHARE.wgsl}
${STAMP_FLOOD_FRONT_SHARE_WGSL}
${STAMP_WET_LAND_WGSL}
${STAMP_WET_LIFT_WGSL}
@group(0) @binding(0) var<storage, read> inputs: array<f32>;
@group(0) @binding(1) var<storage, read_write> outputs: array<f32>;
${points ? `@group(0) @binding(2) var<storage, read> points: array<vec2f>;\n${STAMP_POLYGON_DISTANCE_WGSL}\n${STAMP_AREA_COVERAGE_WGSL}` : ''}
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
  const device = await createStampPaintDevice();
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
function paintedFrame(gate: Omit<StampGatePainting, 'images'>, url: (file: string) => string): Promise<string> {
  return withGateRenderer(gate, url, async (renderer, frame) => {
    await renderer.draw({ t: gate.t, state: gate.frameAt?.(gate.t) });
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

/** A private case of a pack's `brush`, its images under `packUrl`, as paintedFrame gives it. */
function paintStampGatePrivate(brush: StampBrush, packUrl: string, privateCase: StampGatePrivateCase): Promise<string> {
  return paintedFrame(stampGatePrivatePainting(brush, privateCase), (file) => `${packUrl}/${file}`);
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
    const traces = await renderer.trace({ t: gate.t }, deposits.map((deposit) => ({ deposit, crop: { x: 0, y: 0, w: width, h: height } })));
    await renderer.finish();
    const traced = frame();
    await renderer.draw({ t: gate.t });
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
 * Wash case `id`: its frames the same whichever came first, and, against the same painting without the ops under
 * test, its pigment conserved or its lift bounded, read from the last group's layer at its end.
 */
async function checkStampGateWash(id: string): Promise<StampGateWashCheck[]> {
  const washCase = stampGateWashCase(id), { subject, mid } = washCase, url = drawnImages(subject);
  const end = subject.t;
  const painted = await withGateRenderer(subject, url, async (renderer, frame) => ({
    end: await drawn(renderer, frame, end), mid: await drawn(renderer, frame, mid), again: await drawn(renderer, frame, end), layer: await renderer.readLayer({ t: end }),
  }));
  const fresh = await withGateRenderer(subject, url, (renderer, frame) => drawn(renderer, frame, mid));
  const ends = stampGateFrameDifference(painted.end, painted.again), mids = stampGateFrameDifference(fresh, painted.mid);
  const checks: StampGateWashCheck[] = [{
    id: `${id}: any frame order`, passed: stampGateFramePasses(ends) && stampGateFramePasses(mids),
    detail: `its end drawn again after ${mid} s: max ${ends.max}, mean ${ends.mean.toFixed(4)}; ${mid} s drawn fresh against after its end: max ${mids.max}, mean ${mids.mean.toFixed(4)}`,
  }];
  if (washCase.property === 'order') return checks;
  if (washCase.property === 'frame') return [...checks, washCase.read(painted.end)];
  const pigments = stampGateLastGroupPigments(subject);
  if (washCase.property === 'fenced') return [...checks, checkStampGateFenced(id, pigments, painted.layer, washCase.fenced)];
  if (washCase.property === 'unlined') {
    const withoutBlooms = await withGateRenderer(subject, url, (renderer) => renderer.readLayer({ t: end }), { wetStages: STAMP_WET_STAGES.filter((stage) => stage.id !== 'bloom') });
    return [...checks, checkStampGateUnlined(id, pigments, painted.layer, withoutBlooms)];
  }
  if (washCase.property === 'unrimmed') {
    const withoutRim = await withGateRenderer(subject, url, (renderer) => renderer.readLayer({ t: end }), { wetStages: STAMP_WET_STAGES.filter((stage) => stage.id !== 'drying-rim') });
    return [...checks, checkStampGateUnrimmed(id, pigments, painted.layer, withoutRim)];
  }
  if (stampGateLastGroupPigments(washCase.without).join() !== pigments.join()) throw new Error(`stamp gate: ${id} and its painting without the ops under test lay different pigments`);
  const without = await withGateRenderer(washCase.without, url, (renderer) => renderer.readLayer({ t: end }));
  if (washCase.property === 'conserved') return [...checks, checkStampGateConserved(id, pigments, painted.layer, without)];
  if (washCase.property === 'rimmed') return [...checks, checkStampGateRimmed(id, pigments, painted.layer, without)];
  if (washCase.property === 'bloomed') return [...checks, checkStampGateBloomed(id, pigments, painted.layer, without)];
  if (washCase.property === 'unlipped') return [...checks, checkStampGateUnlipped(id, pigments, painted.layer, without)];
  if (washCase.property === 'lipped') return [...checks, checkStampGateLipped(id, pigments, painted.layer, without)];
  if (washCase.property === 'spread') return [...checks, checkStampGateSpread(id, pigments, painted.layer, without)];
  if (washCase.property === 'set') {
    const layerOf = (gate: StampGatePainting) => withGateRenderer(gate, drawnImages(gate), (renderer) => renderer.readLayer({ t: end }));
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
  const traces = await renderer.trace({ t: gate.t }, deposits.map((deposit) => ({ deposit, crop: { x: 0, y: 0, w: gate.width, h: gate.height } })));
  return traces.map((trace) => trace.coverage);
});
/** The coverage channel of `gate`'s last group's layer at its time, drawn with `stages`. */
async function lastLayerCoverage(gate: StampGatePainting, stages = STAMP_WET_STAGES) {
  const { layers, values } = await withGateRenderer(gate, drawnImages(gate), (renderer) => renderer.readLayer({ t: gate.t }), { wetStages: stages });
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
    // The bend and the other bend on one renderer, the other's lattice and checkpoints warm under another key; then fresh.
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
    // The rest frame first, so the live frame restores the sky from a checkpoint the painting as written saved.
    const rest = stampGateLivePainting();
    const frames = await withGateRenderer(rest, drawnImages(rest), async (renderer, frame) => {
      const atRest = await drawn(renderer, frame, 0), live = await drawn(renderer, frame, 0, stampGateLiveState());
      // The same key again restores the live frame from the checkpoint it saved.
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
    const device = await createStampPaintDevice();
    try {
      const texture = (format: GPUTextureFormat) => device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const refusesSrgb = await createStampPaintSurface({ device, frame: texture('rgba8unorm-srgb') }, ({ file }) => url(file)).then(() => false, () => true);
      const frame = texture('rgba8unorm');
      const surface = await createStampPaintSurface({ device, frame }, ({ file }) => url(file));
      const renderer = await gateRenderer(gate, surface);
      await renderer.draw({ t: frameAt(2) });
      const lent = await readGateTexture(device, frame);
      surface.dispose();
      // An error scope the surface left open would catch this one's error, and the pop below would report none.
      device.pushErrorScope('validation');
      device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: 0 });
      const caught = await device.popErrorScope();
      return checkStampGateLent({ onCanvas, lent, refusesSrgb, scopesBalanced: caught !== null });
    } finally {
      device.destroy();
    }
  }
  throw new Error(`stamp gate: no animation case ${JSON.stringify(id)}; the gate animates ${STAMP_GATE_ANIMATION_IDS.join(', ')}`);
}

const STAMP_GATE_FLOW_HOLD_WGSL = /* wgsl */ `
fn washHold(l: u32, at: vec2f, tooth: vec2f, depth: f32, held: vec4f) -> vec4f {
  return vec4f(1.0 + 0.6 * sin(0.9 * at.x) * cos(0.7 * at.y));
}`;

/** A layer the gate writes for a stage run alone: its array layers, the fresh paint's (flow's), and the footprint. */
type StampGateWritten = { width: number; height: number; layer: readonly Float32Array[]; fresh?: readonly Float32Array[]; footprint: Float32Array };

/**
 * `written` on a device of its own, `run` given the stage context over it (with `landed`'s grids uploaded, as the
 * renderer uploads every landing's) and an encoder; the layer read back before and after.
 */
async function runStampGateStage(
  id: string, painting: CompiledStampPaint, medium: PaintMedium, landed: CompiledStampDeposit, written: StampGateWritten,
  run: (context: StampWetStageContext, encoder: GPUCommandEncoder) => void,
): Promise<{ before: Float32Array; after: Float32Array }> {
  const { width, height } = written, layers = written.layer.length, stage = stampStage({ width, height });
  const wetness = compileStampWetness(painting, () => medium, { color: '#ffffff' }, stage);
  const device = await createStampPaintDevice();
  try {
    const texture = (count: number, arrays: readonly Float32Array[]) => {
      const made = device.createTexture({ size: [width, height, count], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
      arrays.forEach((values, l) => device.queue.writeTexture({ texture: made, origin: [0, 0, l] }, Uint16Array.from(values, stampGateHalfBits), { bytesPerRow: width * 8, rowsPerImage: height }, [width, height, 1]));
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
      return Float32Array.from(new Uint16Array(buffer.getMappedRange().slice(0)), stampGateHalfValue);
    };
    const { before: grids } = wetness.landings.get(landed)!;
    const gridBuffer = device.createBuffer({ size: 12 * grids.wetness.length, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(gridBuffer, 0, Float32Array.from([...grids.wetness, ...grids.workable, ...grids.settled]));
    device.pushErrorScope('validation');
    const context: StampWetStageContext = {
      device, painting, wetness, stage, layer: arrayViews(layer),
      // A hold rippling across the case, so paint is held to its sums however unevenly the paper takes it.
      wash: { layersOf: () => layers, movedWgsl: () => stampWashMovedWgsl(layers, medium.body), holdWgsl: () => STAMP_GATE_FLOW_HOLD_WGSL },
      footprint: { texture: footprint, view: footprint.createView({ dimension: '2d' }) },
      fresh: arrayViews(texture(layers, written.fresh ?? written.layer.map((values) => new Float32Array(values.length)))),
      grids: { buffer: gridBuffer, firsts: new Map([[landed, 0]]) }, paperDepth: 0,
    };
    const before = await read();
    const encoder = device.createCommandEncoder();
    run(context, encoder);
    device.queue.submit([encoder.finish()]);
    const error = await device.popErrorScope();
    if (error) throw new Error(`stamp gate: ${id}: ${error.message}`);
    return { before, after: await read() };
  } finally {
    device.destroy();
  }
}

/** Flow case `id` (stamp-gate-flow.ts): the flow stage run once after its fresh deposit over the layer written. */
async function checkStampGateFlowCase(id: string): Promise<StampGateWashCheck> {
  const { medium: name, kind } = stampGateFlowCase(id), medium = PAINT_MEDIA[name];
  const painting = stampGateFlowPainting(kind), pass = painting.groups[0].passes[0], deposit = stampPassDeposits(pass)[1];
  const box = { x: 0, y: 0, w: STAMP_GATE_FLOW_SIZE.width, h: STAMP_GATE_FLOW_SIZE.height };
  const { before, after } = await runStampGateStage(id, painting, medium, deposit, { ...STAMP_GATE_FLOW_SIZE, ...stampGateFlowLayer(kind) }, (context, encoder) => {
    const stage = STAMP_WET_FLOW_STAGE.load(context);
    stage.reserve?.(box);
    stage.encode(encoder, { deposit, pass, landing: context.wetness.landings.get(deposit)!, box, seed: 0 });
  });
  return checkStampGateFlow(id, before, after);
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
      const { before, after } = await runStampGateStage(id, painting, medium, stampPassDeposits(pass).at(-1)!, { ...STAMP_GATE_STRIPE_SIZE, ...stampGateStripeLayer() }, (context, encoder) => {
        const loaded = STAMP_DRYING_RIM_STAGE.load(context), [drying] = context.wetness.washes.get(pass)!.dryings;
        ownsEdges = drying.deposits.every((deposit) => loaded.ownsWetEdges?.(deposit) ?? false);
        loaded.encode(encoder, { drying, seed: 0 });
      });
      return { rim, before, after, ownsEdges };
    }));
    return checkStampGateRimStrength(id, runs);
  }
  const painting = stampGateStripePainting(), pass = painting.groups[0].passes[0], drop = stampPassDeposits(pass).at(-1)!;
  const box = { x: 0, y: 0, w: STAMP_GATE_STRIPE_SIZE.width, h: STAMP_GATE_STRIPE_SIZE.height };
  const { before, after } = await runStampGateStage(id, painting, medium, drop, { ...STAMP_GATE_STRIPE_SIZE, ...stampGateStripeLayer() }, (context, encoder) => {
    if (stage === 'rim') {
      STAMP_DRYING_RIM_STAGE.load(context).encode(encoder, { drying: context.wetness.washes.get(pass)!.dryings[0], seed: 0 });
      return;
    }
    const bloom = STAMP_BLOOM_STAGE.load(context);
    bloom.reserve?.(box);
    bloom.encode(encoder, { deposit: drop, pass, landing: context.wetness.landings.get(drop)!, box, seed: 0 });
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

/**
 * Outside layer case `id` (stamp-gate-outside-layer.ts), on one surface: the painting with no outside layer; content
 * a, b, a and a hidden on one renderer, its texture written before each frame; and b on a renderer of its own.
 */
async function checkStampGateOutsideCase(id: string): Promise<StampGateWashCheck[]> {
  const kind = stampGateOutsideKind(id);
  if (!kind) throw new Error(`stamp gate: no outside layer case ${JSON.stringify(id)}; the gate has ${STAMP_GATE_OUTSIDE_IDS.join(', ')}`);
  const gate = stampGateOutsidePainting(kind), { width, height } = gate;
  const halves = { a: Uint16Array.from(stampGateOutsideContent('a'), stampGateHalfBits), b: Uint16Array.from(stampGateOutsideContent('b'), stampGateHalfBits) };
  return withGateSurface(gate, drawnImages(gate), async (surface, frame) => {
    const plainRenderer = await gateRenderer(gate, surface), plain = await drawn(plainRenderer, frame, gate.t);
    plainRenderer.dispose();
    const texture = surface.device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const framesOf = async (order: readonly { content: 'a' | 'b'; visibility: number }[]) => {
      const renderer = await createStampPaintRenderer(surface, gate.painting, gate.paper, gate.mixing, { outsideLayers: [{ ...STAMP_GATE_OUTSIDE_SLOT, texture }] });
      const frames = await order.reduce<Promise<Uint8ClampedArray[]>>(async (done, { content, visibility }) => {
        const before = await done;
        surface.device.queue.writeTexture({ texture }, halves[content], { bytesPerRow: width * 8 }, [width, height]);
        await renderer.draw({ t: gate.t, outside: new Map([[STAMP_GATE_OUTSIDE_SLOT.id, { content, visibility }]]) });
        await renderer.finish();
        return [...before, frame()];
      }, Promise.resolve([]));
      renderer.dispose();
      return frames;
    };
    const [a, b, aAgain, hidden] = await framesOf([{ content: 'a', visibility: 1 }, { content: 'b', visibility: 1 }, { content: 'a', visibility: 1 }, { content: 'a', visibility: 0 }]);
    const [bFresh] = await framesOf([{ content: 'b', visibility: 1 }]);
    return checkStampGateOutsideLayer(kind, { plain, a, b, aAgain, hidden, bFresh });
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
  checkStampGateMediaCase, checkStampGateOutsideCase, checkStampGateStageCase, stampGateAdapter,
});

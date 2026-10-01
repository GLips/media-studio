// stamp-gate-page.ts: the GPU gate's browser side, run by engine/stamp-gate.ts through withBrowserModulePage. It runs
// the formula grids (stamp-gate-formulas.ts) on the renderer's own WGSL, paints the gate's paintings
// (stamp-gate-paintings.ts) with the studio's renderer, holds a traced resolve to the frame it draws, and paints each
// wash case, reading its layer back for the properties it's held to (stamp-gate-washes.ts), animates the animation
// cases (stamp-gate-animation.ts) and runs the flow, bloom and rim stages alone over layers it writes
// (stamp-gate-flow.ts, stamp-gate-stripe.ts). Paintings are built here, as a compiled painting's typed arrays don't
// survive the trip from Node.

import { PAINT_KUBELKA_MUNK_WGSL } from '#lib/picture/paint/models/paint-kubelka-munk.ts';
import { PAINT_PAPER_WGSL } from '#lib/picture/paint/models/paint-paper.ts';
import { COVERAGE_FORMULAS_WGSL } from '#lib/picture/stamp-paint/models/coverage-formulas.ts';
import { STAMP_ACCUMULATION_LAY_WGSL, STAMP_ACCUMULATION_RESOLVE_WGSL } from '#lib/picture/stamp-paint/models/stamp-deposit-stages.ts';
import { STAMP_FLOOD_FRONT_SHARE_WGSL } from '#lib/picture/stamp-paint/models/stamp-fill.ts';
import { STAMP_PAINT_FIELD_SHARE } from '#lib/picture/stamp-paint/models/stamp-paint-field.ts';
import { stampPassDeposits, type CompiledStampDeposit, type CompiledStampPaint } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import { STAMP_WET_LAND_WGSL } from '#lib/picture/stamp-paint/models/stamp-wet-landing.ts';
import { STAMP_WET_LIFT_WGSL } from '#lib/picture/stamp-paint/models/stamp-wet-lift.ts';
import { STAMP_GRID_AT_WGSL, STAMP_POLYGON_DISTANCE_WGSL, STAMP_REGION_WGSL } from '#lib/picture/stamp-paint/models/stamp-region.ts';
import { PAINT_MEDIA } from '#lib/picture/paint/models/paint-medium.ts';
import { compileStampWetness } from '#lib/picture/stamp-paint/models/stamp-wetness.ts';
import { createStampPaintDevice } from '#lib/picture/stamp-paint/studio/stamp-paint-gpu.ts';
import { STAMP_WET_FLOW_STAGE } from '#lib/picture/stamp-paint/studio/stamp-wet-flow.ts';
import { STAMP_BLOOM_STAGE } from '#lib/picture/stamp-paint/studio/stamp-wet-bloom.ts';
import { STAMP_DRYING_RIM_STAGE } from '#lib/picture/stamp-paint/studio/stamp-wet-rim.ts';
import type { StampWetStageContext } from '#lib/picture/stamp-paint/studio/stamp-wet-stages.ts';
import { stampWashDryings } from '#lib/picture/stamp-paint/models/stamp-wet-rim.ts';
import type { PaintMedium } from '#lib/picture/paint/models/paint-medium.ts';
import { stampWashMovedWgsl } from '#lib/picture/stamp-paint/studio/stamp-paint-pigment-compositor.ts';
import type { StampBrush } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { createStampPaintRenderer, type StampPaintRenderer } from '#lib/picture/stamp-paint/studio/stamp-paint-renderer.ts';
import {
  checkStampGateBloomBoil, checkStampGateBoil, checkStampGateBoilWash, checkStampGateDrift, checkStampGateRecolour, checkStampGateSunset, STAMP_GATE_ANIMATION_FPS, STAMP_GATE_ANIMATION_IDS,
  STAMP_GATE_DRIFT_FRAMES, STAMP_GATE_RECOLOUR_KEYS, stampGateBloomBoilPainting, stampGateBoilPainting, stampGateBoilWashPainting, stampGateDriftPainting, stampGateRecolourPainting,
  stampGateSunsetPainting,
} from '../models/stamp-gate-animation.ts';
import {
  checkStampGateFlow, STAMP_GATE_FLOW_SIZE, stampGateFlowCase, stampGateFlowLayer, stampGateFlowPainting, stampGateHalfBits, stampGateHalfValue,
} from '../models/stamp-gate-flow.ts';
import { stampGatePrivatePainting, type StampGatePrivateCase } from '../models/stamp-gate-private-cases.ts';
import { checkStampGateStripe, STAMP_GATE_STRIPE_SIZE, stampGateStripeCase, stampGateStripeLayer, stampGateStripePainting } from '../models/stamp-gate-stripe.ts';
import { stampGateFrameDifference, stampGateFramePasses, type StampGateFrameDifference } from '../models/stamp-gate-frames.ts';
import {
  checkStampGateConserved, checkStampGateFenced, checkStampGateRimmed, checkStampGateLifted, checkStampGateSet, checkStampGateSpread, stampGateLastGroupPigments, stampGateWashCase, type StampGateWashCheck,
} from '../models/stamp-gate-washes.ts';
import { stampGatePainting, stampGateTracePainting, type StampGateImage, type StampGatePainting } from '../models/stamp-gate-paintings.ts';

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
${points ? `@group(0) @binding(2) var<storage, read> points: array<vec2f>;\n${STAMP_POLYGON_DISTANCE_WGSL}` : ''}
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

/** A grey image as a PNG data URL, lossless, so the GPU samples the bytes drawn. */
function imageUrl({ size, pixels }: StampGateImage): string {
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const context = canvas.getContext('2d')!, image = context.createImageData(size, size);
  pixels.forEach((v, i) => image.data.set([v, v, v, 255], i * 4));
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** `gate` on a renderer of its own, its images at `url`, handed to `use`; disposed after. */
async function withGateRenderer<T>(gate: Omit<StampGatePainting, 'images'>, url: (file: string) => string, use: (renderer: StampPaintRenderer, frame: () => Uint8ClampedArray) => Promise<T>): Promise<T> {
  const { painting, paper, mixing, width, height } = gate;
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const renderer = await createStampPaintRenderer(canvas, painting, paper, mixing, width, height, ({ file }) => url(file), { fps: STAMP_GATE_ANIMATION_FPS });
  const frame = () => {
    const context = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d')!;
    context.drawImage(canvas, 0, 0);
    return context.getImageData(0, 0, width, height).data;
  };
  try {
    return await use(renderer, frame);
  } finally {
    renderer.dispose();
  }
}

const drawnImages = (gate: StampGatePainting) => {
  const urls = Object.fromEntries(Object.entries(gate.images).map(([file, image]) => [file, imageUrl(image)]));
  return (file: string) => urls[file];
};

/** `gate` drawn at its time: its frame as RGB bytes, row by row, in base64. */
function paintedFrame(gate: Omit<StampGatePainting, 'images'>, url: (file: string) => string): Promise<string> {
  return withGateRenderer(gate, url, async (renderer, frame) => {
    await renderer.draw(gate.t);
    await renderer.finish();
    const rgba = frame(), rgb = new Uint8Array(gate.width * gate.height * 3);
    for (let i = 0; i < gate.width * gate.height; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
    let binary = '';
    for (let i = 0; i < rgb.length; i += 0x8000) binary += String.fromCharCode(...rgb.subarray(i, i + 0x8000));
    return btoa(binary);
  });
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
    const traces = await renderer.trace(gate.t, deposits.map((deposit) => ({ deposit, crop: { x: 0, y: 0, w: width, h: height } })));
    await renderer.finish();
    const traced = frame();
    await renderer.draw(gate.t);
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

/** `renderer`'s frame at `t`, once the GPU has drawn it. */
async function drawn(renderer: StampPaintRenderer, frame: () => Uint8ClampedArray, t: number) {
  await renderer.draw(t);
  await renderer.finish();
  return frame();
}

/**
 * Wash case `id`: its frames the same whichever came first, and, against the same painting without the ops under
 * test, its pigment conserved or its lift bounded, read from the last group's layer at its end.
 */
async function checkStampGateWash(id: string): Promise<StampGateWashCheck[]> {
  const washCase = stampGateWashCase(id), { subject, mid } = washCase, url = drawnImages(subject);
  const end = subject.t;
  const painted = await withGateRenderer(subject, url, async (renderer, frame) => ({
    end: await drawn(renderer, frame, end), mid: await drawn(renderer, frame, mid), again: await drawn(renderer, frame, end), layer: await renderer.readLayer(end),
  }));
  const fresh = await withGateRenderer(subject, url, (renderer, frame) => drawn(renderer, frame, mid));
  const ends = stampGateFrameDifference(painted.end, painted.again), mids = stampGateFrameDifference(fresh, painted.mid);
  const checks: StampGateWashCheck[] = [{
    id: `${id}: any frame order`, passed: stampGateFramePasses(ends) && stampGateFramePasses(mids),
    detail: `its end drawn again after ${mid} s: max ${ends.max}, mean ${ends.mean.toFixed(4)}; ${mid} s drawn fresh against after its end: max ${mids.max}, mean ${mids.mean.toFixed(4)}`,
  }];
  if (washCase.property === 'order') return checks;
  const pigments = stampGateLastGroupPigments(subject);
  if (washCase.property === 'fenced') return [...checks, checkStampGateFenced(id, pigments, painted.layer, washCase.fenced)];
  if (stampGateLastGroupPigments(washCase.without).join() !== pigments.join()) throw new Error(`stamp gate: ${id} and its painting without the ops under test lay different pigments`);
  const without = await withGateRenderer(washCase.without, url, (renderer) => renderer.readLayer(end));
  if (washCase.property === 'conserved') return [...checks, checkStampGateConserved(id, pigments, painted.layer, without)];
  if (washCase.property === 'rimmed') return [...checks, checkStampGateRimmed(id, pigments, painted.layer, without)];
  if (washCase.property === 'spread') return [...checks, checkStampGateSpread(id, pigments, painted.layer, without)];
  if (washCase.property === 'set') {
    const layerOf = (gate: StampGatePainting) => withGateRenderer(gate, drawnImages(gate), (renderer) => renderer.readLayer(end));
    const wet = { subject: await layerOf(washCase.fresh.subject), without: await layerOf(washCase.fresh.without) };
    return [...checks, checkStampGateSet(id, pigments, washCase.rewetting, { subject: painted.layer, without }, wet)];
  }
  return [...checks, checkStampGateLifted(id, pigments, washCase.pigments, painted.layer, without)];
}

/** Frame `k`'s time at the animations' frame rate. */
const frameAt = (k: number) => k / STAMP_GATE_ANIMATION_FPS;

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
    const traced = (gate: StampGatePainting) => withGateRenderer(gate, drawnImages(gate), async (renderer) => {
      const deposits = gate.painting.groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass)));
      const traces = await renderer.trace(gate.t, deposits.map((deposit) => ({ deposit, crop: { x: 0, y: 0, w: gate.width, h: gate.height } })));
      return traces.map((trace) => trace.coverage);
    });
    return checkStampGateSunset(await traced(stampGateSunsetPainting('day')), await traced(stampGateSunsetPainting('dusk')));
  }
  if (id === 'animation/recolour') {
    const [from, to] = STAMP_GATE_RECOLOUR_KEYS, middle = (from + to) / 2;
    const still = stampGateRecolourPainting('halfway'), keyed = stampGateRecolourPainting('keyed');
    const stillFrame = await withGateRenderer(still, drawnImages(still), (renderer, frame) => drawn(renderer, frame, from));
    const freshEnd = await withGateRenderer(keyed, drawnImages(keyed), (renderer, frame) => drawn(renderer, frame, to));
    return withGateRenderer(keyed, drawnImages(keyed), async (renderer, frame) => {
      const halfway = await drawn(renderer, frame, middle), end = await drawn(renderer, frame, to);
      return checkStampGateRecolour({
        still: stillFrame, halfway, freshEnd, end, halfwayAgain: await drawn(renderer, frame, middle), past: await drawn(renderer, frame, to + 2),
      });
    });
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
  const { width, height } = written, layers = written.layer.length;
  const wetness = compileStampWetness(painting, medium, { color: '#ffffff' }, { width, height });
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
      device, painting, medium, wetness, width, height, layer: arrayViews(layer),
      // A hold rippling across the case, so paint is held to its sums however unevenly the paper takes it.
      wash: { layersOf: () => layers, movedWgsl: (n) => stampWashMovedWgsl(n, medium.body), holdWgsl: () => STAMP_GATE_FLOW_HOLD_WGSL },
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
 * over the layer written.
 */
async function checkStampGateStripeCase(id: string): Promise<StampGateWashCheck> {
  const { stage, medium: name } = stampGateStripeCase(id), medium = PAINT_MEDIA[name];
  const painting = stampGateStripePainting(), pass = painting.groups[0].passes[0], drop = stampPassDeposits(pass).at(-1)!;
  const box = { x: 0, y: 0, w: STAMP_GATE_STRIPE_SIZE.width, h: STAMP_GATE_STRIPE_SIZE.height };
  const { before, after } = await runStampGateStage(id, painting, medium, drop, { ...STAMP_GATE_STRIPE_SIZE, ...stampGateStripeLayer() }, (context, encoder) => {
    if (stage === 'rim') {
      STAMP_DRYING_RIM_STAGE.load(context).encode(encoder, { drying: stampWashDryings(pass)[0], seed: 0 });
      return;
    }
    const bloom = STAMP_BLOOM_STAGE.load(context);
    bloom.reserve?.(box);
    bloom.encode(encoder, { deposit: drop, pass, landing: context.wetness.landings.get(drop)!, box, seed: 0 });
  });
  return checkStampGateStripe(id, before, after);
}

/** The GPU the gate draws on, as a baseline records it. */
async function stampGateAdapter(): Promise<string> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('stamp gate: no WebGPU adapter');
  const { vendor, architecture, device, description } = adapter.info;
  return [vendor, architecture, device, description].filter(Boolean).join(' ');
}

Object.assign(globalThis, { runStampGateFormulas, paintStampGate, paintStampGatePrivate, traceStampGate, checkStampGateWash, checkStampGateAnimation, checkStampGateFlowCase, checkStampGateStripeCase, stampGateAdapter });

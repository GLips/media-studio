// stamp-region-textures.ts: what of a painting doesn't change as it's painted, worked out once into cropped
// single-channel textures: an area's coverage clipped to others' (a flood's barrier, a `within`, a wash's
// preparation), and each state of the masking fluid a deposit lands under, which may read a brushed mask's
// (stamp-brushed-mask-textures.ts). It encodes into the encoder it's given, which its caller submits.

import { COVERAGE_FORMULAS_WGSL } from '#lib/paint/brush/models/coverage-formulas.ts';
import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_FULL_FRAME_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import { STAMP_AREA_COVERAGE_WGSL, stampAreaBox, type CompiledStampArea } from '../models/stamp-area.ts';
import type { CompiledStampBrushedMask } from '../models/stamp-brushed-mask.ts';
import type { CompiledStampMask } from '../models/stamp-paint-recipe-compile.ts';
import { STAMP_POLYGON_DISTANCE_WGSL, STAMP_REGION_WGSL, STAMP_RINGED_COUNT, stampEdgeWidth, stampRingsLayout, type StampBox, type StampPoint } from '../models/stamp-region.ts';
import { stampBoxUnion, stampPointBox, stampPointBoxWords, type StampPointBox, type StampStage } from '../models/stamp-stage.ts';
import { stampBindGroup, stampPaintBuffer, type StampPaintDevice } from './stamp-paint-gpu.ts';
import { STAMP_UNIFORM_SLOT } from './stamp-uniform-arena.ts';
import { STAMP_REST_IDENTITY, STAMP_REST_POINT_WGSL, type StampRestMap } from '../models/stamp-rest-map.ts';

// A state of the masking fluid over its box: the state it's built on (`parent`, width 0 for none), then `opCount` ops
// from `firstOp`: a mask joins its area by max, an unmask lifts its amount (everywhere for `count` 0), a clip keeps
// only its area. An op's area, worked within its `reach`, joins its copies `wrap` px apart.
const MASK_STEP = gpuUniformLayout('MaskStep', [['box', 'vec4f'], ['parent', 'vec4f'], ['source', 'vec4f'], ['firstOp', 'u32'], ['opCount', 'u32'], ['wrap', 'f32']]);
/** A MaskOp's words: its fifteen, padded to its rest map's vec4f alignment, and that map's four. */
const MASK_OP_WORDS = 20;
const MASK_STEP_WGSL = /* wgsl */ `
${COVERAGE_FORMULAS_WGSL}
${STAMP_REGION_WGSL}
${STAMP_REST_POINT_WGSL}
${GPU_FULL_FRAME_WGSL}
${MASK_STEP.wgsl}
struct MaskOp { reach: vec4f, ragged: vec2f, width: f32, amount: f32, first: u32, count: u32, kind: u32, seed: u32, inset: f32, boundaryFirst: u32, boundaryCount: u32, rest: vec4f }
@group(0) @binding(0) var<uniform> u: MaskStep;
@group(0) @binding(1) var<storage, read> points: array<vec2f>;
@group(0) @binding(2) var parent: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> ops: array<MaskOp>;
@group(0) @binding(4) var<storage, read> boundaries: array<vec4f>;
@group(0) @binding(5) var source: texture_2d<f32>;
${STAMP_POLYGON_DISTANCE_WGSL}
${STAMP_AREA_COVERAGE_WGSL}
@fragment fn maskStep(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let p = at.xy + u.box.xy;
  var fluid = 0.0;
  let q = floor(p) - u.parent.xy;
  if (all(q >= vec2f(0.0)) && all(q < u.parent.zw)) { fluid = textureLoad(parent, vec2u(q), 0).r; }
  for (var i = u.firstOp; i < u.firstOp + u.opCount; i++) {
    let op = ops[i];
    var r = 1.0;
    // A brushed mask joins by max what it covers, read from its texture (\`source\`): a step binds one at most.
    if (op.kind == 3u) {
      r = 0.0;
      let s = floor(p) - u.source.xy;
      if (all(s >= vec2f(0.0)) && all(s < u.source.zw)) { r = textureLoad(source, vec2u(s), 0).r; }
    } else if (op.count > 0u) {
      r = 0.0;
      var k = 0.0;
      var last = 0.0;
      if (u.wrap > 0.0) {
        k = ceil((p.x - op.reach.z) / u.wrap);
        last = floor((p.x - op.reach.x) / u.wrap);
      }
      for (; k <= last; k += 1.0) {
        let q = vec2f(p.x - k * u.wrap, p.y);
        if (all(q >= op.reach.xy) && all(q <= op.reach.zw)) { r = max(r, areaCoverageAt(q, restPoint(op.rest, q), op.first, op.count, op.inset, op.ragged, op.width, op.seed, op.boundaryFirst, op.boundaryCount)); }
      }
    }
    if (op.kind == 2u) { fluid *= r; } else { fluid = select(fluid * (1.0 - op.amount * r), max(fluid, r), op.kind == 0u || op.kind == 3u); }
  }
  return vec4f(fluid);
}`;

/**
 * The most a painting's region textures (flood barriers, masking fluid, `within` regions, wash preparations) may take,
 * bytes, and its brushed masks' apart.
 */
export const STAMP_REGION_BUDGET = 512 * 1024 * 1024;
/**
 * Half floats: a state of the fluid is built on the one under it, and a chain of slight unmasks would round back to
 * where it began in bytes.
 */
export const STAMP_REGION_FORMAT = 'r16float', STAMP_REGION_TEXEL_BYTES = 2;

/** A region worked out at load: its texture, and its box in painting points. */
export type StampRegionTexture = { view: GPUTextureView; box: StampPointBox };

/**
 * `regionAt(region, box, pixel)`: a region texture's value at a stage texel, `box` its x, y, width and height in the
 * stage's texels (stampRegionTexelWords): none outside it.
 */
export const STAMP_REGION_AT_WGSL = /* wgsl */ `
fn regionAt(region: texture_2d<f32>, box: vec4f, pixel: vec2u) -> f32 {
  let q = vec2f(pixel) - box.xy;
  if (any(q < vec2f(0.0)) || any(q >= box.zw)) { return 0.0; }
  return textureLoad(region, vec2u(q), 0).r;
}`;

/** An area's coverage on no fluid, clipped to each of `clips`: a flood's barrier, a `within`, a wash's preparation. */
export type StampRegionCoverage = { area: CompiledStampArea; clips: readonly CompiledStampArea[] };

/**
 * The regions a set of deposits needs: `coverages`, and each state of the fluid in `fluids` (those a deposit or a
 * preparation lands under), a brushed mask's read from `brushed` (encodeStampBrushedMasks', none for one off the stage).
 */
export type StampRegionTextureRequest = {
  coverages: readonly StampRegionCoverage[];
  fluids: Iterable<CompiledStampMask>;
  brushed: ReadonlyMap<CompiledStampBrushedMask, StampRegionTexture | null>;
};

/** Each of a request's coverages in its order, and each state of the fluid it asked for: null for one off the stage or empty. */
export type StampRegionTextures = { coverages: readonly (StampRegionTexture | null)[]; fluids: ReadonlyMap<CompiledStampMask, StampRegionTexture | null> };

/**
 * `request`'s regions on `stage`, made through `on` and drawn into `encoder`, `blank` bound for a region of none. All
 * are planned against STAMP_REGION_BUDGET, refused past it before any is made; coverages of the same areas share one.
 */
export function encodeStampRegionTextures(
  on: StampPaintDevice, encoder: GPUCommandEncoder, { stage, blank }: { stage: StampStage; blank: GPUTextureView }, request: StampRegionTextureRequest,
): StampRegionTextures {
  const { frame, margin, wrap } = stage;
  // Every polygon once and every op of the fluid, in storage buffers.
  const points: number[] = [], placed = new Map<readonly StampPoint[], [number, number]>();
  const pointsOf = (polygon: readonly StampPoint[]) => {
    if (!placed.has(polygon)) {
      placed.set(polygon, [points.length / 2, polygon.length]);
      for (const { x, y } of polygon) points.push(x, y);
    }
    return placed.get(polygon)!;
  };
  // A ringed area's points as ringsDistance reads them, its count flagged.
  const laidRings = new Map<readonly (readonly StampPoint[])[], [number, number]>();
  const areaPointsOf = (area: CompiledStampArea): [number, number] => {
    if (!area.rings) return pointsOf(area.polygon);
    if (!laidRings.has(area.rings)) {
      const [first, count] = pointsOf(stampRingsLayout(area.rings));
      laidRings.set(area.rings, [first, (STAMP_RINGED_COUNT + count) >>> 0]);
    }
    return laidRings.get(area.rings)!;
  };
  const opWords: { floats: number[]; words: number[]; inset: number; boundaries: [number, number]; rest: StampRestMap }[] = [];
  // A within's treated stretches, each a vec4f: its path's first point and count in `points`, merge or feather, reach.
  const boundaryFloats: number[] = [];
  const boundariesOf = (area: CompiledStampArea | null): [number, number] => {
    const treated = area?.boundaries ?? [], first = boundaryFloats.length / 4;
    for (const { path, treatment, reach } of treated) boundaryFloats.push(...pointsOf(path), treatment === 'merge' ? 1 : 0, reach);
    return [first, treated.length];
  };
  type Step = { box: StampPointBox; parent: Step | null; source: StampRegionTexture | null; firstOp: number; opCount: number };
  const steps: Step[] = [];
  // A region's box is in painting points, held to the stage.
  const held = (box: StampBox): StampPointBox | null => {
    const x = Math.max(-margin, Math.floor(box.x0)), y = Math.max(-margin, Math.floor(box.y0));
    const w = Math.min(frame.width + margin, Math.ceil(box.x1)) - x, h = Math.min(frame.height + margin, Math.ceil(box.y1)) - y;
    return w > 0 && h > 0 ? stampPointBox({ x, y, w, h }) : null;
  };
  // On a wrapping stage, with each copy of it a whole number of wraps away that's on the stage.
  const inPainting = (box: StampBox): StampPointBox | null => {
    if (!wrap) return held(box);
    let found: StampPointBox | null = null;
    for (let k = Math.ceil((-margin - box.x1) / wrap); k <= Math.floor((frame.width + margin - box.x0) / wrap); k++) {
      found = stampBoxUnion(found, held({ ...box, x0: box.x0 + k * wrap, x1: box.x1 + k * wrap }));
    }
    return found;
  };
  /** An op of the fluid, over its area or everywhere, or a brushed mask's coverage (`source`), as a MaskOp. */
  const opOf = (kind: 'mask' | 'unmask' | 'clip' | 'source', amount: number, area: CompiledStampArea | null) => {
    const [first, count] = area ? areaPointsOf(area) : [0, 0], reach = area ? stampAreaBox(area) : null, ragged = area?.edge?.ragged;
    opWords.push({
      floats: [reach?.x0 ?? 0, reach?.y0 ?? 0, reach?.x1 ?? 0, reach?.y1 ?? 0, ragged?.amount ?? 0, ragged?.scale ?? 0, stampEdgeWidth(area?.edge), amount],
      words: [first, count, { mask: 0, unmask: 1, clip: 2, source: 3 }[kind], area?.seed ?? 0],
      inset: area?.inset ?? 0,
      boundaries: boundariesOf(area),
      rest: area?.rest ?? STAMP_REST_IDENTITY,
    });
  };
  /** A step drawing the next `opCount` ops over `box`, on `parent`'s state, a `source` op reading `source`. */
  const maskStep = (box: StampPointBox, parent: Step | null, opCount: number, source: StampRegionTexture | null = null): Step => {
    const step = { box, parent, source, firstOp: opWords.length, opCount };
    steps.push(step);
    return step;
  };

  // A coverage is one mask of its area on no fluid, clipped to each of its clips; null off the painting.
  const ids = new Map<CompiledStampArea, number>(), byAreas = new Map<string, Step | null>();
  const idOf = (area: CompiledStampArea) => {
    if (!ids.has(area)) ids.set(area, ids.size);
    return ids.get(area)!;
  };
  const coverages = request.coverages.map(({ area, clips }) => {
    const key = [area, ...clips].map(idOf).join(' ');
    if (!byAreas.has(key)) {
      const box = inPainting(stampAreaBox(area)), step = box && maskStep(box, null, 1 + clips.length);
      if (step) {
        opOf('mask', 1, area);
        for (const clip of clips) opOf('clip', 1, clip);
      }
      byAreas.set(key, step);
    }
    return byAreas.get(key)!;
  });

  // Only the states a deposit lands under are made: each on the nearest such state under it, with the ops between
  // in one step, so a run of masks costs one texture; a step reads one brushed mask, so a run is cut after each. A
  // state covers the one it's built on and each mask's reach.
  const read = new Set(request.fluids);
  const fluids = new Map<CompiledStampMask, Step | null>();
  const brushedRegion = (mask: CompiledStampBrushedMask) => {
    const region = request.brushed.get(mask);
    if (region === undefined) throw new Error(`stamp paint: ${mask.id} is brushed on under marks the painting didn't load with; brush masks outside live marks`);
    return region;
  };
  /** A step drawing `run` on `parent`'s state; a brushed mask off the painting masks nothing. */
  const runStep = (run: readonly CompiledStampMask[], parent: Step | null): Step | null => {
    let box: StampPointBox | null = parent?.box ?? null, source: StampRegionTexture | null = null;
    for (const op of run) {
      if (op.kind === 'mask') box = stampBoxUnion(box, inPainting(stampAreaBox(op.area)));
      if (op.kind === 'brushed') source = brushedRegion(op.brushed);
    }
    box = stampBoxUnion(box, source?.box ?? null);
    const ops = run.filter((op) => op.kind !== 'brushed' || source);
    const step = box && maskStep(box, parent, ops.length, source);
    if (step) {
      for (const op of ops) {
        if (op.kind === 'brushed') opOf('source', 1, null);
        else opOf(op.kind, op.kind === 'mask' ? 1 : op.amount, op.area);
      }
    }
    return step;
  };
  const fluidOf = (mask: CompiledStampMask): Step | null => {
    if (fluids.has(mask)) return fluids.get(mask)!;
    const between: CompiledStampMask[] = [];
    let base: CompiledStampMask | null = mask;
    for (; base && (base === mask || !read.has(base)); base = base.under) between.unshift(base);
    const runs: CompiledStampMask[][] = [[]];
    for (const op of between) {
      if (op.kind === 'brushed' && runs.at(-1)!.some(({ kind }) => kind === 'brushed')) runs.push([]);
      runs.at(-1)!.push(op);
    }
    const step = runs.reduce((parent, run) => runStep(run, parent), base ? fluidOf(base) : null);
    fluids.set(mask, step);
    return step;
  };
  for (const mask of read) fluidOf(mask);

  const bytes = steps.reduce((sum, { box }) => sum + box.w * box.h * STAMP_REGION_TEXEL_BYTES, 0);
  if (bytes > STAMP_REGION_BUDGET) {
    throw new Error(`stamp paint: the painting's fills, masking fluid, within regions and wash preparations need ${Math.round(bytes / 2 ** 20)} MB, over ${STAMP_REGION_BUDGET / 2 ** 20} MB: ${byAreas.size} fills, within regions and preparations, ${[...fluids.values()].filter(Boolean).length} states of the fluid; share masks between deposits or crop them`);
  }
  const made = new Map(steps.map((step): [Step, StampRegionTexture] => {
    const texture = on.createTexture({ size: [step.box.w, step.box.h], format: STAMP_REGION_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    return [step, { view: texture.createView(), box: step.box }];
  }));
  if (steps.length) {
    const opBytes = new ArrayBuffer(Math.max(1, opWords.length) * MASK_OP_WORDS * 4), opFloats = new Float32Array(opBytes), opInts = new Uint32Array(opBytes);
    opWords.forEach(({ floats, words, inset, boundaries, rest }, i) => {
      opFloats.set(floats, i * MASK_OP_WORDS);
      opInts.set(words, i * MASK_OP_WORDS + floats.length);
      opFloats[i * MASK_OP_WORDS + floats.length + words.length] = inset;
      opInts.set(boundaries, i * MASK_OP_WORDS + floats.length + words.length + 1);
      opFloats.set(rest, i * MASK_OP_WORDS + 16);
    });
    const pointBuffer = stampPaintBuffer(on, new Float32Array(points.length ? points : [0, 0]), GPUBufferUsage.STORAGE);
    const opBuffer = stampPaintBuffer(on, opFloats, GPUBufferUsage.STORAGE), boundaryBuffer = stampPaintBuffer(on, new Float32Array(boundaryFloats.length ? boundaryFloats : [0, 0, 0, 0]), GPUBufferUsage.STORAGE);
    const words = new ArrayBuffer(steps.length * STAMP_UNIFORM_SLOT), uniformBuffer = on.createBuffer({ size: steps.length * STAMP_UNIFORM_SLOT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const module = on.createShaderModule({ code: MASK_STEP_WGSL });
    const pipeline = on.createRenderPipeline({ layout: 'auto', vertex: { module }, fragment: { module, entryPoint: 'maskStep', targets: [{ format: STAMP_REGION_FORMAT }] } });
    // In the order planned, so a state of the fluid is drawn after the state it's built on.
    steps.forEach((step, i) => {
      const at = i * STAMP_UNIFORM_SLOT, n = STAMP_UNIFORM_SLOT / 4;
      const put = gpuUniformWriter(MASK_STEP, { floats: new Float32Array(words, at, n), ints: new Int32Array(words, at, n), words: new Uint32Array(words, at, n) });
      put('box', stampPointBoxWords(step.box));
      put('parent', stampPointBoxWords(step.parent?.box));
      put('source', stampPointBoxWords(step.source?.box));
      put('firstOp', step.firstOp);
      put('opCount', step.opCount);
      put('wrap', wrap);
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: made.get(step)!.view, loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, stampBindGroup(on, pipeline, [
        { buffer: uniformBuffer, offset: at, size: STAMP_UNIFORM_SLOT }, { buffer: pointBuffer }, step.parent ? made.get(step.parent)!.view : blank, { buffer: opBuffer },
        { buffer: boundaryBuffer }, step.source?.view ?? blank,
      ]));
      pass.draw(3);
      pass.end();
    });
    on.queue.writeBuffer(uniformBuffer, 0, words);
  }
  const textureOf = (step: Step | null) => step && made.get(step)!;
  return { coverages: coverages.map(textureOf), fluids: new Map([...fluids].map(([mask, step]) => [mask, textureOf(step)])) };
}

// stamp-paint-renderer.ts: draws a compiled stamp painting (lib/picture/stamp-paint/models/stamp-paint-recipe.ts) at a
// moment, on the GPU through WebGPU. Each frame starts from bare paper and paints every group again, so a frame depends
// only on its time: nothing a tab drew before survives into the next, and only images and stamp buffers are kept.
//
// A deposit is painted in four steps, each within the box its visible stamps reach:
//   1. a render pass stamps it, instanced, into a coverage mask: the brush's in red, its dual's in green. A glaze
//      brush's stroke is its densest stamp at each point, so it reaches at most its flow however densely it's stamped
//      and keeps its tip's edge; a build brush's stamps lay over each other, so its overlaps darken.
//   2. compute passes blur the mask, when the brush has wet or burnt edges: the rim is where the mask stands above it.
//   3. one compute pass resolves the coverage (edges, texturized grain, the dual combined by its blend, the paper's
//      tooth, protected regions, the clipping pass, the deposit's opacity), lays it onto its group's layer through the
//      compositor (stamp-paint-compositor.ts), and adds it to the clip when its pass is unclipped.
//   4. a compute pass lays each finished group onto the painting, and a render pass writes the painting to the canvas.
//
// Grain is read relative to its own mean paint (its smallest mip): where it holds less paint than on average it cuts
// the stamp in proportion, and where more it leaves it whole, so its texture shows at full strength without its
// overall tone thinning every stroke.

import type { StampBrushAsset, StampBrushLayer, StampDualBlend } from '../models/stamp-brush.ts';
import { visibleStampCountAt, type CompiledStampDeposit, type CompiledStampPaint, type StampRegion } from '../models/stamp-paint-recipe.ts';
import type { PlacedStamp } from '../models/stamp-placement.ts';
import { coarsestStampTipLevel, STAMP_TIP_HULL_SIDES, stampTipHull, type StampTipHull, type StampTipLevel } from '../models/stamp-tip-hull.ts';
import type { StampPaintPaper } from '../models/style.ts';
import { PAINT_DEPOSIT_WORDS, STAMP_PAINT_COMPOSITOR_WGSL, writePaintDeposit } from './stamp-paint-compositor.ts';
import { createStampPaintDevice, FULL_FRAME_WGSL, loadStampPaintImages, readStampTipLevels, type StampPaintImage } from './stamp-paint-gpu.ts';

/** Floats per stamp in the instance buffer: x, y, diameter, rotation, alpha. */
const STAMP_FLOATS = 5;

/**
 * How far a grain's texture is stretched about its mean. The pack's grains are soft photographs that Procreate
 * sharpens with each brush's grain contrast, which the import drops; this stands in for it, set by eye against the
 * previews.
 */
const GRAIN_CONTRAST = 2.5;

/** Bytes per uniform slot: every draw's uniforms sit at an offset WebGPU allows binding at (256). */
const SLOT = 256;

/** A compute pass's workgroup is 8 × 8 pixels. */
const WORKGROUP = 8;

const GRAIN_WGSL = /* wgsl */ `
fn grainCutOf(paint: f32, mean: f32, depth: f32, contrast: f32) -> f32 {
  return mix(1.0, clamp(1.0 + (paint / max(mean, 0.01) - 1.0) * contrast, 0.0, 1.0), depth);
}
fn grainMean(grain: texture_2d<f32>, tile: sampler) -> f32 {
  return 1.0 - textureSampleLevel(grain, tile, vec2f(0.5), 16.0).r;
}`;

// A stamp is drawn as its tip's hull (stamp-tip-hull.ts), a fan of triangles from its first corner, in the tip's UV
// square. Its place on the tip is interpolated, not worked out from its pixel: Apple's GPUs fetch a texel at an
// interpolated place before the shader runs, and a computed one took twice as long. The mask's rows run top first,
// as the painting's do, so y is flipped into clip space.
const STAMP_WGSL = /* wgsl */ `
struct StampDraw { resolution: vec2f, roundness: f32, rolling: u32, grainScale: f32, grainDepth: f32, hull: array<vec4f, ${STAMP_TIP_HULL_SIDES / 2}> }
@group(0) @binding(0) var<uniform> u: StampDraw;
@group(0) @binding(1) var tip: texture_2d<f32>;
@group(0) @binding(2) var grain: texture_2d<f32>;
@group(0) @binding(3) var linearClamp: sampler;
@group(0) @binding(4) var tile: sampler;
struct Corner { @builtin(position) position: vec4f, @location(0) tipUv: vec2f, @location(1) alpha: f32 }
${GRAIN_WGSL}
@vertex fn place(@builtin(vertex_index) i: u32, @location(0) stamp: vec4f, @location(1) alpha: f32) -> Corner {
  let pair = u.hull[i / 2u];
  let uv = select(pair.xy, pair.zw, (i & 1u) == 1u);
  let offset = (uv - 0.5) * vec2f(1.0, u.roundness) * stamp.z;
  let s = sin(stamp.w);
  let c = cos(stamp.w);
  let at = (stamp.xy + vec2f(c * offset.x - s * offset.y, s * offset.x + c * offset.y)) / u.resolution * 2.0 - 1.0;
  return Corner(vec4f(at.x, -at.y, 0.0, 1.0), uv, alpha);
}
@fragment fn cover(corner: Corner) -> @location(0) vec4f {
  var coverage = 1.0 - textureSample(tip, linearClamp, corner.tipUv).r;
  if (u.rolling == 1u) {
    let paint = 1.0 - textureSample(grain, tile, (corner.tipUv - 0.5) / u.grainScale + 0.5).r;
    coverage *= grainCutOf(paint, grainMean(grain, tile), u.grainDepth, ${GRAIN_CONTRAST.toFixed(1)});
  }
  // The pipeline's write mask keeps the brush's channel or its dual's.
  return vec4f(coverage * corner.alpha);
}`;

const BLUR_WGSL = /* wgsl */ `
struct Blur { sourceSize: vec2f, direction: vec2f, sigma: f32, origin: vec2u, extent: vec2u }
@group(0) @binding(0) var<uniform> u: Blur;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var blurred: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var linearClamp: sampler;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn blur(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(blurred);
  let pixel = u.origin + id.xy;
  if (any(id.xy >= u.extent) || any(pixel >= size)) { return; }
  let uv = (vec2f(pixel) + 0.5) / vec2f(size);
  let step = u.direction / u.sourceSize;
  let reach = i32(min(40.0, ceil(u.sigma * 2.5)));
  var sum = vec4f(0.0);
  var total = 0.0;
  for (var i = -reach; i <= reach; i++) {
    let w = exp(-0.5 * f32(i * i) / (u.sigma * u.sigma));
    sum += textureSampleLevel(source, linearClamp, uv + step * f32(i), 0.0) * w;
    total += w;
  }
  textureStore(blurred, pixel, sum / total);
}`;

// A compute pass has no derivatives to choose a mip level by, so each grain's level is worked out on the CPU: a tile
// is a fixed number of pixels across the whole painting, so it reads the same level everywhere.
const DEPOSIT_WGSL = /* wgsl */ `
${STAMP_PAINT_COMPOSITOR_WGSL}
struct Deposit {
  paint: PaintDeposit,
  resolution: vec2f, edges: vec2f, dualEdges: vec2f, grainTile: vec2f, dualGrainTile: vec2f, paperTile: vec2f,
  grainDepth: f32, dualGrainDepth: f32, paperDepth: f32, grainLod: f32, dualGrainLod: f32, paperLod: f32,
  opacity: f32, dualBlend: i32, flags: u32, origin: vec2u, extent: vec2u,
}
const TEXTURIZED = 1u; const DUAL = 2u; const DUAL_TEXTURIZED = 4u; const PAPER = 8u; const PROTECTED = 16u; const CLIPPED = 32u; const CLIPS = 64u;
@group(0) @binding(0) var<uniform> u: Deposit;
@group(0) @binding(1) var mask: texture_2d<f32>;
@group(0) @binding(2) var blurred: texture_2d<f32>;
@group(0) @binding(3) var grain: texture_2d<f32>;
@group(0) @binding(4) var dualGrain: texture_2d<f32>;
@group(0) @binding(5) var paperGrain: texture_2d<f32>;
@group(0) @binding(6) var protect: texture_2d<f32>;
@group(0) @binding(7) var clip: texture_storage_2d<rgba16float, read_write>;
@group(0) @binding(8) var layer: texture_storage_2d<rgba16float, read_write>;
@group(0) @binding(9) var linearClamp: sampler;
@group(0) @binding(10) var tile: sampler;
${GRAIN_WGSL}
fn grainCut(g: texture_2d<f32>, uv: vec2f, lod: f32, depth: f32, contrast: f32) -> f32 {
  return grainCutOf(1.0 - textureSampleLevel(g, tile, uv, lod).r, grainMean(g, tile), depth, contrast);
}

// A wet edge thins the body and gathers pigment in a rim; a burnt edge darkens the rim alone.
fn edged(a: f32, soft: f32, strength: vec2f) -> f32 {
  if (strength.x <= 0.0 && strength.y <= 0.0) { return a; }
  let rim = clamp((a - soft) * 4.0, 0.0, 1.0);
  return clamp(a * (1.0 - 0.35 * strength.x) + rim * (0.7 * strength.x + 1.1 * strength.y), 0.0, 1.0);
}

// The dual brush's coverage d combined with the brush's m by its blend (as DUAL_BLENDS orders them), each coverage read
// as the brightness of white paint, as Procreate's layer blends read it; then held to where the brush has paint.
fn combined(m: f32, d: f32) -> f32 {
  var c = m * d;
  switch (u.dualBlend) {
    case 0: { c = d; }
    case 2: { c = m + d - m * d; }
    case 3: { c = select(1.0 - 2.0 * (1.0 - m) * (1.0 - d), 2.0 * m * d, m < 0.5); }
    case 4: { c = min(m, d); }
    case 5: { c = max(m, d); }
    case 6: { c = select(1.0 - min(1.0, (1.0 - m) / d), 0.0, d <= 0.0); }
    case 7: { c = abs(m - d); }
    case 8: { c = max(0.0, m + d - 1.0); }
    default: {}
  }
  return c * clamp(m * 8.0, 0.0, 1.0);
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn deposit(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let at = vec2f(pixel) + 0.5;
  let raw = textureLoad(mask, pixel, 0);
  let soft = textureSampleLevel(blurred, linearClamp, at / u.resolution, 0.0);
  var m = edged(raw.r, soft.r, u.edges);
  if ((u.flags & TEXTURIZED) != 0u) { m *= grainCut(grain, at / u.grainTile, u.grainLod, u.grainDepth, ${GRAIN_CONTRAST.toFixed(1)}); }
  if ((u.flags & DUAL) != 0u) {
    var d = edged(raw.g, soft.g, u.dualEdges);
    if ((u.flags & DUAL_TEXTURIZED) != 0u) { d *= grainCut(dualGrain, at / u.dualGrainTile, u.dualGrainLod, u.dualGrainDepth, ${GRAIN_CONTRAST.toFixed(1)}); }
    m = combined(m, d);
  }
  // A paper's tooth was photographed, not drawn as a brush grain is, and needs no stretching.
  if ((u.flags & PAPER) != 0u) { m *= grainCut(paperGrain, at / u.paperTile, u.paperLod, u.paperDepth, 1.0); }
  if ((u.flags & PROTECTED) != 0u) { m *= 1.0 - textureLoad(protect, pixel, 0).r; }
  let clipped = textureLoad(clip, pixel);
  if ((u.flags & CLIPPED) != 0u) { m *= clamp(clipped.r, 0.0, 1.0); }
  let coverage = clamp(m, 0.0, 1.0) * u.opacity;
  textureStore(layer, pixel, depositPaint(textureLoad(layer, pixel), u.paint, coverage));
  if ((u.flags & CLIPS) != 0u) { textureStore(clip, pixel, vec4f(coverage) + clipped * (1.0 - coverage)); }
}`;

const GROUP_WGSL = /* wgsl */ `
${STAMP_PAINT_COMPOSITOR_WGSL}
struct Group { opacity: f32, glaze: u32, origin: vec2u, extent: vec2u }
@group(0) @binding(0) var<uniform> u: Group;
@group(0) @binding(1) var layer: texture_2d<f32>;
@group(0) @binding(2) var painting: texture_storage_2d<rgba16float, read_write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn group(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  textureStore(painting, pixel, groupPaint(textureLoad(painting, pixel), textureLoad(layer, pixel, 0), u.glaze == 1u, u.opacity));
}`;

const PAPER_WGSL = /* wgsl */ `
struct Paper { color: vec3f, hasImage: u32, cover: vec2f, lod: f32 }
@group(0) @binding(0) var<uniform> u: Paper;
@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(2) var painting: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var linearClamp: sampler;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn paper(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(painting);
  if (any(id.xy >= size)) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
  var color = u.color;
  if (u.hasImage == 1u) { color = textureSampleLevel(image, linearClamp, (uv - 0.5) * u.cover + 0.5, u.lod).rgb; }
  textureStore(painting, id.xy, vec4f(color, 1.0));
}`;

const OUTPUT_WGSL = /* wgsl */ `
${FULL_FRAME_WGSL}
@group(0) @binding(0) var painting: texture_2d<f32>;
@fragment fn output(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let pixel = vec2u(at.xy);
  let color = textureLoad(painting, pixel, 0).rgb;
  // An ordered dither, the same each frame, so a smooth wash doesn't band when the half floats become bytes.
  let dither = (fract(dot(vec2f(pixel), vec2f(0.7548776662, 0.5698402910))) - 0.5) / 255.0;
  return vec4f(clamp(color + dither, vec3f(0.0), vec3f(1.0)), 1.0);
}`;

const REGION_WGSL = /* wgsl */ `
struct Region { resolution: vec2f, ellipse: u32, shape: vec4f }
@group(0) @binding(0) var<uniform> u: Region;
@vertex fn place(@location(0) point: vec2f) -> @builtin(position) vec4f {
  let at = point / u.resolution * 2.0 - 1.0;
  return vec4f(at.x, -at.y, 0.0, 1.0);
}
@fragment fn fill(@builtin(position) at: vec4f) -> @location(0) vec4f {
  if (u.ellipse == 1u) {
    let d = (at.xy - u.shape.xy) / u.shape.zw;
    if (dot(d, d) > 1.0) { discard; }
  }
  return vec4f(1.0);
}`;

const COPY_WGSL = /* wgsl */ `
${FULL_FRAME_WGSL}
@group(0) @binding(0) var source: texture_2d<f32>;
@fragment fn copy(@builtin(position) at: vec4f) -> @location(0) vec4f { return textureLoad(source, vec2u(at.xy), 0); }`;

const DUAL_BLENDS: readonly StampDualBlend[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'colorBurn', 'difference', 'linearHeight'];

const assetKey = ({ style, pack, file }: StampBrushAsset) => `${style}/${pack}/${file}`;

/** Every image a painting and its paper need, each once, with how it wraps: a grain tiles, a tip or photograph doesn't. */
function paintingImages(painting: CompiledStampPaint, paper: StampPaintPaper): [StampBrushAsset, 'tile' | 'clamp'][] {
  const assets = painting.groups.flatMap((group) => group.passes.flatMap((pass) => pass.deposits.flatMap(({ brush }) =>
    [brush, ...(brush.dual ? [brush.dual] : [])].flatMap((layer): [StampBrushAsset, 'tile' | 'clamp'][] => [[layer.tip.image, 'clamp'], ...(layer.grain ? [[layer.grain.image, 'tile'] satisfies [StampBrushAsset, 'tile']] : [])]))));
  if (paper.image) assets.push([paper.image, 'clamp']);
  if (paper.grain) assets.push([paper.grain.image, 'tile']);
  return [...new Map(assets.map((entry) => [assetKey(entry[0]), entry])).values()];
}

type Box = { x: number; y: number; w: number; h: number };

/** Stamps whose bounds are kept together: a box is found from the chunks before it and the stamps within its own. */
const REACH_CHUNK = 256;

/**
 * How far `stamps` reach, for each whole chunk of them from the first: x0, y0, x1, y1 of stamps 0 to the chunk's end.
 * A stamp's corners reach 0.75 of its diameter from its centre, however it's turned.
 */
function stampReach(stamps: readonly PlacedStamp[]): Float64Array {
  const chunks = new Float64Array(Math.floor(stamps.length / REACH_CHUNK) * 4);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < chunks.length / 4 * REACH_CHUNK; i++) {
    const s = stamps[i], r = s.diameter * 0.75;
    x0 = Math.min(x0, s.x - r); y0 = Math.min(y0, s.y - r); x1 = Math.max(x1, s.x + r); y1 = Math.max(y1, s.y + r);
    if ((i + 1) % REACH_CHUNK === 0) chunks.set([x0, y0, x1, y1], ((i + 1) / REACH_CHUNK - 1) * 4);
  }
  return chunks;
}

/** Grows `into` (x0, y0, x1, y1) by where the first `count` of `stamps` reach, from their chunks and the rest. */
function reachOfFirst(stamps: readonly PlacedStamp[], chunks: Float64Array, count: number, into: number[]) {
  const whole = Math.floor(count / REACH_CHUNK);
  if (whole) {
    const at = (whole - 1) * 4;
    into[0] = Math.min(into[0], chunks[at]); into[1] = Math.min(into[1], chunks[at + 1]);
    into[2] = Math.max(into[2], chunks[at + 2]); into[3] = Math.max(into[3], chunks[at + 3]);
  }
  for (let i = whole * REACH_CHUNK; i < count; i++) {
    const s = stamps[i], r = s.diameter * 0.75;
    into[0] = Math.min(into[0], s.x - r); into[1] = Math.min(into[1], s.y - r); into[2] = Math.max(into[2], s.x + r); into[3] = Math.max(into[3], s.y + r);
  }
}

/** A deposit as the GPU holds it: where its stamps and dual stamps start in the instance buffer, and what's fixed. */
type LoadedDeposit = {
  main: number; dual: number;
  mainReach: Float64Array; dualReach: Float64Array;
  mainHull: StampTipHull; dualHull: StampTipHull | null;
  /** Its protected regions' triangles in the region buffer: [first vertex, vertex count, ellipse or null] for each. */
  regions: [number, number, Extract<StampRegion, { kind: 'ellipse' }> | null][];
};

export type StampPaintRenderer = {
  /** Draws `painting` as it stands `t` seconds into its scene. */
  draw: (t: number) => void;
  /** Resolves once the GPU has finished what's been drawn: for timing a draw, which a render never needs. */
  finish: () => Promise<void>;
  dispose: () => void;
};

/** Whole-painting draws at load before a renderer gives up on its drawing settling (see createStampPaintRenderer). */
const MAX_SETTLING_DRAWS = 8;

/**
 * A renderer for one painting on `canvas`, `width` by `height` of the painting's pixels; `imageUrl` maps each image
 * to its URL. It resolves once every image is on the GPU and its drawing has settled: a renderer's first draw or two
 * of a painting round a few pixels differently from every later one (on Apple's GPUs, in WebGPU and WebGL alike, for
 * reasons not pinned down), so it draws the whole painting until two draws in a row give the same half-float pixels,
 * and throws those draws away. Without that, a frame would depend on whether it was a tab's first.
 */
export async function createStampPaintRenderer(
  canvas: HTMLCanvasElement, painting: CompiledStampPaint, paper: StampPaintPaper, width: number, height: number, imageUrl: (asset: StampBrushAsset) => string,
): Promise<StampPaintRenderer> {
  const device = await createStampPaintDevice();
  try {
    return await rendererOnDevice(device, canvas, painting, paper, width, height, imageUrl);
  } catch (error) {
    // Destroying the device frees every texture and buffer made on it, and unconfigures the canvas.
    device.destroy();
    throw error;
  }
}

async function rendererOnDevice(
  device: GPUDevice, canvas: HTMLCanvasElement, painting: CompiledStampPaint, paper: StampPaintPaper, width: number, height: number, imageUrl: (asset: StampBrushAsset) => string,
): Promise<StampPaintRenderer> {
  // Loading and the first draw are checked for any error WebGPU would otherwise report only later, unasked.
  const SCOPES = ['validation', 'out-of-memory', 'internal'] as const;
  for (const scope of SCOPES) device.pushErrorScope(scope);
  let failure: string | null = null;
  void device.lost.then((info) => { if (info.reason !== 'destroyed') failure ??= `the GPU device was lost: ${info.message}`; });
  device.addEventListener('uncapturederror', (event) => { failure ??= (event as GPUUncapturedErrorEvent).error.message; });
  const context = canvas.getContext('webgpu') as GPUCanvasContext;
  const format: GPUTextureFormat = 'rgba8unorm';
  context.configure({ device, format, alphaMode: 'opaque' });

  const assets = paintingImages(painting, paper);
  // The paper's photograph is the one image whose colour is read.
  const isPhotograph = (asset: StampBrushAsset) => !!paper.image && assetKey(asset) === assetKey(paper.image);
  const loaded = await loadStampPaintImages(device, assets.map(([asset]) => ({ url: imageUrl(asset), channels: isPhotograph(asset) ? 'colour' : 'red' })));
  const images = new Map(assets.map(([asset], i) => [assetKey(asset), loaded[i]]));
  const image = (asset: StampBrushAsset) => images.get(assetKey(asset))!;

  // Each tip's paint at every mip level, for its hulls.
  const tips = assets.filter(([asset, wrap]) => wrap === 'clamp' && !isPhotograph(asset));
  const tipLevels = new Map<string, StampTipLevel[]>(await Promise.all(tips.map(async ([asset]) => [assetKey(asset), await readStampTipLevels(device, image(asset))] as const)));
  const hulls = new Map<string, StampTipHull>();
  /** The hull `layer`'s tip is drawn in when its smallest stamp is `smallest` px across. */
  function tipHull(layer: StampBrushLayer, stamps: readonly PlacedStamp[]): StampTipHull {
    const smallest = stamps.reduce((least, s) => Math.min(least, s.diameter), Infinity);
    const levels = tipLevels.get(assetKey(layer.tip.image))!;
    const coarsest = coarsestStampTipLevel(levels[0], smallest, layer.tip.roundness, levels.length);
    const key = `${assetKey(layer.tip.image)}@${coarsest}`;
    if (!hulls.has(key)) hulls.set(key, stampTipHull(levels, coarsest));
    return hulls.get(key)!;
  }

  // Every deposit's stamps, then its dual's, in one buffer, and its protected regions' triangles in another.
  const deposits = new Map<CompiledStampDeposit, LoadedDeposit>();
  const regionPoints: number[] = [];
  let total = 0, slotsPerFrame = 1;
  for (const group of painting.groups) {
    slotsPerFrame += 1;
    for (const pass of group.passes) for (const deposit of pass.deposits) {
      const regions = deposit.protectedBy.map((region): LoadedDeposit['regions'][number] => {
        const first = regionPoints.length / 2;
        if (region.kind === 'ellipse') {
          const { x, y, radiusX: rx, radiusY: ry } = region;
          regionPoints.push(x - rx, y - ry, x + rx, y - ry, x + rx, y + ry, x - rx, y - ry, x + rx, y + ry, x - rx, y + ry);
          return [first, 6, region];
        }
        const [a] = region.points;
        for (let i = 1; i + 1 < region.points.length; i++) regionPoints.push(a.x, a.y, region.points[i].x, region.points[i].y, region.points[i + 1].x, region.points[i + 1].y);
        return [first, regionPoints.length / 2 - first, null];
      });
      deposits.set(deposit, {
        main: total, dual: total + deposit.stamps.length,
        mainReach: stampReach(deposit.stamps), dualReach: stampReach(deposit.dualStamps),
        mainHull: tipHull(deposit.brush, deposit.stamps), dualHull: deposit.brush.dual ? tipHull(deposit.brush.dual, deposit.dualStamps) : null,
        regions,
      });
      total += deposit.stamps.length + deposit.dualStamps.length;
      // Its stamps and dual's, two blur passes, its resolve, and each region.
      slotsPerFrame += 5 + regions.length;
    }
  }
  const stampData = new Float32Array(Math.max(1, total) * STAMP_FLOATS);
  const write = (stamps: readonly PlacedStamp[], at: number) => stamps.forEach((s, i) => stampData.set([s.x, s.y, s.diameter, s.rotation, s.alpha], (at + i) * STAMP_FLOATS));
  for (const [deposit, { main, dual }] of deposits) {
    write(deposit.stamps, main);
    write(deposit.dualStamps, dual);
  }
  const buffer = (data: Float32Array | Uint16Array, usage: number) => {
    const made = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage: usage | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(made, 0, data.buffer, data.byteOffset, Math.ceil(data.byteLength / 4) * 4);
    return made;
  };
  const stampBuffer = buffer(stampData, GPUBufferUsage.VERTEX);
  const regionBuffer = buffer(new Float32Array(regionPoints), GPUBufferUsage.VERTEX);
  // The fan's triangles, by corner: indexed, so each corner is shaded once a stamp, not once for each triangle it's in.
  const fanBuffer = buffer(new Uint16Array(Array.from({ length: STAMP_TIP_HULL_SIDES - 2 }, (_, i) => [0, i + 1, i + 2]).flat()), GPUBufferUsage.INDEX);

  // Each frame's uniforms, a slot per pass, written into `staging` as the frame is encoded and uploaded before it's
  // submitted. A slot is zeroed before it's filled, so no field keeps what an earlier pass left there.
  const uniforms = device.createBuffer({ size: slotsPerFrame * SLOT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const staging = new ArrayBuffer(slotsPerFrame * SLOT);
  const stagedFloats = new Float32Array(staging), stagedInts = new Int32Array(staging), stagedWords = new Uint32Array(staging);
  let slots = 0;
  /** A zeroed slot filled by `fill`, which writes its words from 0 into the views it's given. */
  const slot = (fill: (floats: Float32Array, ints: Int32Array, words: Uint32Array) => void): GPUBufferBinding => {
    const offset = slots++ * SLOT, word = offset / 4, words = SLOT / 4;
    stagedWords.fill(0, word, word + words);
    fill(stagedFloats.subarray(word, word + words), stagedInts.subarray(word, word + words), stagedWords.subarray(word, word + words));
    return { buffer: uniforms, offset, size: SLOT };
  };

  const linearClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
  // Tiles are mirrored: the pack's grains aren't all seamless, and a mirrored tile never shows a seam.
  const tile = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'mirror-repeat', addressModeV: 'mirror-repeat' });

  const maxBlend: GPUBlendState = { color: { operation: 'max', srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'max', srcFactor: 'one', dstFactor: 'one' } };
  // A build stroke's stamps each lay over what it has so far: c ← s + c(1 − s).
  const buildBlend: GPUBlendState = { color: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src' } };
  // Even-odd fill without a stencil: each fan triangle inverts what's under it, so a pixel inside an odd number of them
  // ends up set, whatever the polygon's shape.
  const invertBlend: GPUBlendState = { color: { operation: 'add', srcFactor: 'one-minus-dst', dstFactor: 'zero' }, alpha: { operation: 'add', srcFactor: 'one-minus-dst-alpha', dstFactor: 'zero' } };
  const stampModule = device.createShaderModule({ code: STAMP_WGSL });
  const stampPipeline = (blend: GPUBlendState, writeMask: number) => device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: stampModule, buffers: [{ arrayStride: STAMP_FLOATS * 4, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32' }] }] },
    fragment: { module: stampModule, targets: [{ format: 'rg16float', blend, writeMask }] },
  });
  const stampPipelines = {
    glaze: [stampPipeline(maxBlend, GPUColorWrite.RED), stampPipeline(maxBlend, GPUColorWrite.GREEN)],
    build: [stampPipeline(buildBlend, GPUColorWrite.RED), stampPipeline(buildBlend, GPUColorWrite.GREEN)],
  };
  const computePipeline = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });
  const pipelines = { blur: computePipeline(BLUR_WGSL), deposit: computePipeline(DEPOSIT_WGSL), group: computePipeline(GROUP_WGSL), paper: computePipeline(PAPER_WGSL) };
  const outputModule = device.createShaderModule({ code: OUTPUT_WGSL });
  const outputPipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: outputModule }, fragment: { module: outputModule, targets: [{ format }] } });
  const regionModule = device.createShaderModule({ code: REGION_WGSL });
  const regionPipeline = (blend: GPUBlendState) => device.createRenderPipeline({
    layout: 'auto', vertex: { module: regionModule, buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
    fragment: { module: regionModule, targets: [{ format: 'r8unorm', blend }] },
  });
  const ellipsePipeline = regionPipeline(maxBlend), polygonPipeline = regionPipeline(invertBlend);
  const copyModule = device.createShaderModule({ code: COPY_WGSL });
  const copyMaxPipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: copyModule }, fragment: { module: copyModule, targets: [{ format: 'r8unorm', blend: maxBlend }] } });

  const target = (w: number, h: number, usage: number, targetFormat: GPUTextureFormat = 'rgba16float') => {
    const texture = device.createTexture({ size: [w, h], format: targetFormat, usage: usage | GPUTextureUsage.TEXTURE_BINDING });
    return { texture, view: texture.createView() };
  };
  const RENDER = GPUTextureUsage.RENDER_ATTACHMENT, STORAGE = GPUTextureUsage.STORAGE_BINDING;
  const halfW = Math.ceil(width / 2), halfH = Math.ceil(height / 2);
  const targets = {
    // Read back while the renderer settles.
    painting: target(width, height, STORAGE | GPUTextureUsage.COPY_SRC),
    layer: target(width, height, STORAGE | RENDER),
    mask: target(width, height, RENDER, 'rg16float'),
    blurA: target(halfW, halfH, STORAGE),
    blurB: target(halfW, halfH, STORAGE),
    clip: target(width, height, STORAGE | RENDER),
    protect: target(width, height, RENDER, 'r8unorm'),
    region: target(width, height, RENDER, 'r8unorm'),
    blank: target(1, 1, 0, 'r8unorm'),
  };

  const bindGroup = (pipeline: GPURenderPipeline | GPUComputePipeline, resources: GPUBindingResource[]) =>
    device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: resources.map((resource, binding) => ({ binding, resource })) });
  const clear = (encoder: GPUCommandEncoder, view: GPUTextureView) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }).end();
  const dispatch = (encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, resources: GPUBindingResource[], w: number, h: number) => {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup(pipeline, resources));
    pass.dispatchWorkgroups(Math.ceil(w / WORKGROUP), Math.ceil(h / WORKGROUP));
    pass.end();
  };
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  /** The mip level a grain `texture` tiled `tileW` pixels across reads: texels per pixel, as a fragment's derivatives would say. */
  const grainLod = (texture: StampPaintImage, tileW: number) => Math.max(0, Math.log2(texture.width / tileW));

  function drawStamps(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, loaded: LoadedDeposit, count: number, dualCount: number, box: Box) {
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: targets.mask.view, loadOp: 'clear', storeOp: 'store' }] });
    pass.setScissorRect(box.x, box.y, box.w, box.h);
    pass.setIndexBuffer(fanBuffer, 'uint16');
    const stamp = (layer: StampBrushLayer, first: number, n: number, hull: StampTipHull, channel: 0 | 1) => {
      if (!n) return;
      const pipeline = stampPipelines[layer.accumulation][channel];
      const rolling = layer.grain?.mode === 'rolling' && layer.grain.depth > 0;
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup(pipeline, [
        slot((floats, _ints, words) => {
          floats.set([width, height, layer.tip.roundness]);
          words[3] = rolling ? 1 : 0;
          floats.set([layer.grain?.scale ?? 1, layer.grain?.depth ?? 0], 4);
          floats.set(hull, 8);
        }),
        image(layer.tip.image).view, rolling ? image(layer.grain!.image).view : targets.blank.view, linearClamp, tile,
      ]));
      pass.setVertexBuffer(0, stampBuffer, first * STAMP_FLOATS * 4);
      pass.drawIndexed((hull.length / 2 - 2) * 3, n);
    };
    stamp(deposit.brush, loaded.main, count, loaded.mainHull, 0);
    if (deposit.brush.dual) stamp(deposit.brush.dual, loaded.dual, dualCount, loaded.dualHull!, 1);
    pass.end();
  }

  function blurMask(encoder: GPUCommandEncoder, sigma: number, box: Box) {
    const half = { x: Math.floor(box.x / 2), y: Math.floor(box.y / 2), w: Math.ceil(box.w / 2) + 1, h: Math.ceil(box.h / 2) + 1 };
    const blur = (source: GPUTextureView, sourceSize: [number, number], into: GPUTextureView, direction: [number, number]) => dispatch(encoder, pipelines.blur, [
      slot((floats, _ints, words) => {
        floats.set([...sourceSize, ...direction, Math.max(0.5, sigma / 2)]);
        words.set([half.x, half.y, half.w, half.h], 6);
      }),
      source, into, linearClamp,
    ], half.w, half.h);
    // Sampling the full-size mask at half size, at a texel's corner, averages four pixels: a box before the blur.
    blur(targets.mask.view, [width, height], targets.blurA.view, [2, 0]);
    blur(targets.blurA.view, [halfW, halfH], targets.blurB.view, [0, 1]);
  }

  function drawProtect(encoder: GPUCommandEncoder, regions: LoadedDeposit['regions']) {
    const region = (pipeline: GPURenderPipeline, first: number, count: number, ellipse: LoadedDeposit['regions'][number][2]) => (pass: GPURenderPassEncoder) => {
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup(pipeline, [slot((floats, _ints, words) => {
        floats.set([width, height]);
        if (ellipse) {
          words[2] = 1;
          floats.set([ellipse.x, ellipse.y, ellipse.radiusX, ellipse.radiusY], 4);
        }
      })]));
      pass.setVertexBuffer(0, regionBuffer);
      pass.draw(count, 1, first);
    };
    const into = (view: GPUTextureView, loadOp: GPULoadOp, draw: (pass: GPURenderPassEncoder) => void) => {
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp, storeOp: 'store' }] });
      draw(pass);
      pass.end();
    };
    into(targets.protect.view, 'clear', (pass) => {
      for (const [first, count, ellipse] of regions) if (ellipse) region(ellipsePipeline, first, count, ellipse)(pass);
    });
    // A polygon is filled alone, then joins the others by max.
    for (const [first, count, ellipse] of regions) {
      if (ellipse) continue;
      into(targets.region.view, 'clear', region(polygonPipeline, first, count, null));
      into(targets.protect.view, 'load', (pass) => {
        pass.setPipeline(copyMaxPipeline);
        pass.setBindGroup(0, bindGroup(copyMaxPipeline, [targets.region.view]));
        pass.draw(3);
      });
    }
  }

  function resolveDeposit(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, clipped: boolean, blurred: boolean, box: Box) {
    const { brush } = deposit;
    const texturized = (layer?: StampBrushLayer) => !!layer?.grain && layer.grain.mode === 'texturized' && layer.grain.depth > 0;
    /** A texturized grain's tile, a share of the stamp's diameter across, and its mip level. */
    const tileOf = (layer: StampBrushLayer): [number, number, number] => {
      const grain = image(layer.grain!.image), size = layer.grain!.scale * deposit.diameter;
      return [size, size * (grain.height / grain.width), grainLod(grain, size)];
    };
    const edgesOf = (layer?: StampBrushLayer) => (blurred && layer ? [layer.wetEdge?.strength ?? 0, layer.burntEdge?.strength ?? 0] : [0, 0]);
    const tooth = paper.grain && paper.grain.depth > 0 ? paper.grain : undefined;
    const main = texturized(brush) ? tileOf(brush) : [1, 1, 0];
    const dual = texturized(brush.dual) ? tileOf(brush.dual!) : [1, 1, 0];
    let paperTile = [1, 1, 0];
    if (tooth) {
      const grain = image(tooth.image), size = tooth.scale * width;
      paperTile = [size, size * (grain.height / grain.width), grainLod(grain, size)];
    }
    const protectedBy = deposit.protectedBy.length > 0;
    dispatch(encoder, pipelines.deposit, [
      slot((floats, ints, words) => {
        writePaintDeposit(floats, ints, 0, deposit.material, deposit.blend);
        const at = PAINT_DEPOSIT_WORDS;
        floats.set([width, height, ...edgesOf(brush), ...edgesOf(brush.dual), main[0], main[1], dual[0], dual[1], paperTile[0], paperTile[1]], at);
        floats.set([brush.grain?.depth ?? 0, brush.dual?.grain?.depth ?? 0, tooth?.depth ?? 0, main[2], dual[2], paperTile[2], deposit.opacity], at + 12);
        ints[at + 19] = brush.dual ? DUAL_BLENDS.indexOf(brush.dual.blend) : 0;
        words[at + 20] = (texturized(brush) ? 1 : 0) | (brush.dual ? 2 : 0) | (texturized(brush.dual) ? 4 : 0) | (tooth ? 8 : 0) | (protectedBy ? 16 : 0) | (clipped ? 32 : 64);
        // Past the flags' word, the origin sits on an 8-byte boundary.
        words.set([box.x, box.y, box.w, box.h], at + 22);
      }),
      targets.mask.view, blurred ? targets.blurB.view : targets.mask.view,
      texturized(brush) ? image(brush.grain!.image).view : targets.blank.view,
      texturized(brush.dual) ? image(brush.dual!.grain!.image).view : targets.blank.view,
      tooth ? image(tooth.image).view : targets.blank.view,
      targets.protect.view, targets.clip.view, targets.layer.view, linearClamp, tile,
    ], box.w, box.h);
  }

  /** The pixels a deposit's first `count` stamps (and dual stamps) reach, padded for its edges' blur, or null. */
  function depositBox(deposit: CompiledStampDeposit, loaded: LoadedDeposit, count: number, dualCount: number, pad: number): Box | null {
    const reach = [Infinity, Infinity, -Infinity, -Infinity];
    reachOfFirst(deposit.stamps, loaded.mainReach, count, reach);
    reachOfFirst(deposit.dualStamps, loaded.dualReach, dualCount, reach);
    const x = Math.max(0, Math.floor(reach[0] - pad)), y = Math.max(0, Math.floor(reach[1] - pad));
    const w = Math.min(width, Math.ceil(reach[2] + pad)) - x, h = Math.min(height, Math.ceil(reach[3] + pad)) - y;
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  }

  function drawPaper(encoder: GPUCommandEncoder) {
    const photograph = paper.image ? image(paper.image) : null;
    // Cover: the photograph fills the painting, cropped along whichever side it has to spare.
    const fit = photograph ? Math.max(width / photograph.width, height / photograph.height) : 1;
    dispatch(encoder, pipelines.paper, [
      slot((floats, _ints, words) => {
        floats.set(rgb(paper.color));
        if (!photograph) return;
        words[3] = 1;
        floats.set([width / (photograph.width * fit), height / (photograph.height * fit), Math.max(0, Math.log2(1 / fit))], 4);
      }),
      photograph?.view ?? targets.blank.view, targets.painting.view, linearClamp,
    ], width, height);
  }

  function draw(t: number) {
    if (failure) throw new Error(`stamp paint: ${failure}`);
    slots = 0;
    const encoder = device.createCommandEncoder();
    drawPaper(encoder);
    for (const group of painting.groups) {
      clear(encoder, targets.layer.view);
      let painted: Box | null = null;
      for (const pass of group.passes) {
        if (!pass.clipTo) clear(encoder, targets.clip.view);
        for (const deposit of pass.deposits) {
          const count = visibleStampCountAt(deposit, t);
          if (!count) continue;
          const dualCount = visibleStampCountAt(deposit, t, 'dualStamps');
          const { brush } = deposit;
          const hasEdges = (layer?: StampBrushLayer) => !!layer && ((layer.wetEdge?.strength ?? 0) > 0 || (layer.burntEdge?.strength ?? 0) > 0);
          const blurred = hasEdges(brush) || hasEdges(brush.dual);
          // An edge's width is a share of the stamp's radius; the rim is where the mask stands above a blur that wide.
          const sigma = Math.max(1, Math.max(...[brush, brush.dual].flatMap((layer) => [layer?.wetEdge?.width ?? 0, layer?.burntEdge?.width ?? 0])) * deposit.diameter / 2);
          const loaded = deposits.get(deposit)!;
          const box = depositBox(deposit, loaded, count, dualCount, blurred ? sigma * 3 : 2);
          if (!box) continue;
          drawStamps(encoder, deposit, loaded, count, dualCount, box);
          if (blurred) blurMask(encoder, sigma, box);
          if (loaded.regions.length) drawProtect(encoder, loaded.regions);
          resolveDeposit(encoder, deposit, !!pass.clipTo, blurred, box);
          painted = painted ? union(painted, box) : box;
        }
      }
      if (!painted) continue;
      const box = painted;
      dispatch(encoder, pipelines.group, [
        slot((floats, _ints, words) => {
          floats[0] = group.opacity;
          words[1] = group.composite === 'glaze' ? 1 : 0;
          words.set([box.x, box.y, box.w, box.h], 2);
        }),
        targets.layer.view, targets.painting.view,
      ], box.w, box.h);
    }
    const out = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' }] });
    out.setPipeline(outputPipeline);
    out.setBindGroup(0, bindGroup(outputPipeline, [targets.painting.view]));
    out.draw(3);
    out.end();
    device.queue.writeBuffer(uniforms, 0, staging, 0, slots * SLOT);
    device.queue.submit([encoder.finish()]);
  }

  // The painting's half floats after a whole draw, to compare with the draw before (see above).
  const readRow = Math.ceil((width * 8) / 256) * 256;
  const readback = device.createBuffer({ size: readRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  async function drawWhole(): Promise<Uint32Array> {
    draw(Number.MAX_VALUE);
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: targets.painting.texture }, { buffer: readback, bytesPerRow: readRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const pixels = new Uint32Array(readback.getMappedRange().slice(0));
    readback.unmap();
    return pixels;
  }
  const same = (a: Uint32Array, b: Uint32Array) => a.every((word, i) => word === b[i]);
  let last = await drawWhole(), settled = false;
  for (let draws = 1; draws < MAX_SETTLING_DRAWS && !settled; draws++) {
    const next = await drawWhole();
    settled = same(last, next);
    last = next;
  }
  readback.destroy();
  for (const _ of SCOPES) {
    const error = await device.popErrorScope();
    if (error) throw new Error(`stamp paint: loading the painting onto the GPU failed: ${error.message}`);
  }
  if (!settled) {
    throw new Error(`stamp paint: ${MAX_SETTLING_DRAWS} draws of the whole painting never gave the same pixels twice in a row, so its frames can't repeat`);
  }

  // A painting whose inputs change in the same commit as its time is disposed before its last draw is asked for.
  let disposed = false;
  return {
    draw: (t) => {
      if (!disposed) draw(t);
    },
    finish: () => (disposed ? Promise.resolve() : device.queue.onSubmittedWorkDone()),
    dispose() {
      disposed = true;
      context.unconfigure();
      device.destroy();
    },
  };
}

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

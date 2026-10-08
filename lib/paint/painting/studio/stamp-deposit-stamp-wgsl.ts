// stamp-deposit-stamp-wgsl.ts: the WGSL laying a deposit's stamps into its mask and cap (stamp-deposit-drawing.ts),
// by fixed blend (a triangle fan a stamp) or in order (each texel walking its tile's stamps), and the grain both cut by.

import { COVERAGE_FORMULAS_WGSL, stampGrainModeIndex } from '#lib/paint/brush/models/coverage-formulas.ts';
import type { StampBrushGrain } from '#lib/paint/brush/models/stamp-brush.ts';
import { gpuUniformLayout, gpuUniformStruct, gpuUniformWriter, type GpuUniformViews } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_FULL_FRAME_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import { STAMP_ACCUMULATION_LAY_WGSL, STAMP_BLUR_LEVELS } from '../models/stamp-deposit-stages.ts';
import { STAMP_FLOATS, STAMP_ORDERED_TILE } from '../models/stamp-mark-load.ts';
import { stampStageWgsl, type StampStage } from '../models/stamp-stage.ts';
import { STAMP_TIP_HULL_SIDES } from '../models/stamp-tip-hull.ts';
import { STAMP_TIP_TOUCH_WGSL } from '../models/stamp-wet-contact.ts';
import type { StampPaintImage } from './stamp-paint-gpu.ts';

/**
 * A grain as its brush reads it: `place` is its tile (px) and offset (tiles), `shape` its depth, mip level, brightness
 * and contrast; `layer` whether its blend is a layer formula, `aboutMean` its contrast's pivot, `mirror` whether it
 * tiles mirrored.
 */
export const STAMP_GRAIN = gpuUniformLayout('Grain', [['place', 'vec4f'], ['shape', 'vec4f'], ['blend', 'i32'], ['layer', 'u32'], ['aboutMean', 'u32'], ['mirror', 'u32']]);

export const STAMP_GRAIN_WGSL = /* wgsl */ `
${COVERAGE_FORMULAS_WGSL}
${STAMP_GRAIN.wgsl}
// A grain image's mean paint: its smallest mip.
fn grainMean(g: texture_2d<f32>, tile: sampler) -> f32 { return 1.0 - textureSampleLevel(g, tile, vec2f(0.5), 16.0).r; }
// Coverage a cut by the grain's texel \`raw\` (as the image holds it, dark is paint), \`mean\` the grain's mean paint.
// \`share\`: the stamp's share of the grain's depth (STAMP_MARK.grainDepth), 1 for any grain but a rolling one's.
fn grained(a: f32, raw: f32, mean: f32, p: Grain, share: f32) -> f32 {
  return grainCut(a, grainPaint(1.0 - raw, p.shape.z, p.shape.w, p.aboutMean == 1u, mean), p.shape.x * share, p.blend, p.layer == 1u);
}`;

const STAMP_TURNED_WGSL = /* wgsl */ `
fn turned(v: vec2f, angle: f32) -> vec2f {
  let s = sin(angle);
  let c = cos(angle);
  return vec2f(c * v.x - s * v.y, s * v.x + c * v.y);
}`;

/** Pixels a hull side on the tip square's edge is pushed out by: past a rasterizer's subpixel snapping (8 bits on most). */
const STAMP_EDGE_SLIVER = (1 / 64).toFixed(6);
// A stamp is its tip's hull (stamp-tip-hull.ts) as a triangle fan, its tip place interpolated: Apple's GPUs fetch
// an interpolated place's texel before the shader runs; computing it took twice as long. A flip mirrors the hull,
// not its sampling, so the hull holds the paint. The tip's center lands on the stamp's place. Mask rows run top first.
export const STAMP_DRAW = gpuUniformLayout('StampDraw', [
  ['resolution', 'vec2f'], ['roundness', 'f32'], ['rolling', 'u32'], ['grain', gpuUniformStruct(STAMP_GRAIN)], ['diameter', 'f32'], ['zoom', 'f32'],
  ['movement', 'f32'], ['hull', { vec4fArray: STAMP_TIP_HULL_SIDES / 2 }], ['span', 'f32'], ['towardFull', 'u32'], ['center', 'vec2f'], ['noise', 'f32'], ['pressed', 'vec4f'],
  ['fullContact', 'f32'],
]);
export const stampDrawWgsl = (stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${STAMP_DRAW.wgsl}
@group(0) @binding(0) var<uniform> u: StampDraw;
@group(0) @binding(1) var tip: texture_2d<f32>;
@group(0) @binding(2) var grain: texture_2d<f32>;
// Clamped, and anisotropic or not as the tip's sampling says.
@group(0) @binding(3) var tipClamp: sampler;
@group(0) @binding(4) var tile: sampler;
// A pressed tip's contact image, blank when the tip has none (StampBrushTip's pressed, and u.pressed: softness, its
// range's low and high, and the diameter its contacts grow over, 0 for none).
@group(0) @binding(5) var contact: texture_2d<f32>;
struct Corner { @builtin(position) position: vec4f, @location(0) tipUv: vec2f, @location(1) alpha: f32, @location(2) @interpolate(flat) tipGrad: vec4f, @location(3) grainUv: vec2f, @location(4) tint: vec4f, @location(5) toward: f32, @location(6) grainDepth: f32, @location(7) noiseAt: vec2f, @location(8) @interpolate(flat) seed: u32, @location(9) @interpolate(flat) pressure: f32, @location(10) @interpolate(flat) grow: f32, @location(11) @interpolate(flat) grainGrad: vec4f }
struct Covered { @location(0) mask: vec4f, @location(1) cap: vec4f }
struct Stamp { @location(0) mask: vec4f, @location(1) cap: vec4f, @location(2) tintA: vec4f, @location(3) tintB: vec4f }
${STAMP_GRAIN_WGSL}
${STAMP_TURNED_WGSL}
// \`rest\`: where the stamp was placed, which seeds its noise and places its rolling grain, so a stamp a pose moved
// keeps its tip's, and a copy round a wrapping sheet's seam lays as its stamp does.
@vertex fn place(@builtin(vertex_index) i: u32, @location(0) stamp: vec4f, @location(1) more: vec4f, @location(2) tint: vec4f, @location(3) last: vec4f, @location(4) rest: vec2f) -> Corner {
  let pair = u.hull[i / 2u];
  let corner = select(pair.xy, pair.zw, (i & 1u) == 1u);
  let flips = u32(more.w);
  let mirror = vec2f(select(1.0, -1.0, (flips & 1u) != 0u), select(1.0, -1.0, (flips & 2u) != 0u));
  // Never thinner than a pixel: Photoshop's Flat brushes (roundness 0) sweep a hairline into a solid ribbon.
  let opacity = last.x;
  let squash = max(u.roundness * last.y, 1.0 / (stamp.z * u.span));
  // A pixel centre on the square's edge is covered on all four sides, as Photoshop and the ordered path cover it. The
  // rasterizer's top-left rule drops it on two sides, so a hull side on the square's edge (stampTipHull puts it there
  // exactly) is pushed out by a sliver of a pixel, whose clamped tip reads the edge texel.
  let edge = select(vec2f(0.0), vec2f(1.0), corner == vec2f(1.0)) - select(vec2f(0.0), vec2f(1.0), corner == vec2f(0.0));
  let scale = vec2f(1.0, squash) * stamp.z * u.span * mirror;
  let uv = corner + edge * ${STAMP_EDGE_SLIVER} / abs(scale);
  let local = turned((uv - u.center) * scale, stamp.w);
  // Tip and grain are sampled at their places' gradients over the painting, constant across a stamp (its place is
  // affine in the pixel), as the ordered path samples them. Warning: a fragment's own derivatives aren't
  // deterministic on Apple's GPUs: the same draw now and then lands a pixel a half-float step apart.
  let tipGrad = vec4f(turned(vec2f(1.0, 0.0), -stamp.w) / scale, turned(vec2f(0.0, 1.0), -stamp.w) / scale) * exp2(more.y * ${STAMP_BLUR_LEVELS.toFixed(1)});
  let at = (stamp.xy + local + vec2f(STAGE_MARGIN)) / u.resolution * 2.0 - 1.0;
  // A rolling grain turns with the stamp, grows with its size by zoom and travels the canvas by movement: at
  // movement 1 and constant size it lies still; as size or direction change it slides, a rolling grain's streak.
  let size = u.grain.place.xy * pow(stamp.z / u.diameter, u.zoom);
  let grainUv = turned(local, -more.z) / size + u.movement * rest / u.grain.place.xy + u.grain.place.zw;
  let grainGrad = vec4f(turned(vec2f(1.0, 0.0), -more.z) / size, turned(vec2f(0.0, 1.0), -more.z) / size);
  // A glaze or a build lays flow × opacity toward full; a buildToOpacity lays its flow toward its own opacity.
  let full = u.towardFull == 1u;
  // Noise goes by the tip's pixels at the stamp's width (tipNoiseAt), so it keeps its grain as a stamp shrinks.
  let grow = select(1.0, stamp.z / u.pressed.w, u.pressed.w > 0.0);
  return Corner(vec4f(at.x, -at.y, 0.0, 1.0), uv, select(more.x, more.x * opacity, full), tipGrad, grainUv, tint, select(opacity, 1.0, full), last.z, uv * stamp.z * u.span, stampNoiseSeed(rest), last.w, grow, grainGrad);
}
// A stamp's paint (x) and its cap (y): the paint without its tip, how far a glaze's stroke may build there. A rolling
// grain, carried by the stamp, cuts each one.
fn covered(corner: Corner) -> vec2f {
  var tipped = 1.0 - textureSampleGrad(tip, tipClamp, corner.tipUv, corner.tipGrad.xy, corner.tipGrad.zw).r;
  let touches = 1.0 - textureSampleGrad(contact, tipClamp, corner.tipUv, corner.tipGrad.xy, corner.tipGrad.zw).r;
  if (u.pressed.x > 0.0) { tipped = pressedTip(tipped, touches, corner.pressure, u.pressed.x, u.pressed.y, u.pressed.z, corner.grow); }
  if (u.noise > 0.0) { tipped = tipNoise(tipped, tipNoiseAt(u32(max(floor(corner.noiseAt.x), 0.0)), u32(max(floor(corner.noiseAt.y), 0.0)), corner.seed), u.noise); }
  var coverage = vec2f(tipped, 1.0);
  if (u.rolling == 1u) {
    let raw = textureSampleGrad(grain, tile, corner.grainUv, corner.grainGrad.xy, corner.grainGrad.zw).r;
    let mean = grainMean(grain, tile);
    coverage = vec2f(grained(tipped, raw, mean, u.grain, corner.grainDepth), grained(1.0, raw, mean, u.grain, corner.grainDepth));
  }
  return coverage * corner.alpha;
}
// The mask blends the stamp's paint as alpha over the stroke, toward full or its opacity (colour): B ← lerp(B, O, t·f),
// the layer's fixedBlend plan (stampAccumulationPlan). The pipeline's write masks keep the brush's channel or its
// dual's. A glaze keeps, by max, each pixel's cap (red, green) and its densest stamp (blue, alpha): its stroke builds
// up to the cap, as far as its build says.
@fragment fn cover(corner: Corner) -> Covered { let a = covered(corner); return Covered(vec4f(vec3f(corner.toward), a.x), a.yyxx); }
// A brush with colour dynamics also lays its tint, premultiplied by its coverage, over the tints before it.
@fragment fn coverTinted(corner: Corner) -> Stamp {
  let a = covered(corner);
  return Stamp(vec4f(vec3f(corner.toward), a.x), a.yyxx, vec4f(corner.tint.xyz * a.x, a.x), vec4f(corner.tint.w * a.x, 0.0, 0.0, a.x));
}
// 1 past the stamp's pressure wherever it lays paint, kept by max, so 0 is where no stamp laid any and a stamp at
// pressure 0 still shows (StampPaintCompositor's reads.press).
@fragment fn pressOf(corner: Corner) -> @location(0) vec4f { return vec4f(select(0.0, 1.0 + corner.pressure, covered(corner).x > 0.0)); }
// Where the tool touched (tipTouch, stampTipTouch's twin in stamp-wet-contact.ts): the tip's paint,
// pressed; no noise, grain, opacity or flow, which are paint. Kept by max.
@fragment fn touchOf(corner: Corner) -> @location(0) vec4f {
  let paint = 1.0 - textureSampleGrad(tip, tipClamp, corner.tipUv, corner.tipGrad.xy, corner.tipGrad.zw).r;
  let touches = 1.0 - textureSampleGrad(contact, tipClamp, corner.tipUv, corner.tipGrad.xy, corner.tipGrad.zw).r;
  let pressed = select(1.0, pressedTip(1.0, touches, corner.pressure, u.pressed.x, u.pressed.y, u.pressed.z, corner.grow), u.pressed.x > 0.0);
  return vec4f(tipTouch(paint, pressed, u.fullContact));
}
${STAMP_TIP_TOUCH_WGSL}`;

// An `ordered` layer is one triangle over the deposit's box: each texel walks its tile's stamps in order, laying each
// by its accumulation's lay. A stamp's tip place inverts the fixed path's vertex transform; tip and rolling grain are
// sampled at that path's interpolated gradients, the tip's grown by its blur as the fixed path's bias grows it.
export const STAMP_ORDERED_DRAW = gpuUniformLayout('OrderedDraw', [
  ['grain', gpuUniformStruct(STAMP_GRAIN)], ['roundness', 'f32'], ['rolling', 'u32'], ['diameter', 'f32'], ['zoom', 'f32'], ['movement', 'f32'],
  // `first`: the layer's first stamp's first float in its bound slice; `tint`: its first tint's index there.
  ['span', 'f32'], ['first', 'u32'], ['count', 'u32'], ['tint', 'u32'], ['bins', 'u32'], ['tilesX', 'u32'], ['accumulation', 'i32'], ['center', 'vec2f'], ['noise', 'f32'], ['pressed', 'vec4f'],
]);
export const stampOrderedDrawWgsl = (stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${GPU_FULL_FRAME_WGSL}
${STAMP_ORDERED_DRAW.wgsl}
@group(0) @binding(0) var<uniform> u: OrderedDraw;
@group(0) @binding(1) var tip: texture_2d<f32>;
@group(0) @binding(2) var grain: texture_2d<f32>;
@group(0) @binding(3) var tipClamp: sampler;
@group(0) @binding(4) var tile: sampler;
@group(0) @binding(5) var<storage, read> stamps: array<f32>;
@group(0) @binding(6) var<storage, read> tints: array<vec4f>;
// Each tile's first entry (one past the last after them), then each tile's stamps by index from the layer's first.
@group(0) @binding(7) var<storage, read> bins: array<u32>;
@group(0) @binding(8) var contact: texture_2d<f32>;
${STAMP_GRAIN_WGSL}
${STAMP_TURNED_WGSL}
${STAMP_ACCUMULATION_LAY_WGSL}
struct Laid { built: f32, tintA: vec4f, tintB: vec4f }
// \`p\`: a texel's centre on the stage, binned as stamps are (binOrderedStamps).
fn laidInOrder(p: vec2f, tinted: bool) -> Laid {
  let cell = u.bins + (u32(p.y) / ${STAMP_ORDERED_TILE}u) * u.tilesX + u32(p.x) / ${STAMP_ORDERED_TILE}u;
  var laid = Laid(0.0, vec4f(0.0), vec4f(0.0));
  var mean = 0.0;
  if (u.rolling == 1u) { mean = grainMean(grain, tile); }
  for (var k = bins[cell]; k < bins[cell + 1u]; k++) {
    let i = bins[k];
    // A tile's stamps are in order, so the first not yet visible ends it.
    if (i >= u.count) { break; }
    let at = u.first + i * ${STAMP_FLOATS}u;
    let xy = vec2f(stamps[at], stamps[at + 1u]);
    let z = stamps[at + 2u];
    let rotation = stamps[at + 3u];
    let flips = u32(stamps[at + 7u]);
    let mirror = vec2f(select(1.0, -1.0, (flips & 1u) != 0u), select(1.0, -1.0, (flips & 2u) != 0u));
    let squash = max(u.roundness * stamps[at + 9u], 1.0 / (z * u.span));
    let scale = vec2f(1.0, squash) * z * u.span * mirror;
    let local = p - vec2f(STAGE_MARGIN) - xy;
    let uv = turned(local, -rotation) / scale + u.center;
    // Outside its square a stamp lays nothing; inside it but outside its hull its tip is bare, as the fixed path's is.
    if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { continue; }
    let blur = exp2(stamps[at + 5u] * ${STAMP_BLUR_LEVELS.toFixed(1)});
    let dx = turned(vec2f(1.0, 0.0), -rotation) / scale * blur;
    let dy = turned(vec2f(0.0, 1.0), -rotation) / scale * blur;
    var a = 1.0 - textureSampleGrad(tip, tipClamp, uv, dx, dy).r;
    let touches = 1.0 - textureSampleGrad(contact, tipClamp, uv, dx, dy).r;
    if (u.pressed.x > 0.0) { a = pressedTip(a, touches, stamps[at + 11u], u.pressed.x, u.pressed.y, u.pressed.z, select(1.0, z / u.pressed.w, u.pressed.w > 0.0)); }
    if (u.noise > 0.0) {
      let noiseAt = max(floor(uv * z * u.span), vec2f(0.0));
      a = tipNoise(a, tipNoiseAt(u32(noiseAt.x), u32(noiseAt.y), stampNoiseSeed(vec2f(stamps[at + 12u], stamps[at + 13u]))), u.noise);
    }
    if (u.rolling == 1u) {
      let grainTurn = stamps[at + 6u];
      let size = u.grain.place.xy * pow(z / u.diameter, u.zoom);
      let grainUv = turned(local, -grainTurn) / size + u.movement * vec2f(stamps[at + 12u], stamps[at + 13u]) / u.grain.place.xy + u.grain.place.zw;
      let raw = textureSampleGrad(grain, tile, grainUv, turned(vec2f(1.0, 0.0), -grainTurn) / size, turned(vec2f(0.0, 1.0), -grainTurn) / size).r;
      a = grained(a, raw, mean, u.grain, stamps[at + 10u]);
    }
    let paint = a * stamps[at + 4u];
    laid.built = accumulationLay(laid.built, paint, stamps[at + 8u], u.accumulation);
    // Tints lay premultiplied, each over those before, as the fixed path's blend lays them. Only a buildToOpacity is
    // laid in order (stampAccumulationPlan), whose blend weighs a tint by the stamp's paint.
    if (tinted) {
      let t = tints[u.tint + i];
      laid.tintA = vec4f(t.xyz * paint, paint) + laid.tintA * (1.0 - paint);
      laid.tintB = vec4f(t.w * paint, 0.0, 0.0, paint) + laid.tintB * (1.0 - paint);
    }
  }
  return laid;
}
struct Covered { @location(0) mask: vec4f, @location(1) cap: vec4f }
struct Stamp { @location(0) mask: vec4f, @location(1) cap: vec4f, @location(2) tintA: vec4f, @location(3) tintB: vec4f }
@fragment fn coverOrdered(@builtin(position) at: vec4f) -> Covered { return Covered(vec4f(laidInOrder(at.xy, false).built), vec4f(0.0)); }
@fragment fn coverOrderedTinted(@builtin(position) at: vec4f) -> Stamp {
  let laid = laidInOrder(at.xy, true);
  return Stamp(vec4f(laid.built), vec4f(0.0), laid.tintA, laid.tintB);
}`;

/** The mip level a grain `texture` tiled `tileW` pixels across reads: texels per pixel, as a fragment's derivatives would say. */
export const stampGrainLod = (texture: StampPaintImage, tileW: number) => Math.max(0, Math.log2(texture.width / tileW));

/** Writes a Grain at word `at`: its tile in pixels, its offset in tiles, its mip level and how it reads. */
export function writeStampGrain(views: GpuUniformViews, at: number, grain: StampBrushGrain<StampPaintImage>, tile: readonly [number, number], offset: readonly [number, number], lod: number) {
  const put = gpuUniformWriter(STAMP_GRAIN, views, at);
  put('place', [tile[0], tile[1], offset[0], offset[1]]);
  put('shape', [grain.depth, lod, grain.brightness, grain.contrast]);
  put('blend', stampGrainModeIndex(grain.blend));
  put('layer', grain.blend.family === 'layer' ? 1 : 0);
  put('aboutMean', grain.contrastPivot === 'mean' ? 1 : 0);
  put('mirror', grain.tiling === 'mirror' ? 1 : 0);
}

// stamp-paint-renderer.ts: draws a compiled stamp painting through WebGPU. Each frame repaints every
// group on bare paper, so it depends only on its time; only images and stamp buffers persist.
//
// A deposit paints within its visible stamps' box, in the order Photoshop's captures show: a render pass stamps its
// coverage mask (stampAccumulationPlan), compute passes blur it for wet or burnt edges, and a compute pass resolves
// it (STAMP_RESOLVE_PLANS, rims, paper tooth, protected regions, clip, opacity) onto its group's layer. Groups then
// land on the painting.
//
// Formulas and stage orders are WGSL twins of the CPU reference's registries, held to it by the formulas command.
// The brush says where Procreate and Photoshop differ; nothing here asks where it came from.

import { bindStampBrushImages, type StampBrush, type StampBrushAsset, type StampBrushGrain, type StampBrushLayer } from '../models/stamp-brush.ts';
import { COVERAGE_FORMULAS_WGSL, stampDualModeIndex, stampGrainModeIndex } from '../models/coverage-formulas.ts';
import {
  STAMP_ACCUMULATION_LAY_WGSL, STAMP_ACCUMULATION_RESOLVE_WGSL, STAMP_ACCUMULATIONS, STAMP_BLUR_LEVELS, stampAccumulationBuild, stampAccumulationIndex,
  stampAccumulationPlan, stampActiveLayers, stampResolvePlan, stampResolvePlanIndex, stampResolvePlansWgsl, type StampAccumulationPlan, type StampActiveLayer,
} from '../models/stamp-deposit-stages.ts';
import { visibleStampCountAt, type CompiledStampDeposit, type CompiledStampPaint, type StampPaintPaper, type StampRegion } from '../models/stamp-paint-recipe.ts';
import type { PlacedStamp } from '../models/stamp-placement.ts';
import { stampBlurRegion, type StampPixelBox } from '../models/stamp-blur-region.ts';
import { coarsestStampTipLevel, STAMP_TIP_HULL_SIDES, stampTipHull, type StampTipHull, type StampTipLevel } from '../models/stamp-tip-hull.ts';
import { PAINT_DEPOSIT_WORDS, STAMP_PAINT_COMPOSITOR_WGSL, stampPaintBlendIndex, writePaintDeposit } from './stamp-paint-compositor.ts';
import { createStampPaintDevice, FULL_FRAME_WGSL, loadStampPaintImages, readStampTipLevels, type StampPaintImage } from './stamp-paint-gpu.ts';
import { stampUniformLayout, stampUniformStruct, stampUniformWriter, type StampUniformViews } from './stamp-uniform-layout.ts';

/**
 * Floats per stamp in the instance buffer: x, y, diameter, rotation, then alpha, blur, grain turn and flips (x 1, y 2),
 * then opacity, roundness and grain depth.
 */
const STAMP_FLOATS = 11;
/** Floats per stamp in the tint buffer, for a brush with colour dynamics: hue, saturation, lightness, secondary. */
const TINT_FLOATS = 4;

/** Bytes per uniform slot: every draw's uniforms sit at an offset WebGPU allows binding at (256). */
const SLOT = 256;

/** A compute pass's workgroup is 8 × 8 pixels. */
const WORKGROUP = 8;

/**
 * A grain as its brush reads it: `place` is its tile (px) and offset (tiles), `shape` its depth, mip level, brightness
 * and contrast; `layer` whether its blend is a layer formula, `aboutMean` its contrast's pivot, `mirror` whether it
 * tiles mirrored.
 */
const GRAIN = stampUniformLayout('Grain', [['place', 'vec4f'], ['shape', 'vec4f'], ['blend', 'i32'], ['layer', 'u32'], ['aboutMean', 'u32'], ['mirror', 'u32']]);

const GRAIN_WGSL = /* wgsl */ `
${COVERAGE_FORMULAS_WGSL}
${GRAIN.wgsl}
// A grain image's mean paint: its smallest mip.
fn grainMean(g: texture_2d<f32>, tile: sampler) -> f32 { return 1.0 - textureSampleLevel(g, tile, vec2f(0.5), 16.0).r; }
// Coverage a cut by the grain's texel \`raw\` (as the image holds it, dark is paint), \`mean\` the grain's mean paint.
// \`share\`: how much of the cut a stamp takes (PlacedStamp.grainDepth), 1 for any grain but a rolling one's.
fn grained(a: f32, raw: f32, mean: f32, p: Grain, share: f32) -> f32 {
  return mix(a, grainCut(a, grainPaint(1.0 - raw, p.shape.z, p.shape.w, p.aboutMean == 1u, mean), p.shape.x, p.blend, p.layer == 1u), share);
}`;

const TURNED_WGSL = /* wgsl */ `
fn turned(v: vec2f, angle: f32) -> vec2f {
  let s = sin(angle);
  let c = cos(angle);
  return vec2f(c * v.x - s * v.y, s * v.x + c * v.y);
}`;

// A stamp is its tip's hull (stamp-tip-hull.ts) as a triangle fan, its tip place interpolated: Apple's GPUs fetch
// an interpolated place's texel before the shader runs; computing it took twice as long. A flip mirrors the hull,
// not its sampling, so the hull holds the paint. The tip's center lands on the stamp's place. Mask rows run top first.
const STAMP_DRAW = stampUniformLayout('StampDraw', [
  ['resolution', 'vec2f'], ['roundness', 'f32'], ['rolling', 'u32'], ['grain', stampUniformStruct(GRAIN)], ['diameter', 'f32'], ['zoom', 'f32'],
  ['movement', 'f32'], ['hull', { vec4fArray: STAMP_TIP_HULL_SIDES / 2 }], ['span', 'f32'], ['towardFull', 'u32'], ['center', 'vec2f'],
]);
const STAMP_WGSL = /* wgsl */ `
${STAMP_DRAW.wgsl}
@group(0) @binding(0) var<uniform> u: StampDraw;
@group(0) @binding(1) var tip: texture_2d<f32>;
@group(0) @binding(2) var grain: texture_2d<f32>;
// Clamped, and anisotropic or not as the tip's sampling says.
@group(0) @binding(3) var tipClamp: sampler;
@group(0) @binding(4) var tile: sampler;
struct Corner { @builtin(position) position: vec4f, @location(0) tipUv: vec2f, @location(1) alpha: f32, @location(2) blur: f32, @location(3) grainUv: vec2f, @location(4) tint: vec4f, @location(5) toward: f32, @location(6) grainDepth: f32 }
struct Covered { @location(0) mask: vec4f, @location(1) cap: vec4f }
struct Stamp { @location(0) mask: vec4f, @location(1) cap: vec4f, @location(2) tintA: vec4f, @location(3) tintB: vec4f }
${GRAIN_WGSL}
${TURNED_WGSL}
@vertex fn place(@builtin(vertex_index) i: u32, @location(0) stamp: vec4f, @location(1) more: vec4f, @location(2) tint: vec4f, @location(3) last: vec3f) -> Corner {
  let pair = u.hull[i / 2u];
  let uv = select(pair.xy, pair.zw, (i & 1u) == 1u);
  let flips = u32(more.w);
  let mirror = vec2f(select(1.0, -1.0, (flips & 1u) != 0u), select(1.0, -1.0, (flips & 2u) != 0u));
  // Never thinner than a pixel: Photoshop's Flat brushes (roundness 0) sweep a hairline into a solid ribbon.
  let opacity = last.x;
  let squash = max(u.roundness * last.y, 1.0 / (stamp.z * u.span));
  let local = turned((uv - u.center) * vec2f(1.0, squash) * stamp.z * u.span * mirror, stamp.w);
  let at = (stamp.xy + local) / u.resolution * 2.0 - 1.0;
  // A rolling grain turns with the stamp, grows with its size by zoom and travels the canvas by movement: at
  // movement 1 and constant size it lies still; as size or direction change it slides, a rolling grain's streak.
  let size = u.grain.place.xy * pow(stamp.z / u.diameter, u.zoom);
  let grainUv = turned(local, -more.z) / size + u.movement * stamp.xy / u.grain.place.xy + u.grain.place.zw;
  // A glaze or a build lays flow × opacity toward full; a buildToOpacity lays its flow toward its own opacity.
  let full = u.towardFull == 1u;
  return Corner(vec4f(at.x, -at.y, 0.0, 1.0), uv, select(more.x, more.x * opacity, full), more.y * ${STAMP_BLUR_LEVELS.toFixed(1)}, grainUv, tint, select(opacity, 1.0, full), last.z);
}
// A stamp's paint (x) and its cap (y): the paint without its tip, how far a glaze's stroke may build there. A rolling
// grain, carried by the stamp, cuts each one.
fn covered(corner: Corner) -> vec2f {
  let tipped = 1.0 - textureSampleBias(tip, tipClamp, corner.tipUv, corner.blur).r;
  var coverage = vec2f(tipped, 1.0);
  if (u.rolling == 1u) {
    let raw = textureSample(grain, tile, corner.grainUv).r;
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
}`;

/** Pixels a side of the tiles an `ordered` layer's stamps are binned by (binOrderedStamps). */
const ORDERED_TILE = 32;

// An `ordered` layer is one triangle over the deposit's box: each pixel walks its tile's stamps in order, laying each
// by its accumulation's lay. A stamp's tip place inverts the fixed path's vertex transform; tip and rolling grain are
// sampled at that path's interpolated gradients, the tip's grown by its blur as the fixed path's bias grows it.
const ORDERED_DRAW = stampUniformLayout('OrderedDraw', [
  ['grain', stampUniformStruct(GRAIN)], ['roundness', 'f32'], ['rolling', 'u32'], ['diameter', 'f32'], ['zoom', 'f32'], ['movement', 'f32'],
  ['span', 'f32'], ['first', 'u32'], ['count', 'u32'], ['tint', 'u32'], ['bins', 'u32'], ['tilesX', 'u32'], ['accumulation', 'i32'], ['center', 'vec2f'],
]);
const ORDERED_WGSL = /* wgsl */ `
${FULL_FRAME_WGSL}
${ORDERED_DRAW.wgsl}
@group(0) @binding(0) var<uniform> u: OrderedDraw;
@group(0) @binding(1) var tip: texture_2d<f32>;
@group(0) @binding(2) var grain: texture_2d<f32>;
@group(0) @binding(3) var tipClamp: sampler;
@group(0) @binding(4) var tile: sampler;
@group(0) @binding(5) var<storage, read> stamps: array<f32>;
@group(0) @binding(6) var<storage, read> tints: array<vec4f>;
// Each tile's first entry (one past the last after them), then each tile's stamps by index from the layer's first.
@group(0) @binding(7) var<storage, read> bins: array<u32>;
${GRAIN_WGSL}
${TURNED_WGSL}
${STAMP_ACCUMULATION_LAY_WGSL}
struct Laid { built: f32, tintA: vec4f, tintB: vec4f }
fn laidInOrder(p: vec2f, tinted: bool) -> Laid {
  let cell = u.bins + (u32(p.y) / ${ORDERED_TILE}u) * u.tilesX + u32(p.x) / ${ORDERED_TILE}u;
  var laid = Laid(0.0, vec4f(0.0), vec4f(0.0));
  var mean = 0.0;
  if (u.rolling == 1u) { mean = grainMean(grain, tile); }
  for (var k = bins[cell]; k < bins[cell + 1u]; k++) {
    let i = bins[k];
    // A tile's stamps are in order, so the first not yet visible ends it.
    if (i >= u.count) { break; }
    let at = (u.first + i) * ${STAMP_FLOATS}u;
    let xy = vec2f(stamps[at], stamps[at + 1u]);
    let z = stamps[at + 2u];
    let rotation = stamps[at + 3u];
    let flips = u32(stamps[at + 7u]);
    let mirror = vec2f(select(1.0, -1.0, (flips & 1u) != 0u), select(1.0, -1.0, (flips & 2u) != 0u));
    let squash = max(u.roundness * stamps[at + 9u], 1.0 / (z * u.span));
    let scale = vec2f(1.0, squash) * z * u.span * mirror;
    let local = p - xy;
    let uv = turned(local, -rotation) / scale + u.center;
    // Outside its square a stamp lays nothing; inside it but outside its hull its tip is bare, as the fixed path's is.
    if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { continue; }
    let blur = exp2(stamps[at + 5u] * ${STAMP_BLUR_LEVELS.toFixed(1)});
    var a = 1.0 - textureSampleGrad(tip, tipClamp, uv, turned(vec2f(1.0, 0.0), -rotation) / scale * blur, turned(vec2f(0.0, 1.0), -rotation) / scale * blur).r;
    if (u.rolling == 1u) {
      let grainTurn = stamps[at + 6u];
      let size = u.grain.place.xy * pow(z / u.diameter, u.zoom);
      let grainUv = turned(local, -grainTurn) / size + u.movement * xy / u.grain.place.xy + u.grain.place.zw;
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

const BLUR = stampUniformLayout('Blur', [['sourceSize', 'vec2f'], ['direction', 'vec2f'], ['sigma', 'f32'], ['origin', 'vec2u'], ['extent', 'vec2u']]);
const BLUR_WGSL = /* wgsl */ `
${BLUR.wgsl}
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

const DEPOSIT = stampUniformLayout('Deposit', [
  ['paint', { external: 'PaintDeposit', words: PAINT_DEPOSIT_WORDS, align: 4 }], ['secondary', 'vec4f'], ['view', 'vec4f'], ['edges', 'vec4f'], ['dualEdges', 'vec4f'],
  ['grain', stampUniformStruct(GRAIN)], ['dualGrain', stampUniformStruct(GRAIN)], ['paperDepth', 'f32'], ['paperLod', 'f32'], ['opacity', 'f32'],
  ['dualBlend', 'i32'], ['burntBlend', 'i32'], ['dualBurntBlend', 'i32'], ['flags', 'u32'], ['resolvePlan', 'i32'], ['origin', 'vec2u'], ['extent', 'vec2u'],
  ['build', 'vec2f'], ['accumulation', 'vec2u'], ['pooling', 'vec4f'],
]);

/** What a deposit's resolve does, a bit each in its `flags`, and a WGSL constant each of the same name in capitals. */
const DEPOSIT_FLAGS = {
  canvasGrain: 1, dual: 2, dualCanvasGrain: 4, paper: 8, protected: 16, clipped: 32, clips: 64, tinted: 128,
  pooled: 256, dualPooled: 512, dualLayer: 1024,
} as const;
const DEPOSIT_FLAGS_WGSL = Object.entries(DEPOSIT_FLAGS).map(([flag, bit]) => `const ${flag.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()} = ${bit}u;`).join('\n');

/** Each resolve stage on the main layer's coverage `m`: `d` is the dual's, cut and pooled already, `at` the pixel. */
const RESOLVE_STAGES_WGSL = stampResolvePlansWgsl('resolveStages', 'd: f32, at: vec2f', {
  grain: 'if ((u.flags & CANVAS_GRAIN) != 0u) { m = texturized(grain, at, m, u.grain); }',
  dual: 'if ((u.flags & DUAL) != 0u) { m = dualCombine(m, d, u.dualBlend, (u.flags & DUAL_LAYER) != 0u); }',
  pooling: 'if ((u.flags & POOLED) != 0u) { m = pooled(m, u.pooling.x, u.pooling.y); }',
});

// A compute pass has no derivatives to choose a mip level by, so each grain's level is worked out on the CPU: a tile
// is a fixed number of pixels across the whole painting, so it reads the same level everywhere.
const DEPOSIT_WGSL = /* wgsl */ `
${STAMP_PAINT_COMPOSITOR_WGSL}
${GRAIN_WGSL}
${DEPOSIT.wgsl}
${DEPOSIT_FLAGS_WGSL}
${STAMP_ACCUMULATION_RESOLVE_WGSL}
${RESOLVE_STAGES_WGSL}
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
@group(0) @binding(11) var tintA: texture_2d<f32>;
@group(0) @binding(12) var tintB: texture_2d<f32>;
@group(0) @binding(13) var cap: texture_2d<f32>;
@group(0) @binding(14) var mirrorTile: sampler;
fn texturized(g: texture_2d<f32>, at: vec2f, a: f32, p: Grain) -> f32 {
  let uv = at / p.place.xy + p.place.zw;
  let raw = select(textureSampleLevel(g, tile, uv, p.shape.y).r, textureSampleLevel(g, mirrorTile, uv, p.shape.y).r, p.mirror == 1u);
  return grained(a, raw, grainMean(g, tile), p, 1.0);
}

// Where the mask stands above its blur, as steeply as the edge's sharpness says.
fn rimOf(a: f32, soft: f32, sharpness: f32) -> f32 { return clamp((a - soft) * sharpness, 0.0, 1.0); }

fn hsl(c: vec3f) -> vec3f {
  let hi = max(c.r, max(c.g, c.b));
  let lo = min(c.r, min(c.g, c.b));
  let l = (hi + lo) / 2.0;
  let d = hi - lo;
  if (d <= 0.0) { return vec3f(0.0, 0.0, l); }
  var h = (c.r - c.g) / d + 4.0;
  if (hi == c.r) { h = (c.g - c.b) / d + 6.0; } else if (hi == c.g) { h = (c.b - c.r) / d + 2.0; }
  return vec3f(fract(h / 6.0), d / (1.0 - abs(2.0 * l - 1.0)), l);
}
fn rgbOf(v: vec3f) -> vec3f {
  let c = (1.0 - abs(2.0 * v.z - 1.0)) * v.y;
  let k = (vec3f(0.0, 8.0, 4.0) + v.x * 12.0) % 12.0;
  return v.z - c / 2.0 * max(vec3f(-1.0), min(min(k - 3.0, 9.0 - k), vec3f(1.0)));
}
// The deposit's colour moved by its stamps' mean tint here, as shiftStampPaintColor (stamp-paint-recipe.ts) moves one.
fn tinted(color: vec3f, pixel: vec2u) -> vec3f {
  let a = textureLoad(tintA, pixel, 0);
  if (a.w <= 0.0) { return color; }
  let t = a.xyz / a.w;
  let v = hsl(color);
  let moved = rgbOf(vec3f(fract(v.x + t.x), clamp(v.y + t.y, 0.0, 1.0), clamp(v.z + t.z, 0.0, 1.0)));
  return mix(moved, u.secondary.rgb, clamp(textureLoad(tintB, pixel, 0).x / a.w, 0.0, 1.0));
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn deposit(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let at = vec2f(pixel) + 0.5;
  // Each layer's stroke as its accumulation resolves it: a glaze's from its densest stamp (the cap's blue or alpha)
  // toward the build held under its cap (red or green).
  let built = textureLoad(mask, pixel, 0).rg;
  let kept = textureLoad(cap, pixel, 0);
  let raw = vec2f(
    accumulationResolve(built.x, kept.b, kept.r, u.build.x, i32(u.accumulation.x)),
    accumulationResolve(built.y, kept.a, kept.g, u.build.y, i32(u.accumulation.y)),
  );
  let soft = textureSampleLevel(blurred, linearClamp, at / u.view.xy, 0.0);
  var burnt = rimOf(raw.r, soft.r, u.edges.w) * u.edges.z;
  var dualBurnt = 0.0;
  // The dual's own grain and pooling come before it combines, wherever its plan puts the combine.
  var d = 0.0;
  if ((u.flags & DUAL) != 0u) {
    d = raw.g;
    if ((u.flags & DUAL_CANVAS_GRAIN) != 0u) { d = texturized(dualGrain, at, d, u.dualGrain); }
    if ((u.flags & DUAL_POOLED) != 0u) { d = pooled(d, u.pooling.z, u.pooling.w); }
    dualBurnt = rimOf(raw.g, soft.g, u.dualEdges.w) * u.dualEdges.z * step(0.0001, raw.r);
    // Rims burning by one blend are one rim, joined by max; each burns by its own blend when they differ.
    if (u.dualBurntBlend == u.burntBlend) { burnt = max(burnt, dualBurnt); dualBurnt = 0.0; }
  }
  // The stages in the order of the brush's plan (STAMP_RESOLVE_PLANS).
  var m = resolveStages(raw.r, d, at, u.resolvePlan);
  // A wet rim is laid after the dual combines, as the whole stroke's pigment gathers there, but through the grain: a
  // grain that breaks the body into flecks breaks its rim too.
  var wet = rimOf(raw.r, soft.r, u.edges.y) * u.edges.x;
  if ((u.flags & CANVAS_GRAIN) != 0u) { wet = texturized(grain, at, wet, u.grain); }
  m += wet;
  var keep = 1.0;
  // A paper's tooth was photographed, not drawn as a brush grain is: it cuts in proportion to its own mean paint,
  // its smallest mip. A photograph isn't seamless, so it tiles mirrored.
  if ((u.flags & PAPER) != 0u) {
    let tooth = 1.0 - textureSampleLevel(paperGrain, mirrorTile, at / u.view.zw, u.paperLod).r;
    let mean = 1.0 - textureSampleLevel(paperGrain, tile, vec2f(0.5), 16.0).r;
    keep *= mix(1.0, clamp(tooth / max(mean, 0.01), 0.0, 1.0), u.paperDepth);
  }
  if ((u.flags & PROTECTED) != 0u) { keep *= 1.0 - textureLoad(protect, pixel, 0).r; }
  let clipped = textureLoad(clip, pixel);
  if ((u.flags & CLIPPED) != 0u) { keep *= clamp(clipped.r, 0.0, 1.0); }
  let coverage = clamp(m, 0.0, 1.0) * keep * u.opacity;
  var paint = u.paint;
  if ((u.flags & TINTED) != 0u) { paint.color = tinted(paint.color, pixel); }
  let under = textureLoad(layer, pixel);
  var over = depositPaint(under, paint, coverage);
  // A burnt rim burns into paint already there, the group's or the deposit's own (its stamps laid over one another).
  let burnable = max(under.a, clamp(m, 0.0, 1.0)) * keep * u.opacity;
  let burn = clamp(burnt, 0.0, 1.0) * burnable;
  if (burn > 0.0) { over = depositPaint(over, PaintDeposit(paint.color, u.burntBlend), burn); }
  let dualBurn = clamp(dualBurnt, 0.0, 1.0) * burnable;
  if (dualBurn > 0.0) { over = depositPaint(over, PaintDeposit(paint.color, u.dualBurntBlend), dualBurn); }
  textureStore(layer, pixel, over);
  if ((u.flags & CLIPS) != 0u) { textureStore(clip, pixel, vec4f(coverage) + clipped * (1.0 - coverage)); }
}`;

const GROUP = stampUniformLayout('Group', [['opacity', 'f32'], ['glaze', 'u32'], ['origin', 'vec2u'], ['extent', 'vec2u']]);
const GROUP_WGSL = /* wgsl */ `
${STAMP_PAINT_COMPOSITOR_WGSL}
${GROUP.wgsl}
@group(0) @binding(0) var<uniform> u: Group;
@group(0) @binding(1) var layer: texture_2d<f32>;
@group(0) @binding(2) var painting: texture_storage_2d<rgba16float, read_write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn group(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  textureStore(painting, pixel, groupPaint(textureLoad(painting, pixel), textureLoad(layer, pixel, 0), u.glaze == 1u, u.opacity));
}`;

const PAPER = stampUniformLayout('Paper', [['color', 'vec3f'], ['hasImage', 'u32'], ['cover', 'vec2f'], ['lod', 'f32']]);
const PAPER_WGSL = /* wgsl */ `
${PAPER.wgsl}
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

const REGION = stampUniformLayout('Region', [['resolution', 'vec2f'], ['ellipse', 'u32'], ['shape', 'vec4f']]);
const REGION_WGSL = /* wgsl */ `
${REGION.wgsl}
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


const assetKey = ({ style, pack, file }: StampBrushAsset) => `${style}/${pack}/${file}`;

/** Every image a painting and its paper need, each once, with how it wraps: a grain tiles, a tip or photograph doesn't. */
function paintingImages(painting: CompiledStampPaint, paper: StampPaintPaper): [StampBrushAsset, 'tile' | 'clamp'][] {
  const assets = painting.groups.flatMap((group) => group.passes.flatMap((pass) => pass.deposits.flatMap(({ brush }) =>
    [brush, ...(brush.dual ? [brush.dual] : [])].flatMap((layer): [StampBrushAsset, 'tile' | 'clamp'][] => [[layer.tip.image, 'clamp'], ...(layer.grain ? [[layer.grain.image, 'tile'] satisfies [StampBrushAsset, 'tile']] : [])]))));
  if (paper.image) assets.push([paper.image, 'clamp']);
  if (paper.grain) assets.push([paper.grain.image, 'tile']);
  return [...new Map(assets.map((entry) => [assetKey(entry[0]), entry])).values()];
}

type Box = StampPixelBox;

/** A brush's layer with its images on the GPU. */
type BoundLayer = StampBrushLayer<StampPaintImage>;

/** How many diameters wide a layer's tip image is drawn. */
const spanOf = (layer: StampBrushLayer<unknown>) => layer.tip.span ?? 1;

/** Stamps whose bounds are kept together: a box is found from the chunks before it and the stamps within its own. */
const REACH_CHUNK = 256;

/**
 * How far `stamps` reach, for each whole chunk of them from the first: x0, y0, x1, y1 of stamps 0 to the chunk's end.
 * A stamp's corners reach 0.75 of its tip image's width (`span` diameters) from its centre, however it's turned.
 */
function stampReach(stamps: readonly PlacedStamp[], span: number): Float64Array {
  const chunks = new Float64Array(Math.floor(stamps.length / REACH_CHUNK) * 4);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < chunks.length / 4 * REACH_CHUNK; i++) {
    const s = stamps[i], r = s.diameter * span * 0.75;
    x0 = Math.min(x0, s.x - r); y0 = Math.min(y0, s.y - r); x1 = Math.max(x1, s.x + r); y1 = Math.max(y1, s.y + r);
    if ((i + 1) % REACH_CHUNK === 0) chunks.set([x0, y0, x1, y1], ((i + 1) / REACH_CHUNK - 1) * 4);
  }
  return chunks;
}

/** Grows `into` (x0, y0, x1, y1) by where the first `count` of `stamps` reach, from their chunks and the rest. */
function reachOfFirst(stamps: readonly PlacedStamp[], chunks: Float64Array, count: number, span: number, into: number[]) {
  const whole = Math.floor(count / REACH_CHUNK);
  if (whole) {
    const at = (whole - 1) * 4;
    into[0] = Math.min(into[0], chunks[at]); into[1] = Math.min(into[1], chunks[at + 1]);
    into[2] = Math.max(into[2], chunks[at + 2]); into[3] = Math.max(into[3], chunks[at + 3]);
  }
  for (let i = whole * REACH_CHUNK; i < count; i++) {
    const s = stamps[i], r = s.diameter * span * 0.75;
    into[0] = Math.min(into[0], s.x - r); into[1] = Math.min(into[1], s.y - r); into[2] = Math.max(into[2], s.x + r); into[3] = Math.max(into[3], s.y + r);
  }
}

type LoadedPlan = Exclude<StampAccumulationPlan, { kind: 'ordered' }> | { kind: 'ordered'; bins: number };

/**
 * Appends an `ordered` layer's bins to `into` and returns where they start: for each tile ORDERED_TILE pixels a side,
 * `tilesX` across the painting, row by row, the entry its stamps start at (and one past the last tile's), then each
 * tile's stamps, by index in order, that reach into it (0.75 of the tip's width from the centre, as stampReach).
 */
function binOrderedStamps(stamps: readonly PlacedStamp[], span: number, tilesX: number, tilesY: number, into: number[]): number {
  const tiles = Array.from({ length: tilesX * tilesY }, (): number[] => []);
  const tileOf = (v: number, count: number) => Math.min(count - 1, Math.max(0, Math.floor(v / ORDERED_TILE)));
  stamps.forEach((s, i) => {
    const r = s.diameter * span * 0.75;
    for (let ty = tileOf(s.y - r, tilesY); ty <= tileOf(s.y + r, tilesY); ty++) {
      for (let tx = tileOf(s.x - r, tilesX); tx <= tileOf(s.x + r, tilesX); tx++) tiles[ty * tilesX + tx].push(i);
    }
  });
  const table = into.length;
  let entry = table + tiles.length + 1;
  for (const tile of tiles) {
    into.push(entry);
    entry += tile.length;
  }
  into.push(entry);
  for (const tile of tiles) for (const i of tile) into.push(i);
  return table;
}

/**
 * A deposit as the GPU holds it: where its stamps and dual stamps start in the instance buffer, where its tints start
 * in the tint buffer (null for a brush without colour dynamics), and what's fixed.
 */
type LoadedDeposit = {
  /** Its brush with each image bound to its texture, and which of its layers' stages are active. */
  brush: StampBrush<StampPaintImage>;
  active: ReturnType<typeof stampActiveLayers<StampPaintImage>>;
  main: number; dual: number; tint: number | null;
  mainReach: Float64Array; dualReach: Float64Array;
  mainHull: StampTipHull; dualHull: StampTipHull | null;
  /** How each layer's stamps are laid, and an `ordered` layer's bins' table in the bin buffer (binOrderedStamps). */
  mainPlan: LoadedPlan; dualPlan: LoadedPlan | null;
  /** Its protected regions' triangles in the region buffer: [first vertex, vertex count, ellipse or null] for each. */
  regions: [number, number, Extract<StampRegion, { kind: 'ellipse' }> | null][];
};

export type StampPaintRenderer = {
  /**
   * Draws `painting` as it stands `t` seconds into its scene. Resolves once WebGPU has checked the draw, or rejects
   * with its error: hold the frame until then, so a broken draw fails its own frame.
   */
  draw: (t: number) => Promise<void>;
  /** Resolves once the GPU has finished what's been drawn: for timing a draw, which a render never needs. */
  finish: () => Promise<void>;
  dispose: () => void;
};

/**
 * A renderer for one painting on `canvas`, `width` by `height` of the painting's pixels; `imageUrl` maps each image
 * to its URL. It resolves once every image is on the GPU. A frame may round a few pixels a level differently from one
 * draw to the next (docs/private-styles.md, "Same pixels"), which `studio repeatable`'s PSNR bar allows.
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
  // Loading and each draw are checked for any error WebGPU would otherwise report only later, unasked. A lost device
  // isn't an error a scope catches, so the draw after it throws.
  const checking = () => {
    for (const scope of GPU_ERROR_SCOPES) device.pushErrorScope(scope);
  };
  const checked = async (what: string) => {
    for (const _ of GPU_ERROR_SCOPES) {
      const error = await device.popErrorScope();
      if (error) throw new Error(`stamp paint: ${what} failed: ${error.message}`);
    }
  };
  checking();
  let lost: string | null = null;
  void device.lost.then((info) => { if (info.reason !== 'destroyed') lost ??= info.message; });
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
  /** The hull `layer`'s tip is drawn in, for the coarsest level its smallest or most blurred stamp reads. */
  function tipHull(layer: StampBrushLayer, stamps: readonly PlacedStamp[]): StampTipHull {
    // The tip's texels spread over its span, so its pixels per texel go by the image's width, not the diameter.
    const smallest = stamps.reduce((least, s) => Math.min(least, s.diameter), Infinity) * spanOf(layer);
    const blurred = Math.ceil(stamps.reduce((most, s) => Math.max(most, s.blur), 0) * STAMP_BLUR_LEVELS);
    const squashed = layer.tip.roundness * stamps.reduce((least, s) => Math.min(least, s.roundness), 1);
    const levels = tipLevels.get(assetKey(layer.tip.image))!;
    const coarsest = Math.min(levels.length - 1, coarsestStampTipLevel(levels[0], smallest, squashed, levels.length) + blurred);
    const key = `${assetKey(layer.tip.image)}@${coarsest}`;
    if (!hulls.has(key)) hulls.set(key, stampTipHull(levels, coarsest));
    return hulls.get(key)!;
  }

  // Every deposit's stamps, then its dual's, in one buffer, and its protected regions' triangles in another.
  const deposits = new Map<CompiledStampDeposit, LoadedDeposit>();
  const regionPoints: number[] = [], binData: number[] = [];
  const tilesX = Math.ceil(width / ORDERED_TILE), tilesY = Math.ceil(height / ORDERED_TILE);
  const loadPlan = (layer: StampBrushLayer<unknown>, stamps: readonly PlacedStamp[]): LoadedPlan => {
    const plan = stampAccumulationPlan(layer.accumulation, stamps);
    return plan.kind === 'ordered' ? { kind: 'ordered', bins: binOrderedStamps(stamps, spanOf(layer), tilesX, tilesY, binData) } : plan;
  };
  let total = 0, tints = 0, slotsPerFrame = 1;
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
      const brush = bindStampBrushImages(deposit.brush, image);
      deposits.set(deposit, {
        brush, active: stampActiveLayers(brush, deposit.diameter),
        main: total, dual: total + deposit.stamps.length, tint: deposit.brush.color ? tints : null,
        mainReach: stampReach(deposit.stamps, spanOf(deposit.brush)), dualReach: stampReach(deposit.dualStamps, deposit.brush.dual ? spanOf(deposit.brush.dual) : 1),
        mainHull: tipHull(deposit.brush, deposit.stamps), dualHull: deposit.brush.dual ? tipHull(deposit.brush.dual, deposit.dualStamps) : null,
        mainPlan: loadPlan(deposit.brush, deposit.stamps), dualPlan: deposit.brush.dual ? loadPlan(deposit.brush.dual, deposit.dualStamps) : null,
        regions,
      });
      total += deposit.stamps.length + deposit.dualStamps.length;
      if (deposit.brush.color) tints += deposit.stamps.length;
      // Its stamps and dual's, two blur passes, its resolve, and each region.
      slotsPerFrame += 5 + regions.length;
    }
  }
  const stampData = new Float32Array(Math.max(1, total) * STAMP_FLOATS), tintData = new Float32Array(Math.max(1, tints) * TINT_FLOATS);
  const write = (stamps: readonly PlacedStamp[], at: number) => stamps.forEach((s, i) => stampData.set(
    [s.x, s.y, s.diameter, s.rotation, s.alpha, s.blur, s.grainTurn, (s.flipX ? 1 : 0) + (s.flipY ? 2 : 0), s.opacity, s.roundness, s.grainDepth], (at + i) * STAMP_FLOATS,
  ));
  for (const [deposit, { main, dual, tint }] of deposits) {
    write(deposit.stamps, main);
    write(deposit.dualStamps, dual);
    if (tint !== null) deposit.stamps.forEach(({ tint: t }, i) => tintData.set([t.hue, t.saturation, t.lightness, t.secondary], (tint + i) * TINT_FLOATS));
  }
  const buffer = (data: Float32Array | Uint16Array | Uint32Array, usage: number) => {
    const made = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage: usage | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(made, 0, data.buffer, data.byteOffset, Math.ceil(data.byteLength / 4) * 4);
    return made;
  };
  // A layer laid in order reads its stamps and tints as storage.
  const stampBuffer = buffer(stampData, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE), tintBuffer = buffer(tintData, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE);
  // What an untinted stamp reads for its tint: read by every instance, so it's never indexed past.
  const noTintBuffer = buffer(new Float32Array(TINT_FLOATS), GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE);
  const binBuffer = buffer(new Uint32Array(binData.length ? binData : [0]), GPUBufferUsage.STORAGE);
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
  const slot = (fill: (views: StampUniformViews) => void): GPUBufferBinding => {
    const offset = slots++ * SLOT, word = offset / 4, words = SLOT / 4;
    stagedWords.fill(0, word, word + words);
    fill({ floats: stagedFloats.subarray(word, word + words), ints: stagedInts.subarray(word, word + words), words: stagedWords.subarray(word, word + words) });
    return { buffer: uniforms, offset, size: SLOT };
  };

  const linearClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
  // For a tip resampled anisotropically (StampBrushTip's sampling): squashing blurs it only across the squash.
  const anisotropicClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 16 });
  // Tiles repeat, as Photoshop's patterns do (a probe's ramp reads x mod its width): a grain that isn't seamless shows
  // its seam, as it does there.
  const tile = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
  // A grain that tiles mirrored (StampBrushGrain's tiling) never shows a seam.
  const mirrorTile = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'mirror-repeat', addressModeV: 'mirror-repeat' });

  const maxBlend: GPUBlendState = { color: { operation: 'max', srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'max', srcFactor: 'one', dstFactor: 'one' } };
  // Each stamp moves its stroke toward full or its opacity by its paint: B ← lerp(B, O, t·f). A blend can't see B, so
  // it can't keep a buildToOpacity from lowering it; a layer whose opacity falls is laid in order instead
  // (stampAccumulationPlan), and this blend lays only those whose opacity holds or rises, where it never lowers B.
  const buildBlend: GPUBlendState = { color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  // Even-odd fill without a stencil: each fan triangle inverts what's under it, so a pixel inside an odd number of them
  // ends up set, whatever the polygon's shape.
  const invertBlend: GPUBlendState = { color: { operation: 'add', srcFactor: 'one-minus-dst', dstFactor: 'zero' }, alpha: { operation: 'add', srcFactor: 'one-minus-dst-alpha', dstFactor: 'zero' } };
  // Tints are laid premultiplied, each stamp over those before it.
  const overBlend: GPUBlendState = { color: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const stampModule = device.createShaderModule({ code: STAMP_WGSL });
  /**
   * A stamp pipeline: its accumulation's blend into the brush's channel or its dual's; in a tinted pass (a brush with
   * colour dynamics) with the two tint targets too, which only the brush's own stamps write.
   */
  const stampPipeline = (glaze: boolean, channel: 0 | 1, tinted: boolean) => device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: stampModule,
      buffers: [
        { arrayStride: STAMP_FLOATS * 4, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }, { shaderLocation: 3, offset: 32, format: 'float32x3' }] },
        { arrayStride: tinted && channel === 0 ? TINT_FLOATS * 4 : 0, stepMode: 'instance', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x4' }] },
      ],
    },
    fragment: {
      module: stampModule,
      entryPoint: tinted && channel === 0 ? 'coverTinted' : 'cover',
      targets: [
        { format: 'rg16float', blend: buildBlend, writeMask: channel === 0 ? GPUColorWrite.RED : GPUColorWrite.GREEN },
        { format: 'rgba16float', blend: maxBlend, writeMask: glaze ? (channel === 0 ? GPUColorWrite.RED | GPUColorWrite.BLUE : GPUColorWrite.GREEN | GPUColorWrite.ALPHA) : 0 },
        ...(tinted ? [0, 1].map(() => ({ format: 'rgba16float' as const, blend: overBlend, writeMask: channel === 0 ? GPUColorWrite.ALL : 0 })) : []),
      ],
    },
  });
  const stampPipelines = Object.fromEntries((['glaze', 'build'] as const).map((accumulation) => {
    const glaze = accumulation === 'glaze';
    return [accumulation, { plain: [stampPipeline(glaze, 0, false), stampPipeline(glaze, 1, false)], tinted: [stampPipeline(glaze, 0, true), stampPipeline(glaze, 1, true)] }];
  })) as Record<'glaze' | 'build', Record<'plain' | 'tinted', [GPURenderPipeline, GPURenderPipeline]>>;
  const orderedModule = device.createShaderModule({ code: ORDERED_WGSL });
  /** An ordered pipeline: it writes the layer's channel whole, and a tinted pass's tints, which only the brush's own stamps write. */
  const orderedPipeline = (channel: 0 | 1, tinted: boolean) => device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: orderedModule },
    fragment: {
      module: orderedModule,
      entryPoint: tinted && channel === 0 ? 'coverOrderedTinted' : 'coverOrdered',
      targets: [
        { format: 'rg16float', writeMask: channel === 0 ? GPUColorWrite.RED : GPUColorWrite.GREEN },
        { format: 'rgba16float', writeMask: 0 },
        ...(tinted ? [0, 1].map(() => ({ format: 'rgba16float' as const, writeMask: channel === 0 ? GPUColorWrite.ALL : 0 })) : []),
      ],
    },
  });
  const orderedPipelines = { plain: [orderedPipeline(0, false), orderedPipeline(1, false)], tinted: [orderedPipeline(0, true), orderedPipeline(1, true)] };
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
    painting: target(width, height, STORAGE),
    layer: target(width, height, STORAGE | RENDER),
    mask: target(width, height, RENDER, 'rg16float'),
    cap: target(width, height, RENDER, 'rgba16float'),
    blurA: target(halfW, halfH, STORAGE),
    blurB: target(halfW, halfH, STORAGE),
    clip: target(width, height, STORAGE | RENDER),
    protect: target(width, height, RENDER, 'r8unorm'),
    region: target(width, height, RENDER, 'r8unorm'),
    blank: target(1, 1, 0, 'r8unorm'),
    // Only a painting with colour dynamics lays tints.
    tintA: tints ? target(width, height, RENDER) : null,
    tintB: tints ? target(width, height, RENDER) : null,
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
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  const rgb = (hex: string): [number, number, number] => [channel(hex, 1), channel(hex, 3), channel(hex, 5)];
  /** The mip level a grain `texture` tiled `tileW` pixels across reads: texels per pixel, as a fragment's derivatives would say. */
  const grainLod = (texture: StampPaintImage, tileW: number) => Math.max(0, Math.log2(texture.width / tileW));

  /** A layer's canvas grain's tile (a share of its stamps' diameter across), offset and mip level, written as a Grain at `at`. */
  const canvasGrainAt = (views: StampUniformViews, at: number, layer: StampActiveLayer<StampPaintImage> | undefined, offset: readonly [number, number]) => {
    const grain = layer?.canvasGrain;
    if (!grain) return;
    const size = grain.scale * layer.diameter;
    writeGrain(views, at, grain, [size, size * (grain.image.height / grain.image.width)], offset, grainLod(grain.image, size));
  };

  function drawStamps(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, loadedDeposit: LoadedDeposit, count: number, dualCount: number, box: Box) {
    const tinted = loadedDeposit.tint !== null;
    const pass = encoder.beginRenderPass({
      colorAttachments: [targets.mask, targets.cap, ...(tinted ? [targets.tintA!, targets.tintB!] : [])].map(({ view }) => ({ view, loadOp: 'clear' as const, storeOp: 'store' as const })),
    });
    pass.setScissorRect(box.x, box.y, box.w, box.h);
    pass.setIndexBuffer(fanBuffer, 'uint16');
    const stamp = (layer: BoundLayer, active: StampActiveLayer<StampPaintImage>, plan: LoadedPlan, first: number, n: number, hull: StampTipHull, stampChannel: 0 | 1) => {
      if (!n) return;
      const { rollingGrain: rolling, diameter } = active;
      const offset = deposit.grainOffset[stampChannel === 0 ? 'main' : 'dual'];
      const textures = [layer.tip.image.view, rolling ? rolling.image.view : targets.blank.view, layer.tip.sampling === 'anisotropic' ? anisotropicClamp : linearClamp, rolling?.tiling === 'mirror' ? mirrorTile : tile];
      const tintBinding = stampChannel === 0 && tinted ? { buffer: tintBuffer, at: loadedDeposit.tint! } : { buffer: noTintBuffer, at: 0 };
      const center: [number, number] = [layer.tip.center?.[0] ?? 0.5, layer.tip.center?.[1] ?? 0.5];
      if (plan.kind === 'ordered') {
        const pipeline = orderedPipelines[tinted ? 'tinted' : 'plain'][stampChannel];
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup(pipeline, [
          slot((views) => {
            const put = stampUniformWriter(ORDERED_DRAW, views);
            put('roundness', layer.tip.roundness);
            put('rolling', rolling ? 1 : 0);
            if (rolling) {
              const size = rolling.scale * diameter;
              writeGrain(views, ORDERED_DRAW.at.grain, rolling, [size, size * (rolling.image.height / rolling.image.width)], offset, 0);
              put('diameter', diameter);
              put('zoom', rolling.zoom);
              put('movement', rolling.movement);
            }
            put('span', spanOf(layer));
            put('first', first);
            put('count', n);
            put('tint', tintBinding.at);
            put('bins', plan.bins);
            put('tilesX', tilesX);
            put('accumulation', stampAccumulationIndex(layer.accumulation.kind));
            put('center', center);
          }),
          ...textures, { buffer: stampBuffer }, { buffer: tintBinding.buffer }, { buffer: binBuffer },
        ]));
        pass.draw(3);
        return;
      }
      const pipeline = stampPipelines[STAMP_ACCUMULATIONS[layer.accumulation.kind].keepsCap ? 'glaze' : 'build'][tinted ? 'tinted' : 'plain'][stampChannel];
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup(pipeline, [
        slot((views) => {
          const put = stampUniformWriter(STAMP_DRAW, views);
          put('resolution', [width, height]);
          put('roundness', layer.tip.roundness);
          put('rolling', rolling ? 1 : 0);
          if (rolling) {
            const size = rolling.scale * diameter;
            writeGrain(views, STAMP_DRAW.at.grain, rolling, [size, size * (rolling.image.height / rolling.image.width)], offset, 0);
            put('diameter', diameter);
            put('zoom', rolling.zoom);
            put('movement', rolling.movement);
          }
          // A hull has as many corners as stayed convex, up to the array's; the fan draws only those, and the rest are zeros.
          const hullWords = new Float32Array(STAMP_TIP_HULL_SIDES * 2);
          hullWords.set(hull);
          put('hull', hullWords);
          put('span', spanOf(layer));
          put('towardFull', plan.toward === 'full' ? 1 : 0);
          put('center', center);
        }),
        ...textures,
      ]));
      pass.setVertexBuffer(0, stampBuffer, first * STAMP_FLOATS * 4);
      pass.setVertexBuffer(1, tintBinding.buffer, tintBinding.at * TINT_FLOATS * 4);
      pass.drawIndexed((hull.length / 2 - 2) * 3, n);
    };
    stamp(loadedDeposit.brush, loadedDeposit.active.main, loadedDeposit.mainPlan, loadedDeposit.main, count, loadedDeposit.mainHull, 0);
    if (loadedDeposit.brush.dual && loadedDeposit.active.dual && loadedDeposit.dualPlan) stamp(loadedDeposit.brush.dual, loadedDeposit.active.dual, loadedDeposit.dualPlan, loadedDeposit.dual, dualCount, loadedDeposit.dualHull!, 1);
    pass.end();
  }

  function blurMask(encoder: GPUCommandEncoder, sigma: number, box: Box) {
    const halfSigma = Math.max(0.5, sigma / 2);
    const half = stampBlurRegion(box, halfW, halfH);
    // The across pass also covers the rows the down pass reaches past the box: blurA outside them holds whatever an
    // earlier deposit or frame left, which would make a frame depend on what was drawn before it.
    const reach = Math.min(40, Math.ceil(halfSigma * 2.5)) + 1;
    const top = Math.max(0, half.y - reach);
    const across = { ...half, y: top, h: half.h + (half.y - top) + reach };
    const blur = (source: GPUTextureView, sourceSize: [number, number], into: GPUTextureView, direction: [number, number], region: typeof half) => dispatch(encoder, pipelines.blur, [
      slot((views) => {
        const put = stampUniformWriter(BLUR, views);
        put('sourceSize', sourceSize);
        put('direction', direction);
        put('sigma', halfSigma);
        put('origin', [region.x, region.y]);
        put('extent', [region.w, region.h]);
      }),
      source, into, linearClamp,
    ], region.w, region.h);
    // Sampling the full-size mask at half size, at a texel's corner, averages four pixels: a box before the blur.
    blur(targets.mask.view, [width, height], targets.blurA.view, [2, 0], across);
    blur(targets.blurA.view, [halfW, halfH], targets.blurB.view, [0, 1], half);
  }

  function drawProtect(encoder: GPUCommandEncoder, regions: LoadedDeposit['regions']) {
    const region = (pipeline: GPURenderPipeline, first: number, count: number, ellipse: LoadedDeposit['regions'][number][2]) => (pass: GPURenderPassEncoder) => {
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup(pipeline, [slot((views) => {
        const put = stampUniformWriter(REGION, views);
        put('resolution', [width, height]);
        if (ellipse) {
          put('ellipse', 1);
          put('shape', [ellipse.x, ellipse.y, ellipse.radiusX, ellipse.radiusY]);
        }
      })]));
      pass.setVertexBuffer(0, regionBuffer);
      pass.draw(count, 1, first);
    };
    const into = (view: GPUTextureView, loadOp: GPULoadOp, paintPass: (pass: GPURenderPassEncoder) => void) => {
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp, storeOp: 'store' }] });
      paintPass(pass);
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

  function resolveDeposit(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, loadedDeposit: LoadedDeposit, clipped: boolean, blurred: boolean, box: Box) {
    const { brush, active } = loadedDeposit;
    const edgesOf = (layer?: StampActiveLayer<StampPaintImage>): [number, number, number, number] => (blurred && layer
      ? [layer.rim?.rim ?? 0, layer.rim?.sharpness ?? 0, layer.burntEdge?.strength ?? 0, layer.burntEdge?.sharpness ?? 0] : [0, 0, 0, 0]);
    const mainGrain = active.main.canvasGrain, dualGrain = active.dual?.canvasGrain;
    const tooth = paper.grain && paper.grain.depth > 0 ? paper.grain : undefined;
    let paperTile = [1, 1, 0];
    if (tooth) {
      const grain = image(tooth.image), size = tooth.scale * width;
      paperTile = [size, size * (grain.height / grain.width), grainLod(grain, size)];
    }
    const protectedBy = deposit.protectedBy.length > 0;
    const tinted = loadedDeposit.tint !== null;
    const flags: (keyof typeof DEPOSIT_FLAGS)[] = [
      ...(mainGrain ? ['canvasGrain' as const] : []), ...(brush.dual ? ['dual' as const] : []), ...(dualGrain ? ['dualCanvasGrain' as const] : []),
      ...(tooth ? ['paper' as const] : []), ...(protectedBy ? ['protected' as const] : []), clipped ? 'clipped' as const : 'clips' as const, ...(tinted ? ['tinted' as const] : []),
      ...(active.main.pooling ? ['pooled' as const] : []), ...(active.dual?.pooling ? ['dualPooled' as const] : []),
      ...(brush.dual?.blend.family === 'layer' ? ['dualLayer' as const] : []),
    ];
    dispatch(encoder, pipelines.deposit, [
      slot((views) => {
        const put = stampUniformWriter(DEPOSIT, views);
        writePaintDeposit(views.floats, views.ints, DEPOSIT.at.paint, deposit.material, deposit.blend);
        put('secondary', [...rgb(deposit.secondaryColor), 0]);
        put('view', [width, height, paperTile[0], paperTile[1]]);
        put('edges', edgesOf(active.main));
        put('dualEdges', edgesOf(active.dual));
        canvasGrainAt(views, DEPOSIT.at.grain, active.main, deposit.grainOffset.main);
        canvasGrainAt(views, DEPOSIT.at.dualGrain, active.dual, deposit.grainOffset.dual);
        put('paperDepth', tooth?.depth ?? 0);
        put('paperLod', paperTile[2]);
        put('opacity', deposit.opacity);
        put('dualBlend', brush.dual ? stampDualModeIndex(brush.dual.blend) : 0);
        const burntBlend = (brush.burntEdge ?? brush.dual?.burntEdge)?.blend ?? 'colorBurn';
        put('burntBlend', stampPaintBlendIndex(burntBlend));
        put('dualBurntBlend', stampPaintBlendIndex(brush.dual?.burntEdge?.blend ?? burntBlend));
        put('flags', flags.reduce((all, flag) => all | DEPOSIT_FLAGS[flag], 0));
        put('resolvePlan', stampResolvePlanIndex(stampResolvePlan(brush.dual)));
        put('origin', [box.x, box.y]);
        put('extent', [box.w, box.h]);
        // A layer that isn't there reads its build as none, as a `build` accumulation, whatever it resolves to.
        const accumulations = [brush.accumulation, brush.dual?.accumulation ?? { kind: 'build' as const }];
        put('build', [stampAccumulationBuild(accumulations[0]), stampAccumulationBuild(accumulations[1])]);
        put('accumulation', [stampAccumulationIndex(accumulations[0].kind), stampAccumulationIndex(accumulations[1].kind)]);
        const { pooling } = active.main, dualPooling = active.dual?.pooling;
        put('pooling', [pooling?.peak ?? 0, pooling?.body ?? 0, dualPooling?.peak ?? 0, dualPooling?.body ?? 0]);
      }),
      targets.mask.view, blurred ? targets.blurB.view : targets.mask.view,
      mainGrain ? mainGrain.image.view : targets.blank.view,
      dualGrain ? dualGrain.image.view : targets.blank.view,
      tooth ? image(tooth.image).view : targets.blank.view,
      targets.protect.view, targets.clip.view, targets.layer.view, linearClamp, tile,
      tinted ? targets.tintA!.view : targets.blank.view, tinted ? targets.tintB!.view : targets.blank.view, targets.cap.view, mirrorTile,
    ], box.w, box.h);
  }

  /** The pixels a deposit's first `count` stamps (and dual stamps) reach, padded for its edges' blur, or null. */
  function depositBox(deposit: CompiledStampDeposit, loadedDeposit: LoadedDeposit, count: number, dualCount: number, pad: number): Box | null {
    const reach = [Infinity, Infinity, -Infinity, -Infinity];
    reachOfFirst(deposit.stamps, loadedDeposit.mainReach, count, spanOf(deposit.brush), reach);
    if (deposit.brush.dual) reachOfFirst(deposit.dualStamps, loadedDeposit.dualReach, dualCount, spanOf(deposit.brush.dual), reach);
    const x = Math.max(0, Math.floor(reach[0] - pad)), y = Math.max(0, Math.floor(reach[1] - pad));
    const w = Math.min(width, Math.ceil(reach[2] + pad)) - x, h = Math.min(height, Math.ceil(reach[3] + pad)) - y;
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  }

  function drawPaper(encoder: GPUCommandEncoder) {
    const photograph = paper.image ? image(paper.image) : null;
    // Cover: the photograph fills the painting, cropped along whichever side it has to spare.
    const fit = photograph ? Math.max(width / photograph.width, height / photograph.height) : 1;
    dispatch(encoder, pipelines.paper, [
      slot((views) => {
        const put = stampUniformWriter(PAPER, views);
        put('color', rgb(paper.color));
        if (!photograph) return;
        put('hasImage', 1);
        put('cover', [width / (photograph.width * fit), height / (photograph.height * fit)]);
        put('lod', Math.max(0, Math.log2(1 / fit)));
      }),
      photograph?.view ?? targets.blank.view, targets.painting.view, linearClamp,
    ], width, height);
  }

  function draw(t: number) {
    if (lost) throw new Error(`stamp paint: the GPU device was lost: ${lost}`);
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
          const loadedDeposit = deposits.get(deposit)!;
          // The rim is where the mask stands above a blur as wide as its edge.
          const sigma = loadedDeposit.active.edgeSigma, blurred = sigma > 0;
          const box = depositBox(deposit, loadedDeposit, count, dualCount, blurred ? sigma * 3 : 2);
          if (!box) continue;
          drawStamps(encoder, deposit, loadedDeposit, count, dualCount, box);
          if (blurred) blurMask(encoder, sigma, box);
          if (loadedDeposit.regions.length) drawProtect(encoder, loadedDeposit.regions);
          resolveDeposit(encoder, deposit, loadedDeposit, !!pass.clipTo, blurred, box);
          painted = painted ? union(painted, box) : box;
        }
      }
      if (!painted) continue;
      const box = painted;
      dispatch(encoder, pipelines.group, [
        slot((views) => {
          const put = stampUniformWriter(GROUP, views);
          put('opacity', group.opacity);
          put('glaze', group.composite === 'glaze' ? 1 : 0);
          put('origin', [box.x, box.y]);
          put('extent', [box.w, box.h]);
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

  await checked('loading the painting onto the GPU');

  // A painting whose inputs change in the same commit as its time is disposed before its last draw is asked for.
  let disposed = false;
  return {
    draw: async (t) => {
      if (disposed) return;
      checking();
      try {
        draw(t);
      } finally {
        // A disposed device's scopes resolve with no error.
        await checked(`drawing the painting at ${t} s`);
      }
    },
    finish: () => (disposed ? Promise.resolve() : device.queue.onSubmittedWorkDone()),
    dispose() {
      disposed = true;
      context.unconfigure();
      device.destroy();
    },
  };
}

const GPU_ERROR_SCOPES = ['validation', 'out-of-memory', 'internal'] as const;

/** Writes a Grain at word `at`: its tile in pixels, its offset in tiles, its mip level and how it reads. */
function writeGrain(views: StampUniformViews, at: number, grain: StampBrushGrain<StampPaintImage>, tile: readonly [number, number], offset: readonly [number, number], lod: number) {
  const put = stampUniformWriter(GRAIN, views, at);
  put('place', [tile[0], tile[1], offset[0], offset[1]]);
  put('shape', [grain.depth, lod, grain.brightness, grain.contrast]);
  put('blend', stampGrainModeIndex(grain.blend));
  put('layer', grain.blend.family === 'layer' ? 1 : 0);
  put('aboutMean', grain.contrastPivot === 'mean' ? 1 : 0);
  put('mirror', grain.tiling === 'mirror' ? 1 : 0);
}

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

// stamp-paint-renderer.ts: draws a compiled stamp painting through WebGPU on a surface (stamp-paint-surface.ts), which
// holds what outlasts it; a painting loads its own stamps, regions, wet stages and checkpoints.
//
// A deposit paints within its visible stamps' box in Photoshop's order: a render pass stamps its coverage mask and
// joins a flood's body to it, compute passes blur it, and a compute pass resolves it onto its group's layer.
//
// What doesn't change with time is worked out at load into cropped single-channel textures: each flood's body, the
// masking fluid under each deposit, each pass's `within`.
//
// Formulas and stage orders are generated from the models' WGSL registries and held by the GPU gate
// (lib/paint/gate), which also traces a resolve stage by stage (trace).

import { bindStampBrushImages, stampBrushImages, type StampBrush, type StampBrushAsset, type StampBrushGrain, type StampBrushImageSource, type StampBrushLayer } from '#lib/paint/brush/models/stamp-brush.ts';
import { COVERAGE_FORMULAS_WGSL, stampDualModeIndex, stampGrainModeIndex } from '#lib/paint/brush/models/coverage-formulas.ts';
import {
  STAMP_ACCUMULATION_LAY_WGSL, STAMP_ACCUMULATION_RESOLVE_WGSL, STAMP_ACCUMULATIONS, STAMP_BLUR_LEVELS, STAMP_RESOLVE_ORDERS, STAMP_RESOLVE_PLANS, stampAccumulationBuild, stampAccumulationIndex,
  stampAccumulationPlan, stampActiveLayers, stampResolveOrderIndex, stampResolveOrdersWgsl, stampResolvePlan, type StampAccumulationPlan, type StampActiveLayer, type StampResolveStage,
} from '../models/stamp-deposit-stages.ts';
import { STAMP_FLOOD_FRONT_SHARE_WGSL } from '../models/stamp-fill.ts';
import { STAMP_PAINT_FIELD_SHARE, stampPaintFieldEnds } from '../models/stamp-paint-field.ts';
import { stampDepositShowsAt, stampFloodProgressAt, visibleStampCountAt } from '../models/stamp-deposit-reveal.ts';
import { stampBoilSeed, stampPassDeposits, type CompiledStampDeposit, type CompiledStampGroup, type CompiledStampMask, type CompiledStampMaskArea, type CompiledStampPaint, type CompiledStampPass, type StampPaintPaper } from '../models/stamp-paint-recipe.ts';
import { compileStampPigmentPaint, stampGrainDepthIn, type StampPaintMixing } from '../models/stamp-pigment-paint.ts';
import { compileStampWetness, STAMP_WET_CELL, type StampWetLanding, type StampWetness } from '../models/stamp-wetness.ts';
import { STAMP_WET_LAND_WGSL, stampFloodCarriesWater } from '../models/stamp-wet-landing.ts';
import { PAINT_DRY_BURNISHED_PRESS, paintPigmentSeed } from '#lib/paint/materials/models/paint-paper.ts';
import { PAINT_BANDS } from '#lib/paint/materials/models/paint-spectrum.ts';
import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { STAMP_GRID_AT_WGSL, STAMP_POLYGON_DISTANCE_WGSL, STAMP_REGION_WGSL, stampEdgeReach, stampEdgeWidth, stampPolygonBox, type StampBox, type StampPoint } from '../models/stamp-region.ts';
import type { PlacedStamp } from '#lib/paint/brush/models/stamp-placement.ts';
import { stampBlurRegion, type StampPixelBox } from '../models/stamp-blur-region.ts';
import { coarsestStampTipLevel, STAMP_TIP_HULL_SIDES, type StampTipHull, type StampTipLevel } from '../models/stamp-tip-hull.ts';
import { flatStampPaintCompositor, type StampPaintCompositor, type StampPaintTarget, type StampWashLayer } from './stamp-paint-compositor.ts';
import { stampPigmentCompositor } from './stamp-paint-pigment-compositor.ts';
import { FULL_FRAME_WGSL, type StampPaintDevice, type StampPaintImage } from './stamp-paint-gpu.ts';
import type { StampPaintGpuScope, StampPaintSurface } from './stamp-paint-surface.ts';
import { stampUniformLayout, stampUniformStruct, stampUniformWriter, type StampUniformViews } from './stamp-uniform-layout.ts';
import { STAMP_WET_STAGES, stampWetStageReach, type StampLoadedWetStage, type StampWetStage, type StampWetDepositMoment, type StampWetDryingMoment, type StampWetStageContext } from './stamp-wet-stages.ts';
import { stampWashDryings, type StampWashDrying } from '../models/stamp-wet-rim.ts';
import { stampPaintCheckpoints } from './stamp-paint-checkpoints.ts';
import { stampPaintEvents } from '../models/stamp-paint-events.ts';
import type { FrameProfileStart } from '#lib/picture/profiling/studio/frame-profile.ts';
import { stampPlacementWarpMap, stampWarpCells, stampWarpTriangles, STAMP_WARP_MOST_CELLS } from '../models/stamp-group-warp.ts';
import { stampFramePlan, stampGroupEvents, type StampGroupFrame } from '../models/stamp-frame-plan.ts';
import type { StampPaintFrameState } from '../models/stamp-paint-frame-state.ts';

/**
 * Floats per stamp in the instance buffer: x, y, diameter, rotation, then alpha, blur, grain turn and flips (x 1, y 2),
 * then opacity, roundness, grain depth and pressure.
 */
const STAMP_FLOATS = 12;
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
// \`share\`: the stamp's share of the grain's depth (PlacedStamp.grainDepth), 1 for any grain but a rolling one's.
fn grained(a: f32, raw: f32, mean: f32, p: Grain, share: f32) -> f32 {
  return grainCut(a, grainPaint(1.0 - raw, p.shape.z, p.shape.w, p.aboutMean == 1u, mean), p.shape.x * share, p.blend, p.layer == 1u);
}`;

const TURNED_WGSL = /* wgsl */ `
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
const STAMP_DRAW = stampUniformLayout('StampDraw', [
  ['resolution', 'vec2f'], ['roundness', 'f32'], ['rolling', 'u32'], ['grain', stampUniformStruct(GRAIN)], ['diameter', 'f32'], ['zoom', 'f32'],
  ['movement', 'f32'], ['hull', { vec4fArray: STAMP_TIP_HULL_SIDES / 2 }], ['span', 'f32'], ['towardFull', 'u32'], ['center', 'vec2f'], ['noise', 'f32'], ['pressed', 'vec4f'],
]);
const STAMP_WGSL = /* wgsl */ `
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
struct Corner { @builtin(position) position: vec4f, @location(0) tipUv: vec2f, @location(1) alpha: f32, @location(2) blur: f32, @location(3) grainUv: vec2f, @location(4) tint: vec4f, @location(5) toward: f32, @location(6) grainDepth: f32, @location(7) noiseAt: vec2f, @location(8) @interpolate(flat) seed: u32, @location(9) @interpolate(flat) pressure: f32, @location(10) @interpolate(flat) grow: f32 }
struct Covered { @location(0) mask: vec4f, @location(1) cap: vec4f }
struct Stamp { @location(0) mask: vec4f, @location(1) cap: vec4f, @location(2) tintA: vec4f, @location(3) tintB: vec4f }
${GRAIN_WGSL}
${TURNED_WGSL}
@vertex fn place(@builtin(vertex_index) i: u32, @location(0) stamp: vec4f, @location(1) more: vec4f, @location(2) tint: vec4f, @location(3) last: vec4f) -> Corner {
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
  let uv = corner + edge * ${STAMP_EDGE_SLIVER} / (vec2f(1.0, squash) * stamp.z * u.span);
  let local = turned((uv - u.center) * vec2f(1.0, squash) * stamp.z * u.span * mirror, stamp.w);
  let at = (stamp.xy + local) / u.resolution * 2.0 - 1.0;
  // A rolling grain turns with the stamp, grows with its size by zoom and travels the canvas by movement: at
  // movement 1 and constant size it lies still; as size or direction change it slides, a rolling grain's streak.
  let size = u.grain.place.xy * pow(stamp.z / u.diameter, u.zoom);
  let grainUv = turned(local, -more.z) / size + u.movement * stamp.xy / u.grain.place.xy + u.grain.place.zw;
  // A glaze or a build lays flow × opacity toward full; a buildToOpacity lays its flow toward its own opacity.
  let full = u.towardFull == 1u;
  // Noise goes by the tip's pixels at the stamp's width (tipNoiseAt), so it keeps its grain as a stamp shrinks.
  let grow = select(1.0, stamp.z / u.pressed.w, u.pressed.w > 0.0);
  return Corner(vec4f(at.x, -at.y, 0.0, 1.0), uv, select(more.x, more.x * opacity, full), more.y * ${STAMP_BLUR_LEVELS.toFixed(1)}, grainUv, tint, select(opacity, 1.0, full), last.z, uv * stamp.z * u.span, stampNoiseSeed(stamp.xy), last.w, grow);
}
// A stamp's paint (x) and its cap (y): the paint without its tip, how far a glaze's stroke may build there. A rolling
// grain, carried by the stamp, cuts each one.
fn covered(corner: Corner) -> vec2f {
  var tipped = 1.0 - textureSampleBias(tip, tipClamp, corner.tipUv, corner.blur).r;
  let touches = 1.0 - textureSampleBias(contact, tipClamp, corner.tipUv, corner.blur).r;
  if (u.pressed.x > 0.0) { tipped = pressedTip(tipped, touches, corner.pressure, u.pressed.x, u.pressed.y, u.pressed.z, corner.grow); }
  if (u.noise > 0.0) { tipped = tipNoise(tipped, tipNoiseAt(u32(max(floor(corner.noiseAt.x), 0.0)), u32(max(floor(corner.noiseAt.y), 0.0)), corner.seed), u.noise); }
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
}
// 1 past the stamp's pressure wherever it lays paint, kept by max, so 0 is where no stamp laid any and a stamp at
// pressure 0 still shows (StampPaintCompositor's reads.press).
@fragment fn pressOf(corner: Corner) -> @location(0) vec4f { return vec4f(select(0.0, 1.0 + corner.pressure, covered(corner).x > 0.0)); }`;

/** Pixels a side of the tiles an `ordered` layer's stamps are binned by (binOrderedStamps). */
const ORDERED_TILE = 32;

// An `ordered` layer is one triangle over the deposit's box: each pixel walks its tile's stamps in order, laying each
// by its accumulation's lay. A stamp's tip place inverts the fixed path's vertex transform; tip and rolling grain are
// sampled at that path's interpolated gradients, the tip's grown by its blur as the fixed path's bias grows it.
const ORDERED_DRAW = stampUniformLayout('OrderedDraw', [
  ['grain', stampUniformStruct(GRAIN)], ['roundness', 'f32'], ['rolling', 'u32'], ['diameter', 'f32'], ['zoom', 'f32'], ['movement', 'f32'],
  // `first`: the layer's first stamp's first float in its bound slice; `tint`: its first tint's index there.
  ['span', 'f32'], ['first', 'u32'], ['count', 'u32'], ['tint', 'u32'], ['bins', 'u32'], ['tilesX', 'u32'], ['accumulation', 'i32'], ['center', 'vec2f'], ['noise', 'f32'], ['pressed', 'vec4f'],
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
@group(0) @binding(8) var contact: texture_2d<f32>;
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
    let at = u.first + i * ${STAMP_FLOATS}u;
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
    let dx = turned(vec2f(1.0, 0.0), -rotation) / scale * blur;
    let dy = turned(vec2f(0.0, 1.0), -rotation) / scale * blur;
    var a = 1.0 - textureSampleGrad(tip, tipClamp, uv, dx, dy).r;
    let touches = 1.0 - textureSampleGrad(contact, tipClamp, uv, dx, dy).r;
    if (u.pressed.x > 0.0) { a = pressedTip(a, touches, stamps[at + 11u], u.pressed.x, u.pressed.y, u.pressed.z, select(1.0, z / u.pressed.w, u.pressed.w > 0.0)); }
    if (u.noise > 0.0) {
      let noiseAt = max(floor(uv * z * u.span), vec2f(0.0));
      a = tipNoise(a, tipNoiseAt(u32(noiseAt.x), u32(noiseAt.y), stampNoiseSeed(xy)), u.noise);
    }
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

/** The WGSL declaring a compositor's `target` as `name` at `binding`: storage with `access`, or sampled for null. */
function stampPaintTargetWgsl(name: string, binding: number, target: StampPaintTarget, access: 'read_write' | 'write' | null) {
  const array = target.kind === 'array' ? '_array' : '';
  const type = access ? `texture_storage_2d${array}<rgba16float, ${access}>` : `texture_2d${array}<f32>`;
  return `@group(0) @binding(${binding}) var ${name}: ${type};`;
}

/** A deposit's resolve uniform. Its compositor's PaintDeposit has a slot of its own, `paint`, as this one is full. */
const DEPOSIT = stampUniformLayout('Deposit', [
  ['view', 'vec4f'], ['edges', 'vec4f'], ['dualEdges', 'vec4f'],
  ['grain', stampUniformStruct(GRAIN)], ['dualGrain', stampUniformStruct(GRAIN)], ['paperDepth', 'f32'], ['paperLod', 'f32'], ['opacity', 'f32'],
  ['dualBlend', 'i32'], ['flags', 'u32'], ['resolveOrder', 'i32'], ['origin', 'vec2u'], ['extent', 'vec2u'],
  ['build', 'vec2f'], ['accumulation', 'vec2u'], ['pooling', 'vec4f'], ['press', 'f32'], ['beforeReach', 'f32'],
]);

/** What a deposit's resolve does, a bit each in its `flags`, and a WGSL constant each of the same name in capitals. */
const DEPOSIT_FLAGS = {
  canvasGrain: 1, dual: 2, dualCanvasGrain: 4, paper: 8, masked: 16, clipped: 32, clips: 64,
  pooled: 128, dualPooled: 256, dualLayer: 512, within: 1024, flood: 2048, floodWater: 4096,
} as const;

/**
 * Where a deposit's paint is kept, beside its Deposit (whose slot is full): its fluid's and `within`'s boxes (x, y,
 * width, height), and a fill's load field (STAMP_PAINT_FIELD_SHARE), front (normal, from, to, softness, progress)
 * and body levels as it lands outside a wash (FLOOD_LAND_COVER_WGSL); how far round a pixel its stroke's body is
 * looked for, where its coverage hardens (strokeBodyAt).
 */
const KEEP = stampUniformLayout('Keep', [
  ['fluid', 'vec4f'], ['within', 'vec4f'], ['load', 'vec4f'], ['front', 'vec4f'], ['loadEnds', 'vec2f'], ['frontShape', 'vec2f'], ['loadKind', 'i32'], ['bodyReach', 'f32'],
  ['bodyLevels', 'vec2f'],
]);
/**
 * A wash deposit's landing (StampWetLanding): its grids' lattice (x0, y0, cell) and size, where its wetness starts in
 * the wet grid buffer (workable and settled follow it), its painting time, its brush's water, a lift's strength, and
 * what it does.
 */
const WET_OP = stampUniformLayout('WetOp', [
  ['lattice', 'vec4f'], ['size', 'vec2u'], ['first', 'u32'], ['tau', 'f32'], ['water', 'f32'], ['strength', 'f32'], ['action', 'u32'],
]);
/** How far round a pixel a wash's resolve looks for its stroke's body (strokeBodyAt), as a share of the deposit's diameter: past a soft tip's shoulder. */
const WET_BODY_REACH = 0.2;
const WET_ACTIONS = { paint: 0, water: 1, lift: 2 } as const;
const WET_WGSL = /* wgsl */ `
${WET_OP.wgsl}
@group(0) @binding(18) var<storage, read> grid: array<f32>;
@group(0) @binding(19) var<uniform> wet: WetOp;
@group(0) @binding(20) var footprint: texture_storage_2d<rgba16float, write>;
${STAMP_GRID_AT_WGSL}
${Object.entries(WET_ACTIONS).map(([action, index]) => `const WET_${action.toUpperCase()} = ${index}u;`).join('\n')}
struct WetLanding { wetness: f32, workable: f32, settled: f32, tau: f32, water: f32, strength: f32, action: u32 }
fn wetLandingAt(at: vec2f) -> WetLanding {
  let points = wet.size.x * wet.size.y;
  return WetLanding(
    gridAt(at, wet.lattice.xyz, wet.size, wet.first), gridAt(at, wet.lattice.xyz, wet.size, wet.first + points),
    gridAt(at, wet.lattice.xyz, wet.size, wet.first + 2u * points), wet.tau, wet.water, wet.strength, wet.action,
  );
}
`;
// On paper drier than its water a wash brush's stroke stops at a hard edge (wetLandCover), before its grain and the
// paper's tooth, which break the hardened stroke as they would any.
const WET_HARDEN_COVER_WGSL = /* wgsl */ `let landing = wetLandingAt(at);
  raw.x = wetLandCover(raw.x, strokeBodyAt(pixel, raw.x, k.bodyReach), landing.water, landing.wetness);`;
// Outside a wash a flood carrying water (stampFloodCarriesWater) lands on dry paper: hardened to its water's edge
// (wetLandCover), as a wash's would be there. Only its fringe looks round for its body: none lands where nothing
// covers, and paint its body has built to is its own body (a body's pixel resolves as laid() lays it).
const FLOOD_LAND_COVER_WGSL = /* wgsl */ `if ((u.flags & FLOOD_WATER) != 0u && raw.x > 0.0
    && raw.x < accumulationResolve(k.bodyLevels.x, k.bodyLevels.y, k.bodyLevels.y, u.build.x, i32(u.accumulation.x))) {
    raw.x = wetLandCover(raw.x, strokeBodyAt(pixel, raw.x, k.bodyReach), 1.0, 0.0);
  }`;
// A wash deposit lands, and leaves its footprint for the stages after it (StampWetDepositMoment): what it laid, where
// paint may land at all, and the paper's tooth.
const WET_LAND_WGSL = /* wgsl */ `landDeposit(pixel, coverage, rims, tooth, at, reserved, landing);
  var allowed = 1.0;
  if ((u.flags & MASKED) != 0u) { allowed *= 1.0 - regionAt(fluid, k.fluid, pixel); }
  if ((u.flags & WITHIN) != 0u) { allowed *= regionAt(within, k.within, pixel); }
  if ((u.flags & CLIPPED) != 0u) { allowed *= clamp(clipped.r, 0.0, 1.0); }
  textureStore(footprint, pixel, vec4f(coverage, allowed, tooth));`;
const DEPOSIT_FLAGS_WGSL = Object.entries(DEPOSIT_FLAGS).map(([flag, bit]) => `const ${flag.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()} = ${bit}u;`).join('\n');

// The layer as the deposit found it (StampPaintCompositor's reads.before), read round each pixel.
const beforeWgsl = (layer: StampPaintTarget) => `@group(0) @binding(23) var before: ${layer.kind === 'array' ? 'texture_2d_array<f32>' : 'texture_2d<f32>'};`;
// How hard a deposit pressed at a pixel: its stamps' pressure there (pressOf), firm where none laid it (a flood's
// body), and \`u.press\` harder for a burnish, so a burnishing hand still eases where it turns.
const PRESS_AT_WGSL = /* wgsl */ `@group(0) @binding(22) var pressed: texture_2d<f32>;
fn pressAt(pixel: vec2u) -> f32 {
  let p = textureLoad(pressed, pixel, 0).r;
  return select(1.0, p - 1.0, p > 0.0) + u.press;
}`;

/**
 * Each resolve stage on the main layer's coverage `m`: `d` is the dual's, cut and pooled already, `at` the pixel. A
 * traced resolve records `m` after each (traced), so what a diagnosis reads is what the frame lays.
 */
const RESOLVE_STAGES_WGSL = stampResolveOrdersWgsl('resolveStages', 'd: f32, at: vec2f', {
  grain: 'if ((u.flags & CANVAS_GRAIN) != 0u) { m = texturized(grain, at, m, u.grain); }',
  dual: 'if ((u.flags & DUAL) != 0u) { m = dualCombine(m, d, u.dualBlend, (u.flags & DUAL_LAYER) != 0u); }',
  pooling: 'if ((u.flags & POOLED) != 0u) { m = pooled(m, u.pooling.x, u.pooling.y); }',
}, (position) => `traced(${position}u, m);`);

/** Values a traced resolve records per pixel: the build as its accumulation resolves it, after each stage, and the coverage laid. */
const TRACE_SLOTS = STAMP_RESOLVE_PLANS.grainFirst.length + 2;

/** A traced deposit's crop (its origin and size in the painting's pixels) and where in the trace buffer its slots start, in floats. */
const TRACE_CROP = stampUniformLayout('TraceCrop', [['origin', 'vec2u'], ['extent', 'vec2u'], ['offset', 'u32']]);

// A compute pass has no derivatives, so each grain's mip level is worked out on the CPU. A wash's resolve (`wet`) is
// a module of its own: WGSL counts a binding read under a false override as used, and a dry resolve mustn't hold
// the wet bindings.
const depositWgsl = (compositor: StampPaintCompositor, wet: boolean) => /* wgsl */ `
${DEPOSIT.wgsl}
${compositor.deposit.layout.wgsl}
${stampPaintTargetWgsl('layer', 8, compositor.targets.layer, 'read_write')}
${compositor.deposit.wgsl}
${GRAIN_WGSL}
${DEPOSIT_FLAGS_WGSL}
${STAMP_ACCUMULATION_RESOLVE_WGSL}
${RESOLVE_STAGES_WGSL}
${KEEP.wgsl}
${TRACE_CROP.wgsl}
${STAMP_PAINT_FIELD_SHARE.wgsl}
${STAMP_FLOOD_FRONT_SHARE_WGSL}
${STAMP_WET_LAND_WGSL}
${wet ? `${WET_WGSL}\n${stampPaintTargetWgsl('fresh', 21, compositor.targets.layer, 'write')}\n${compositor.deposit.wet}` : ''}
${compositor.reads.press ? PRESS_AT_WGSL : ''}
${compositor.reads.before ? beforeWgsl(compositor.targets.layer) : ''}
// The diagnostic variant (StampPaintRenderer's trace): the same resolve, recording each stage's coverage as it goes.
override TRACE: bool = false;
var<private> tracedPixel: vec2u;
// Records \`value\` as the pixel's \`slot\` (TRACE_SLOTS a pixel, each a plane of the crop), within the traced crop.
fn traced(slot: u32, value: f32) {
  if (!TRACE) { return; }
  let q = tracedPixel - tracing.origin;
  if (any(tracedPixel < tracing.origin) || any(q >= tracing.extent)) { return; }
  traces[tracing.offset + (slot * tracing.extent.y + q.y) * tracing.extent.x + q.x] = value;
}
@group(0) @binding(0) var<uniform> u: Deposit;
@group(0) @binding(1) var mask: texture_2d<f32>;
@group(0) @binding(2) var blurred: texture_2d<f32>;
@group(0) @binding(3) var grain: texture_2d<f32>;
@group(0) @binding(4) var dualGrain: texture_2d<f32>;
@group(0) @binding(5) var paperGrain: texture_2d<f32>;
@group(0) @binding(6) var fluid: texture_2d<f32>;
@group(0) @binding(7) var clip: texture_storage_2d<rgba16float, read_write>;
@group(0) @binding(9) var linearClamp: sampler;
@group(0) @binding(10) var tile: sampler;
@group(0) @binding(11) var<storage, read_write> traces: array<f32>;
@group(0) @binding(12) var<uniform> tracing: TraceCrop;
@group(0) @binding(13) var cap: texture_2d<f32>;
@group(0) @binding(14) var mirrorTile: sampler;
@group(0) @binding(15) var<uniform> k: Keep;
@group(0) @binding(16) var within: texture_2d<f32>;
@group(0) @binding(17) var<uniform> paint: ${compositor.deposit.layout.name};
// A region texture's value at a pixel, its box's x, y, width and height in the painting's pixels: none outside it.
fn regionAt(region: texture_2d<f32>, box: vec4f, pixel: vec2u) -> f32 {
  let q = vec2f(pixel) - box.xy;
  if (any(q < vec2f(0.0)) || any(q >= box.zw)) { return 0.0; }
  return textureLoad(region, vec2u(q), 0).r;
}
fn texturized(g: texture_2d<f32>, at: vec2f, a: f32, p: Grain) -> f32 {
  let uv = at / p.place.xy + p.place.zw;
  let raw = select(textureSampleLevel(g, tile, uv, p.shape.y).r, textureSampleLevel(g, mirrorTile, uv, p.shape.y).r, p.mirror == 1u);
  return grained(a, raw, grainMean(g, tile), p, 1.0);
}

// Where the mask stands above its blur, as steeply as the edge's sharpness says.
fn rimOf(a: f32, soft: f32, sharpness: f32) -> f32 { return clamp((a - soft) * sharpness, 0.0, 1.0); }
// The stroke's body near \`pixel\`: the most its build reaches within \`reach\`, in the deposit's box, so a hardened edge
// keeps the stroke's own density.
fn strokeBodyAt(pixel: vec2u, here: f32, reach: f32) -> f32 {
  var body = here;
  let lo = vec2f(u.origin);
  let hi = vec2f(u.origin + u.extent) - 1.0;
  for (var i = 0; i < 12; i++) {
    let outer = i < 8;
    let angle = select(f32(i - 8) * 1.5708 + 0.3927, f32(i) * 0.7854, outer);
    let q = vec2u(clamp(vec2f(pixel) + select(0.5, 1.0, outer) * reach * vec2f(cos(angle), sin(angle)), lo, hi));
    let kept = textureLoad(cap, q, 0);
    body = max(body, accumulationResolve(textureLoad(mask, q, 0).r, kept.b, kept.r, u.build.x, i32(u.accumulation.x)));
  }
  return body;
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn deposit(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let at = vec2f(pixel) + 0.5;
  tracedPixel = pixel;
  // Each layer's stroke as its accumulation resolves it: a glaze's from its densest stamp (the cap's blue or alpha)
  // toward the build held under its cap (red or green).
  let built = textureLoad(mask, pixel, 0).rg;
  let kept = textureLoad(cap, pixel, 0);
  var raw = vec2f(
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
  }
  ${wet ? WET_HARDEN_COVER_WGSL : FLOOD_LAND_COVER_WGSL}
  // The stages in the order of the brush's plan (STAMP_RESOLVE_PLANS), or a diagnosis's.
  traced(0u, raw.r);
  var m = resolveStages(raw.r, d, at, u.resolveOrder);
  // A wet rim is laid after the dual combines, as the whole stroke's pigment gathers there, but through the grain: a
  // grain that breaks the body into flecks breaks its rim too.
  var wet = rimOf(raw.r, soft.r, u.edges.y) * u.edges.x;
  if ((u.flags & CANVAS_GRAIN) != 0u) { wet = texturized(grain, at, wet, u.grain); }
  m += wet;
  var keep = 1.0;
  // What \`keep\` would be without the fluid, and how much the fluid held off (\`held\`), for reserved below.
  var reach = 1.0;
  var held = 0.0;
  // No tooth reads as an even paper: its paint and mean alike.
  var tooth = vec2f(0.5);
  // A paper's tooth tiles mirrored, a photograph not being seamless; its mean is its smallest mip.
  if ((u.flags & PAPER) != 0u) {
    tooth = vec2f(1.0 - textureSampleLevel(paperGrain, mirrorTile, at / u.view.zw, u.paperLod).r, 1.0 - textureSampleLevel(paperGrain, tile, vec2f(0.5), 16.0).r);
    keep *= paperKept(tooth.x, tooth.y, u.paperDepth);
    reach = keep;
  }
  if ((u.flags & MASKED) != 0u) {
    held = regionAt(fluid, k.fluid, pixel);
    keep *= 1.0 - held;
  }
  if ((u.flags & WITHIN) != 0u) {
    let inside = regionAt(within, k.within, pixel);
    keep *= inside;
    reach *= inside;
  }
  // A fill's load is how much paint it lays, and its front how much of it shows yet: burnt edges and a clip base alike.
  if ((u.flags & FLOOD) != 0u) {
    let load = clamp(mix(k.loadEnds.x, k.loadEnds.y, paintFieldShare(at, k.loadKind, k.load)), 0.0, 1.0);
    keep *= load;
    reach *= load;
    let front = floodFrontShare(at, k.front.xy, k.front.z, k.front.w, k.frontShape.x, k.frontShape.y);
    keep *= front;
    reach *= front;
  }
  let clipped = textureLoad(clip, pixel);
  if ((u.flags & CLIPPED) != 0u) {
    let inClip = clamp(clipped.r, 0.0, 1.0);
    keep *= inClip;
    reach *= inClip;
  }
  let coverage = clamp(m, 0.0, 1.0) * keep * u.opacity;
  // In a knockout, its reserve: the fluid within the deposit's reach, however its brush's marks cover, as the paint
  // behind is whole and only the fluid kept it off.
  let reserved = reach * held * u.opacity;
  traced(${TRACE_SLOTS - 1}u, coverage);
  // A burnt rim burns into paint already there, the group's or the deposit's own (its stamps laid over one another).
  let burnable = max(layerCoverage(pixel), clamp(m, 0.0, 1.0)) * keep * u.opacity;
  let rims = vec2f(clamp(burnt, 0.0, 1.0) * burnable, clamp(dualBurnt, 0.0, 1.0) * burnable);
  ${wet ? WET_LAND_WGSL : `layDeposit(pixel, coverage, rims, tooth, at, ${compositor.reads.press ? 'pressAt(pixel)' : '1.0'});`}
  if ((u.flags & CLIPS) != 0u) { textureStore(clip, pixel, vec4f(coverage) + clipped * (1.0 - coverage)); }
}`;

const PAPER = stampUniformLayout('Paper', [['color', 'vec3f'], ['hasImage', 'u32'], ['cover', 'vec2f'], ['lod', 'f32']]);
const PAPER_COLOR_WGSL = /* wgsl */ `
${PAPER.wgsl}
// The paper's gamma-encoded colour at point \`at\` of a painting \`size\` big: its photograph's, covering the painting, or its colour.
fn paperColor(image: texture_2d<f32>, paperSampler: sampler, p: Paper, at: vec2f, size: vec2u) -> vec3f {
  let uv = at / vec2f(size);
  if (p.hasImage == 1u) { return textureSampleLevel(image, paperSampler, (uv - 0.5) * p.cover + 0.5, p.lod).rgb; }
  return p.color;
}`;
const paperWgsl = (compositor: StampPaintCompositor) => /* wgsl */ `
${stampPaintTargetWgsl('painting', 2, compositor.targets.painting, 'write')}
${compositor.paper}
${PAPER_COLOR_WGSL}
@group(0) @binding(0) var<uniform> u: Paper;
@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(3) var linearClamp: sampler;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn paper(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(painting);
  if (any(id.xy >= size)) { return; }
  layPaper(id.xy, paperColor(image, linearClamp, u, vec2f(id.xy) + 0.5, size));
}`;

/** A scene pixel's rest point where no moved or warped group's lattice covers it: outside any layer. */
const STAMP_NO_REST = -65536;

// \`group\` is its index in the painting, and \`paper\` the paper under it, for a compositor that lays a group on bare paper.
// A scene pixel reads that paper where it is, unless the group carries its own paper as it moves or warps
// (StampGroupPaper, \`paperFromRest\`): then where the layer's texel it lays was painted.
const GROUP = stampUniformLayout('Group', [
  ['opacity', 'f32'], ['glaze', 'u32'], ['origin', 'vec2u'], ['extent', 'vec2u'], ['group', 'u32'], ['paper', stampUniformStruct(PAPER)], ['paperFromRest', 'u32'],
]);
/** Where the moved group pass binds the rest point of each scene pixel, past any compositor's own bindings. */
const GROUP_REST_BINDING = 16;
const groupWgsl = (compositor: StampPaintCompositor, moved: boolean) => {
  const { layer, painting } = compositor.targets;
  const layerAt = (texel: string) => (layer.kind === 'array' ? `textureLoad(layer, ${texel}, l, 0)` : `textureLoad(layer, ${texel}, 0)`);
  const paintingAt = painting.kind === 'array' ? 'textureLoad(painting, pixel, i)' : 'textureLoad(painting, pixel)';
  const store = (value: string) => (painting.kind === 'array' ? `textureStore(painting, pixel, i, ${value})` : `textureStore(painting, pixel, ${value})`);
  const paintingLayers = painting.kind === 'array' ? painting.layers : 1;
  const common = /* wgsl */ `
${stampPaintTargetWgsl('layer', 1, layer, null)}
${stampPaintTargetWgsl('painting', 2, painting, 'read_write')}
${PAPER_COLOR_WGSL}
${GROUP.wgsl}
@group(0) @binding(0) var<uniform> u: Group;
fn groupUnderAt(pixel: vec2u, i: u32) -> vec4f { return ${paintingAt}; }`;
  if (!moved) return /* wgsl */ `${common}
fn groupLayerAt(pixel: vec2u, l: u32) -> vec4f { return ${layerAt('pixel')}; }
fn groupLaid(pixel: vec2u, i: u32, value: vec4f) { ${store('value')}; }
fn groupPaperAt(pixel: vec2u) -> vec2f { return vec2f(pixel) + 0.5; }
${compositor.group.wgsl}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn group(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  layGroup(u.origin + id.xy, u.glaze == 1u, u.opacity);
}`;
  // Each of the four texels round a pixel's rest point is laid as it would be unmoved, and the laid paint blended
  // bilinearly. Blending amounts before the lay instead fills a dry medium's tooth: KM isn't linear in its films.
  return /* wgsl */ `${common}
@group(0) @binding(${GROUP_REST_BINDING}) var rest: texture_2d<f32>;
var<private> tapTexel: vec2i;
var<private> tapLaid: array<vec4f, ${paintingLayers}>;
fn groupLayerAt(pixel: vec2u, l: u32) -> vec4f {
  if (any(tapTexel < vec2i(0)) || any(tapTexel >= vec2i(textureDimensions(layer)))) { return vec4f(0.0); }
  return ${layerAt('vec2u(tapTexel)')};
}
fn groupLaid(pixel: vec2u, i: u32, value: vec4f) { tapLaid[i] = value; }
fn groupPaperAt(pixel: vec2u) -> vec2f {
  if (u.paperFromRest == 1u) { return vec2f(tapTexel) + 0.5; }
  return vec2f(pixel) + 0.5;
}
${compositor.group.wgsl}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn group(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let q = textureLoad(rest, pixel, 0).xy - 0.5;
  if (q.x < ${STAMP_NO_REST / 2}.0) { return; }
  let base = floor(q);
  let f = q - base;
  var blended: array<vec4f, ${paintingLayers}>;
  for (var k = 0u; k < 4u; k++) {
    let corner = vec2u(k & 1u, k >> 1u);
    let w = select(1.0 - f.x, f.x, corner.x == 1u) * select(1.0 - f.y, f.y, corner.y == 1u);
    if (w == 0.0) { continue; }
    tapTexel = vec2i(base) + vec2i(corner);
    for (var i = 0u; i < ${paintingLayers}u; i++) { tapLaid[i] = groupUnderAt(pixel, i); }
    layGroup(pixel, u.glaze == 1u, u.opacity);
    for (var i = 0u; i < ${paintingLayers}u; i++) { blended[i] += w * tapLaid[i]; }
  }
  for (var i = 0u; i < ${paintingLayers}u; i++) { ${store('blended[i]')}; }
}`;
};

// A moved or warped group's lattice (stamp-group-warp.ts) rasterised into \`rest\`: each scene pixel it covers learns the
// rest point it shows, inverting the field for free; the rest keep STAMP_NO_REST, outside any layer. Where the field
// folds, a later triangle covers an earlier one unless its rest point holds nothing: bare lattice mustn't hide paint.
const groupLatticeWgsl = (layer: StampPaintTarget) => /* wgsl */ `
${stampPaintTargetWgsl('source', 0, layer, null)}
@group(0) @binding(1) var linearClamp: sampler;
struct LatticePoint { @builtin(position) at: vec4f, @location(0) rest: vec2f };
@vertex fn latticeVertex(@location(0) clip: vec2f, @location(1) rest: vec2f) -> LatticePoint { return LatticePoint(vec4f(clip, 0.0, 1.0), rest); }
@fragment fn latticeRest(point: LatticePoint) -> @location(0) vec4f {
  let uv = point.rest / vec2f(textureDimensions(source));
  var held = vec4f(0.0);
  ${layer.kind === 'array'
    ? `for (var l = 0u; l < ${layer.layers}u; l++) { held += abs(textureSampleLevel(source, linearClamp, uv, l, 0.0)); }`
    : 'held = abs(textureSampleLevel(source, linearClamp, uv, 0.0));'}
  if (all(held == vec4f(0.0))) { discard; }
  return vec4f(point.rest, 0.0, 1.0);
}`;

/** A boiling group's epochs kept on the GPU besides its first: the one drawing, and a couple a scrub returns to. */
const STAMP_BOIL_EPOCHS_KEPT = 3;
/** A live group's marks kept on the GPU: the frame drawing's, and the last, which a hold on twos draws again. */
const STAMP_LIVE_MARKS_KEPT = 2;

const outputWgsl = (compositor: StampPaintCompositor, dithered: boolean) => /* wgsl */ `
${FULL_FRAME_WGSL}
${stampPaintTargetWgsl('painting', 0, compositor.targets.painting, null)}
${compositor.output}
@fragment fn output(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let pixel = vec2u(at.xy);
  let color = screenColor(pixel);
  // An ordered dither, the same each frame, so a smooth flood doesn't band when the half floats become bytes.
  let dither = ${dithered ? '(fract(dot(vec2f(pixel), vec2f(0.7548776662, 0.5698402910))) - 0.5) / 255.0' : '0.0'};
  return vec4f(clamp(color + dither, vec3f(0.0), vec3f(1.0)), 1.0);
}`;

// A state of the masking fluid over its box: the state it's built on (`parent`, width 0 for none), then `opCount` ops
// from `firstOp`, a mask joining its region by max, an unmask lifting its amount, everywhere without a region
// (`count` 0). An op's region is worked out only within its `reach`, beyond which it's 0.
const MASK_STEP = stampUniformLayout('MaskStep', [['box', 'vec4f'], ['parent', 'vec4f'], ['firstOp', 'u32'], ['opCount', 'u32']]);
const MASK_OP_WORDS = 12;
const MASK_STEP_WGSL = /* wgsl */ `
${COVERAGE_FORMULAS_WGSL}
${STAMP_REGION_WGSL}
${FULL_FRAME_WGSL}
${MASK_STEP.wgsl}
struct MaskOp { reach: vec4f, ragged: vec2f, width: f32, amount: f32, first: u32, count: u32, kind: u32, seed: u32 }
@group(0) @binding(0) var<uniform> u: MaskStep;
@group(0) @binding(1) var<storage, read> points: array<vec2f>;
@group(0) @binding(2) var parent: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> ops: array<MaskOp>;
${STAMP_POLYGON_DISTANCE_WGSL}
@fragment fn maskStep(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let p = at.xy + u.box.xy;
  var fluid = 0.0;
  let q = floor(p) - u.parent.xy;
  if (all(q >= vec2f(0.0)) && all(q < u.parent.zw)) { fluid = textureLoad(parent, vec2u(q), 0).r; }
  for (var i = u.firstOp; i < u.firstOp + u.opCount; i++) {
    let op = ops[i];
    var r = 1.0;
    if (op.count > 0u) {
      r = 0.0;
      if (all(p >= op.reach.xy) && all(p <= op.reach.zw)) {
        var moved = 0.0;
        if (op.ragged.y > 0.0) { moved = op.ragged.x * edgeNoise(p.x / op.ragged.y, p.y / op.ragged.y, op.seed); }
        r = edgeCoverage(polygonDistance(p, op.first, op.count) + moved, op.width);
      }
    }
    fluid = select(fluid * (1.0 - op.amount * r), max(fluid, r), op.kind == 0u);
  }
  return vec4f(fluid);
}`;

// A flood's body over its box (floodBody), how thick its region is read from its grid (gridAt): the grid's first value
// in `grid`, its origin and cell, and its columns and rows.
const FLOOD_BODY = stampUniformLayout('FloodBody', [['box', 'vec4f'], ['grid', 'vec4f'], ['gridSize', 'vec2u'], ['first', 'u32'], ['count', 'u32'], ['gridFirst', 'u32'], ['inset', 'f32']]);
const FLOOD_BODY_WGSL = /* wgsl */ `
${COVERAGE_FORMULAS_WGSL}
${STAMP_REGION_WGSL}
${FULL_FRAME_WGSL}
${FLOOD_BODY.wgsl}
@group(0) @binding(0) var<uniform> u: FloodBody;
@group(0) @binding(1) var<storage, read> points: array<vec2f>;
@group(0) @binding(2) var<storage, read> grid: array<f32>;
${STAMP_POLYGON_DISTANCE_WGSL}
${STAMP_GRID_AT_WGSL}
@fragment fn floodBodyAt(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let p = at.xy + u.box.xy;
  return vec4f(floodBody(polygonDistance(p, u.first, u.count), gridAt(p, u.grid.xyz, u.gridSize, u.gridFirst), u.inset));
}`;

// A flood's body joined to its stamps' build, in the stamps' render pass, before rims blur it: its box, levels
// (stampFloodBodyLevels) and tint (CompiledStampFlood's). Its blend joins it as the accumulation lays paint: screen
// toward full, else max; a glaze's cap by max; its tint over the stamps', so inside it their jitter evens to its mean.
const BODY_DRAW = stampUniformLayout('BodyDraw', [['box', 'vec4f'], ['tint', 'vec4f'], ['levels', 'vec2f']]);
const BODY_DRAW_WGSL = /* wgsl */ `
${FULL_FRAME_WGSL}
${BODY_DRAW.wgsl}
@group(0) @binding(0) var<uniform> u: BodyDraw;
@group(0) @binding(1) var body: texture_2d<f32>;
struct Covered { @location(0) mask: vec4f, @location(1) cap: vec4f }
struct Stamp { @location(0) mask: vec4f, @location(1) cap: vec4f, @location(2) tintA: vec4f, @location(3) tintB: vec4f }
fn bodyAt(at: vec4f) -> f32 {
  let q = floor(at.xy) - u.box.xy;
  if (any(q < vec2f(0.0)) || any(q >= u.box.zw)) { return 0.0; }
  return textureLoad(body, vec2u(q), 0).r;
}
fn laid(b: f32) -> Covered { return Covered(vec4f(b * u.levels.x), vec4f(b * u.levels.y, 0.0, b * u.levels.y, 0.0)); }
@fragment fn laidBody(@builtin(position) at: vec4f) -> Covered { return laid(bodyAt(at)); }
// A tinted pass's body lays its stamps' mean tint, premultiplied by the body, as coverTinted lays a stamp's.
@fragment fn laidBodyTinted(@builtin(position) at: vec4f) -> Stamp {
  let b = bodyAt(at);
  let c = laid(b);
  return Stamp(c.mask, c.cap, vec4f(u.tint.xyz * b, b), vec4f(u.tint.w * b, 0.0, 0.0, b));
}`;

/** The most a painting's region textures (fill bodies, masking fluid, `within` regions) may take, bytes. */
const STAMP_REGION_BUDGET = 512 * 1024 * 1024;
/**
 * Half floats: a state of the fluid is built on the one under it, and a chain of slight unmasks would round back to
 * where it began in bytes.
 */
const STAMP_REGION_FORMAT = 'r16float', STAMP_REGION_TEXEL_BYTES = 2;

const assetKey = ({ style, pack, file }: StampBrushAsset) => `${style}/${pack}/${file}`;

/** Every image a painting and its paper need, each once, with how it wraps: a grain tiles, a tip or photograph doesn't. */
function paintingImages(painting: CompiledStampPaint, paper: StampPaintPaper): [StampBrushAsset, 'tile' | 'clamp'][] {
  const assets = painting.groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass).flatMap(({ brush }) =>
    stampBrushImages(brush).map(({ image, wrap }): [StampBrushAsset, 'tile' | 'clamp'] => [image, wrap]))));
  if (paper.image) assets.push([paper.image, 'clamp']);
  if (paper.grain) assets.push([paper.grain.image, 'tile']);
  return [...new Map(assets.map((entry) => [assetKey(entry[0]), entry])).values()];
}

type Box = StampPixelBox;

/** A brush's layer with its images on the GPU. */
type BoundLayer = StampBrushLayer<StampPaintImage>;

/** How many diameters wide a layer's tip image is drawn. */
const spanOf = (layer: BoundLayer) => layer.tip.span ?? 1;

/** A tip image's height over its width: a stamp keeps its image's proportions, then its roundness squashes it. */
const aspectOf = (layer: BoundLayer) => layer.tip.image.height / layer.tip.image.width;

/** How many diameters a layer's stamp spans along its image's longer side, which bounds how far it reaches. */
const reachSpanOf = (layer: BoundLayer) => spanOf(layer) * Math.max(1, aspectOf(layer));

/** Stamps whose bounds are kept together: a box is found from the chunks before it and the stamps within its own. */
const REACH_CHUNK = 256;

/**
 * How far `stamps` reach, for each whole chunk of them from the first: x0, y0, x1, y1 of stamps 0 to the chunk's end.
 * A stamp's corners reach 0.75 of its tip image's longer side (`span` diameters) from its centre, however it's turned.
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
 * A deposit as the GPU holds it: where its stamps and dual stamps start in its bank's instance buffer, where its tints
 * start in the tint buffer (null for a brush without colour dynamics), and what's fixed.
 */
type LoadedDeposit = {
  /**
   * The deposit as written: itself, or for a boil's epoch or live marks the deposit it re-places, whose brush, paint
   * and trace it shares.
   */
  identity: CompiledStampDeposit;
  /**
   * The deposit its bank's regions and wet stages know (BankHome): as written, but for live marks itself, whose fill
   * body, fluid and landing are its own pose's.
   */
  staged: CompiledStampDeposit;
  home: BankHome;
  stampBuffer: GPUBuffer; tintBuffer: GPUBuffer; binBuffer: GPUBuffer;
  /** A wash deposit's landing and where its grids start in the painting's wet grid buffer; null outside a wash. */
  landing: StampWetLanding | null; wetFirst: number | null;
  /** Its brush with each image bound to its texture, and which of its layers' stages are active. */
  brush: StampBrush<StampPaintImage>;
  active: ReturnType<typeof stampActiveLayers<StampPaintImage>>;
  main: number; dual: number; tint: number | null;
  /** Writes its compositor's PaintDeposit at scene time `t` into a uniform slot. */
  writePaint: (views: StampUniformViews, t: number) => void;
  mainReach: Float64Array; dualReach: Float64Array;
  mainHull: StampTipHull; dualHull: StampTipHull | null;
  /** How each layer's stamps are laid, and an `ordered` layer's bins' table in the bin buffer (binOrderedStamps). */
  mainPlan: LoadedPlan; dualPlan: LoadedPlan | null;
  /** Its plan's order's case in the resolve (stampResolveOrderIndex). */
  resolveOrder: number;
};

/**
 * What a bank's deposits are drawn with beyond their stamps: every landing's grids, the regions worked out for them
 * (fill bodies, fluid, `within`), the wet stages loaded for their washes, and each wash drying by the deposit it ends
 * after. The painting's own bank has one; a boil's epoch shares it, landing as written; live marks have their own.
 */
type BankHome = {
  grids: { buffer: GPUBuffer; firsts: ReadonlyMap<CompiledStampDeposit, number> };
  regions: LoadedRegions;
  stages: readonly LoadedWetStage[];
  dryingsByLast: ReadonlyMap<CompiledStampDeposit, StampWashDrying>;
};

/**
 * A set of deposits on the GPU (loadBank), their washes' wetness, what they're drawn with (`home`), and how to free
 * them. `own`: its home knows its own deposits and passes (live marks), not those as written.
 */
type DepositBank = { deposits: Map<CompiledStampDeposit, LoadedDeposit>; wetness: StampWetness | null; home: BankHome; own: boolean; destroy: () => void };

/** How a bank is loaded: the painting as written, its wetness worked out; a boil's epoch of it; or a group's live marks. */
type BankSource = { kind: 'written'; wetness: StampWetness | null } | { kind: 'epoch'; written: DepositBank } | { kind: 'live' };

/**
 * A deposit to trace in a frame: the pixels to record, and the order its stages run in, its brush's plan's unless a
 * diagnosis asks for another (the frame then lays it in that order too).
 */
export type StampDepositTraceRequest = { deposit: CompiledStampDeposit; crop: StampPixelBox; order?: readonly StampResolveStage[] };

/**
 * A traced deposit over its crop, row by row: its build as its accumulation resolves it, its coverage after each stage
 * in the order it ran, and the coverage it laid (kept and at its opacity). All 0 where it paints nothing, as outside
 * the pixels its stamps reach or when it doesn't show yet.
 */
export type StampDepositTrace = { crop: StampPixelBox; built: Float32Array; stages: { stage: StampResolveStage; coverage: Float32Array }[]; coverage: Float32Array };

/** A frame's traces: each traced deposit's request and where its slots start in `buffer`, in floats. */
type FrameTrace = { deposits: Map<CompiledStampDeposit, { request: StampDepositTraceRequest; order: number; offset: number }>; buffer: GPUBuffer };

/** A region worked out at load (a flood's body, a state of the fluid, a `within`): its texture and its box on the painting. */
type RegionTexture = { view: GPUTextureView; box: Box };

/** A bank's regions: each flood's body by its deposit, each state of the fluid a deposit lands under, each pass's `within`. */
type LoadedRegions = {
  bodies: ReadonlyMap<CompiledStampDeposit, RegionTexture | null>;
  fluids: ReadonlyMap<CompiledStampMask, RegionTexture | null>;
  withins: ReadonlyMap<CompiledStampPass, RegionTexture | null>;
};

export type StampPaintRenderer = {
  /**
   * Draws `painting` as it stands `t` seconds into its scene, each group in the state `frame` gives it (as painted
   * where it gives none). Resolves once WebGPU has checked the draw, or rejects with its error: hold the frame until
   * then, so a broken draw fails its own frame.
   */
  draw: (t: number, frame?: StampPaintFrameState) => Promise<void>;
  /** Resolves once the GPU has finished what's been drawn: for timing a draw, which a render never needs. */
  finish: () => Promise<void>;
  /**
   * Draws the frame at `t` as `draw` does, recording each requested deposit's resolve stage by stage, read back once:
   * for diagnosing a brush against a capture, not for rendering. Throws on a deposit not in the painting or asked for twice.
   */
  trace: (t: number, requests: readonly StampDepositTraceRequest[], frame?: StampPaintFrameState) => Promise<StampDepositTrace[]>;
  /**
   * Draws the frame at `t` as `draw` does and reads back the layer its last group left, before that group dried
   * into the painting: for checking what the compositor laid (the GPU gate's pigment checks), not for rendering.
   */
  readLayer: (t: number, frame?: StampPaintFrameState) => Promise<StampLayerReadback>;
  /** Frees what the painting loaded; its surface stays for the next. */
  dispose: () => void;
};

/**
 * A group's layer as read back: `layers` of rgba16float, each `width` × `height`, in `values` layer by layer, row by
 * row, four channels a pixel. For pigment, layer 0's first channel is coverage and each other channel a pigment's amount.
 */
export type StampLayerReadback = { width: number; height: number; layers: number; values: Float32Array };

/** An IEEE half-float's bits as a number. */
function halfFloat(bits: number): number {
  const exponent = (bits >> 10) & 0x1f, fraction = bits & 0x3ff, sign = bits & 0x8000 ? -1 : 1;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 0x1f) return fraction ? NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

export type StampPaintRendererOptions = {
  fps?: number;
  /** Times the load's parts, for `studio profile`. */
  profile?: FrameProfileStart | null;
  /** The wet stages its washes run: every one, but for a check measuring what some do. */
  wetStages?: readonly StampWetStage[];
};

/** The most lattice cells a frame lays `group` through: a warp's most, a move's one, none still. */
const latticeCellsMost = ({ moved, warp }: StampGroupFrame) => (warp ? STAMP_WARP_MOST_CELLS ** 2 : Number(!!moved));

/**
 * A renderer for one painting on `surface`, mixed as `mixing` says; `fps` counts a boiling group's epochs (required
 * for one); `profile` times the load's parts. Refuses a painting it can't mix. A frame may round a few pixels a level
 * differently between draws (docs/private-styles.md, "Same pixels").
 */
export async function createStampPaintRenderer(
  surface: StampPaintSurface, painting: CompiledStampPaint, paper: StampPaintPaper, mixing: StampPaintMixing,
  { fps, profile, wetStages = STAMP_WET_STAGES }: StampPaintRendererOptions = {},
): Promise<StampPaintRenderer> {
  const span = profile ?? (() => () => {});
  const boiling = painting.groups.find((group) => group.boil);
  if (boiling && !(fps && fps > 0)) throw new Error(`stamp paint: ${boiling.id} boils every ${boiling.boil!.every} frames, so its renderer needs the scene's fps`);
  let done = span('stamp paint compositor load');
  const { compositorOn, wetnessOf, medium } = compositorFor(painting, paper, mixing, { width: surface.width, height: surface.height }, wetStages);
  done();

  done = span('stamp paint images load');
  const assets = paintingImages(painting, paper);
  // The paper's photograph is the one image whose colour is read.
  const isPhotograph = (asset: StampBrushAsset) => !!paper.image && assetKey(asset) === assetKey(paper.image);
  const loaded = await surface.images(assets.map(([asset]) => ({ asset, channels: isPhotograph(asset) ? 'colour' : 'red' })));
  const images = new Map(assets.map(([asset], i) => [assetKey(asset), loaded[i]]));
  // A bristle tip's images are drawn for each diameter it's painted at, once a surface.
  const image = (source: StampBrushImageSource) => ('draw' in source ? surface.drawnImage(source.key, source.draw) : images.get(assetKey(source))!);
  const bound = await surface.checked('drawing the brushes\' bristle tips', () => new Map(painting.groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass).map((deposit) =>
    [deposit, bindStampBrushImages(deposit.brush, deposit.diameter, image)] as const)))));
  // Each tip's paint at every mip level, for its hulls.
  const tips = new Set([...bound.values()].flatMap((brush) => (brush.dual ? [brush.tip.image, brush.dual.tip.image] : [brush.tip.image])));
  const tipLevels = new Map<StampPaintImage, StampTipLevel[]>(await Promise.all([...tips].map(async (tip) => [tip, await surface.tipLevels(tip)] as const)));
  done();

  const scope = surface.scope();
  try {
    const loading = surface.checked('loading the painting onto the GPU', () =>
      rendererOnSurface(surface, scope, compositorOn, wetnessOf, medium, painting, paper, image, bound, tipLevels, wetStages, fps ?? 0, span));
    // The load itself ran within the call: what's left is WebGPU's check of it.
    done = span('stamp paint gpu check load');
    const renderer = await loading;
    done();
    return renderer;
  } catch (error) {
    scope.destroy();
    throw error;
  }
}

/**
 * How `mixing` composites `painting`, and how wet a set of its groups' washes land, worked out before anything is
 * loaded, so a painting it can't mix fails first. Only pigment has washes: the flat compositor refuses one.
 */
function compositorFor(painting: CompiledStampPaint, paper: StampPaintPaper, mixing: StampPaintMixing, size: { width: number; height: number }, wetStages: readonly StampWetStage[]) {
  if (mixing.kind === 'pigment') {
    const paint = compileStampPigmentPaint(painting, mixing, PAINT_BANDS);
    const margin = (deposit: CompiledStampDeposit) => stampWetStageReach(wetStages, deposit, mixing.medium);
    const wetnessOf = (groups: CompiledStampPaint) => compileStampWetness(groups, mixing.medium, paper, size, margin);
    return { compositorOn: (device: StampPaintDevice) => stampPigmentCompositor(device, paint, paper.color), wetnessOf, medium: mixing.medium };
  }
  const flat = flatStampPaintCompositor(painting);
  return { compositorOn: () => flat, wetnessOf: null, medium: null };
}

/**
 * The renderer for `painting` on `surface`, its own buffers and textures made in `scope`. Runs within one of the
 * surface's checks, so it never awaits.
 */
function rendererOnSurface(
  surface: StampPaintSurface, scope: StampPaintGpuScope, compositorOn: (device: StampPaintDevice) => StampPaintCompositor,
  wetnessOf: ((groups: CompiledStampPaint) => StampWetness) | null, wetMedium: PaintMedium | null, painting: CompiledStampPaint, paper: StampPaintPaper,
  image: (source: StampBrushImageSource) => StampPaintImage, bound: ReadonlyMap<CompiledStampDeposit, StampBrush<StampPaintImage>>,
  tipLevels: ReadonlyMap<StampPaintImage, StampTipLevel[]>, wetStages: readonly StampWetStage[], fps: number, span: FrameProfileStart,
): StampPaintRenderer {
  const { width, height, format } = surface, { device } = scope;
  let done = span('stamp paint compositor gpu load');
  const compositor = compositorOn(device);
  const paintBytes = compositor.deposit.layout.words * 4;
  if (paintBytes > SLOT) throw new Error(`stamp paint: a compositor's ${compositor.deposit.layout.name} takes ${paintBytes} bytes, over a uniform slot's ${SLOT}`);
  done();

  /** The hull `layer`'s tip is drawn in, for the coarsest level its smallest or most blurred stamp reads. */
  function tipHull(layer: BoundLayer, stamps: readonly PlacedStamp[]): StampTipHull {
    // The tip's texels spread over its span, so its pixels per texel go by the image's width, not the diameter.
    const smallest = stamps.reduce((least, s) => Math.min(least, s.diameter), Infinity) * spanOf(layer);
    const blurred = Math.ceil(stamps.reduce((most, s) => Math.max(most, s.blur), 0) * STAMP_BLUR_LEVELS);
    const levels = tipLevels.get(layer.tip.image)!;
    const squashed = layer.tip.roundness * (levels[0].height / levels[0].width) * stamps.reduce((least, s) => Math.min(least, s.roundness), 1);
    const coarsest = Math.min(levels.length - 1, coarsestStampTipLevel(levels[0], smallest, squashed, levels.length) + blurred);
    return surface.tipHull(layer.tip.image, coarsest);
  }

  /** `data` in a new buffer on `on`: the painting's scope, unless made at a frame and destroyed by its maker. */
  const buffer = (data: Float32Array | Uint16Array | Uint32Array, usage: number, on: StampPaintDevice = device) => {
    const made = on.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage: usage | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(made, 0, data.buffer, data.byteOffset, Math.ceil(data.byteLength / 4) * 4);
    return made;
  };
  /**
   * `count` items of `floats` floats each from item `first` of `source`, bound from the aligned offset at or below it;
   * `first` is then the item's first float within the binding.
   */
  const storageSlice = (source: GPUBuffer, first: number, count: number, floats: number) => {
    const start = first * floats * 4, offset = start - (start % device.limits.minStorageBufferOffsetAlignment);
    return { binding: { buffer: source, offset, size: start + count * floats * 4 - offset }, first: (start - offset) / 4 };
  };
  // What an untinted stamp reads for its tint: read by every instance, so it's never indexed past.
  const noTintBuffer = buffer(new Float32Array(TINT_FLOATS), GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE);
  // What an untraced resolve binds for the trace it never records.
  const noTraceBuffer = buffer(new Float32Array(1), GPUBufferUsage.STORAGE), noTraceCrop = buffer(new Uint32Array(SLOT / 4), GPUBufferUsage.UNIFORM);

  // A frame's uniform slots: a group's lay and its move; each deposit's stamps and dual's, a flood's body, two blur
  // passes, and its resolve, where it's kept, its paint and its trace; then a wash's landing, or a dry deposit's
  // pressure for a compositor that reads it. A boil's epoch has its group's deposits.
  const depositSlots = (wash: boolean) => 9 + (wash || compositor.reads.press ? 1 : 0);
  const slotsPerFrame = 1 + painting.groups.reduce((sum, group) => sum + 2 + group.passes.reduce((n, pass) => n + stampPassDeposits(pass).length * depositSlots(pass.kind === 'wash'), 0), 0);
  const tilesX = Math.ceil(width / ORDERED_TILE), tilesY = Math.ceil(height / ORDERED_TILE);
  const asWritten = new Map(painting.groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass).map((deposit) => [deposit.id, deposit] as const))));

  /**
   * `groups`' deposits on the GPU, and what they're drawn with. A boil epoch (epochOf) lands as the deposits as
   * written do, wet where the author's stroke wets it; live marks (liveOf) load their own wetness, regions and wet
   * stages, as their pose lands. Either is scoped, destroyed as it's given up or the painting disposed.
   */
  function loadBank(groups: readonly CompiledStampGroup[], source: BankSource): DepositBank {
    const bankScope = source.kind === 'written' ? null : surface.scope(), on = bankScope?.device ?? device;
    const binData: number[] = [];
    const loadPlan = (layer: BoundLayer, stamps: readonly PlacedStamp[]): LoadedPlan => {
      const plan = stampAccumulationPlan(layer.accumulation, stamps);
      return plan.kind === 'ordered' ? { kind: 'ordered', bins: binOrderedStamps(stamps, reachSpanOf(layer), tilesX, tilesY, binData) } : plan;
    };
    let total = 0, tints = 0;
    const placed = groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass))).map((deposit) => {
      // An epoch or live marks place their marks afresh, but their brush and paint are the deposit's as written.
      const identity = asWritten.get(deposit.id)!, brush = bound.get(identity)!;
      const at = {
        deposit, identity, brush, main: total, dual: total + deposit.stamps.length, tint: compositor.readsStampTints && deposit.brush.color ? tints : null,
        mainPlan: loadPlan(brush, deposit.stamps), dualPlan: brush.dual ? loadPlan(brush.dual, deposit.dualStamps) : null,
      };
      total += deposit.stamps.length + deposit.dualStamps.length;
      if (at.tint !== null) tints += deposit.stamps.length;
      return at;
    });
    if (total * STAMP_FLOATS * 4 > device.limits.maxBufferSize) {
      throw new Error(`stamp paint: the painting's ${total.toLocaleString()} stamps need ${Math.round((total * STAMP_FLOATS * 4) / 2 ** 20)} MB, over this GPU's ${Math.round(device.limits.maxBufferSize / 2 ** 20)} MB buffer`);
    }
    const stampData = new Float32Array(Math.max(1, total) * STAMP_FLOATS), tintData = new Float32Array(Math.max(1, tints) * TINT_FLOATS);
    const write = (stamps: readonly PlacedStamp[], at: number) => stamps.forEach((s, i) => stampData.set(
      [s.x, s.y, s.diameter, s.rotation, s.alpha, s.blur, s.grainTurn, (s.flipX ? 1 : 0) + (s.flipY ? 2 : 0), s.opacity, s.roundness, stampGrainDepthIn(s, wetMedium), s.pressure], (at + i) * STAMP_FLOATS,
    ));
    for (const { deposit, main, dual, tint } of placed) {
      write(deposit.stamps, main);
      write(deposit.dualStamps, dual);
      if (tint !== null) deposit.stamps.forEach(({ tint: t }, i) => tintData.set([t.hue, t.saturation, t.lightness, t.secondary], (tint + i) * TINT_FLOATS));
    }
    // A layer laid in order reads its stamps and tints as storage.
    const stampBuffer = buffer(stampData, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE, on), tintBuffer = buffer(tintData, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE, on);
    const binBuffer = buffer(new Uint32Array(binData.length ? binData : [0]), GPUBufferUsage.STORAGE, on);
    const own = source.kind === 'live';
    const wetness = bankWetness(groups, source);
    const home = source.kind === 'epoch' ? source.written.home : loadHome(groups, wetness, on);
    const deposits = new Map(placed.map(({ deposit, identity, brush, main, dual, tint, mainPlan, dualPlan }): [CompiledStampDeposit, LoadedDeposit] => {
      const staged = own ? deposit : identity;
      return [deposit, {
        identity, staged, home, brush, active: stampActiveLayers(brush, deposit.diameter), main, dual, tint,
        writePaint: compositor.deposit.writerFor(identity),
        mainReach: stampReach(deposit.stamps, reachSpanOf(brush)), dualReach: stampReach(deposit.dualStamps, brush.dual ? reachSpanOf(brush.dual) : 1),
        mainHull: tipHull(brush, deposit.stamps), dualHull: brush.dual ? tipHull(brush.dual, deposit.dualStamps) : null,
        mainPlan, dualPlan, resolveOrder: stampResolveOrderIndex(STAMP_RESOLVE_PLANS[stampResolvePlan(brush.dual)]),
        stampBuffer, tintBuffer, binBuffer, landing: wetness?.landings.get(staged) ?? null, wetFirst: home.grids.firsts.get(staged) ?? null,
      }];
    }));
    const bank: DepositBank = { deposits, wetness, home, own, destroy: () => bankScope?.destroy() };
    reserveWashBoxes(groups, bank);
    return bank;
  }
  /** Where `groups`' washes land: as written for an epoch's re-seeded marks, as posed for live ones. */
  function bankWetness(groups: readonly CompiledStampGroup[], source: BankSource): StampWetness | null {
    if (source.kind === 'written') return source.wetness;
    if (source.kind === 'epoch') return source.written.wetness;
    return wetnessOf?.({ groups }) ?? null;
  }
  /** What `groups`' deposits are drawn with, made through `on`: their landings' grids, regions and wet stages. */
  function loadHome(groups: readonly CompiledStampGroup[], wetness: StampWetness | null, on: StampPaintDevice): BankHome {
    const grids = wetGridsOf(wetness, on);
    let loaded = span('stamp paint regions load');
    const regions = loadRegions(groups, on);
    loaded();
    loaded = span('stamp paint wet stages load');
    const stages: LoadedWetStage[] = [];
    if (wetness?.landings.size) {
      const wetContext: StampWetStageContext = {
        device: on, painting: { groups }, medium: wetMedium!, wetness, width, height, layer: targets.layer, wash: stageWash!,
        footprint: targets.footprint!, fresh: targets.fresh!, grids, paperDepth: paper.grain?.depth ?? 0,
      };
      for (const stage of wetStages) {
        stages.push(stage.after === 'deposit' ? { after: 'deposit', settled: !!stage.settled, running: stage.load(wetContext) } : { after: 'drying', running: stage.load(wetContext) });
      }
    }
    loaded();
    const dryingsByLast = new Map(groups.flatMap((group) => group.passes).flatMap(stampWashDryings).map((drying) => [drying.deposits.at(-1)!, drying]));
    return { grids, regions, stages, dryingsByLast };
  }
  /**
   * Every wash deposit's landing grids in one upload, each its wetness, workable and settled one after another (the
   * renderer and every stage read this one buffer). Each is a window of the painting's lattice round the deposit
   * (stamp-wetness.ts), so the upload grows with what the deposits cover, 12 bytes a lattice point.
   */
  function wetGridsOf(wetness: StampWetness | null, on: StampPaintDevice): BankHome['grids'] {
    const firsts = new Map<CompiledStampDeposit, number>();
    let floats = 0;
    for (const [deposit, { before }] of wetness?.landings ?? []) {
      firsts.set(deposit, floats);
      floats += 3 * before.wetness.length;
    }
    const values = new Float32Array(Math.max(1, floats));
    for (const [deposit, { before }] of wetness?.landings ?? []) {
      const first = firsts.get(deposit)!, n = before.wetness.length;
      values.set(before.wetness, first);
      values.set(before.workable, first + n);
      values.set(before.settled, first + 2 * n);
    }
    return { buffer: buffer(values, GPUBufferUsage.STORAGE, on), firsts };
  }
  done = span('stamp paint wetness load');
  const wetness = wetnessOf?.(painting) ?? null;
  done();
  done = span('stamp paint pipelines load');
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

  // Each frame's lattice triangles, uploaded with its uniforms, in room grown for the most a frame has laid through
  // one (latticeRoom).
  let latticeStaging = new Float32Array(0), latticeVertices: GPUBuffer | null = null, latticeUsed = 0;

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
  // Tints are laid premultiplied, each stamp over those before it.
  const overBlend: GPUBlendState = { color: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const stampModule = device.createShaderModule({ code: STAMP_WGSL });
  /**
   * A stamp pipeline: its accumulation's blend into the brush's channel or its dual's; in a tinted pass (a brush with
   * colour dynamics) with the two tint targets too, which only the brush's own stamps write.
   */
  const stampVertex = (tintStride: number): GPUVertexState => ({
    module: stampModule,
    buffers: [
      { arrayStride: STAMP_FLOATS * 4, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }, { shaderLocation: 3, offset: 32, format: 'float32x4' }] },
      { arrayStride: tintStride, stepMode: 'instance', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x4' }] },
    ],
  });
  const stampPipeline = (glaze: boolean, channel: 0 | 1, tinted: boolean) => device.createRenderPipeline({
    layout: 'auto',
    vertex: stampVertex(tinted && channel === 0 ? TINT_FLOATS * 4 : 0),
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
  const depositModules = { dry: device.createShaderModule({ code: depositWgsl(compositor, false) }), wet: compositor.deposit.wet ? device.createShaderModule({ code: depositWgsl(compositor, true) }) : null };
  // The traced resolve is the ordinary one with TRACE on; each is made when first asked for.
  const depositPipelines = new Map<string, GPUComputePipeline>();
  const depositPipeline = (trace: boolean, wet: boolean) => {
    const key = `${trace}|${wet}`;
    if (!depositPipelines.has(key)) {
      const module = wet ? depositModules.wet! : depositModules.dry;
      depositPipelines.set(key, device.createComputePipeline({ layout: 'auto', compute: { module, constants: { TRACE: trace ? 1 : 0 } } }));
    }
    return depositPipelines.get(key)!;
  };
  const pipelines = { blur: computePipeline(BLUR_WGSL), group: computePipeline(groupWgsl(compositor, false)), paper: computePipeline(paperWgsl(compositor)) };
  /**
   * What laying a group through a lattice takes, made the first time a frame moves or warps one: its pipelines, and
   * each scene pixel's rest point.
   */
  let latticeLay: { movedGroupPipeline: GPUComputePipeline; latticePipeline: GPURenderPipeline; rest: ReturnType<typeof target> } | null = null;
  const latticeLayOf = () => {
    if (latticeLay) return latticeLay;
    const latticeModule = device.createShaderModule({ code: groupLatticeWgsl(compositor.targets.layer) });
    latticeLay = {
      movedGroupPipeline: computePipeline(groupWgsl(compositor, true)),
      latticePipeline: device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: latticeModule, buffers: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32x2' }] }] },
        fragment: { module: latticeModule, targets: [{ format: 'rg32float' }] },
      }),
      rest: target('rest', width, height, GPUTextureUsage.RENDER_ATTACHMENT, 'rg32float'),
    };
    return latticeLay;
  };
  /** Room for a frame laying `groups` through lattices: a moved group's one cell, a warped group's most. */
  const latticeRoom = (groups: readonly StampGroupFrame[]) => {
    const floats = groups.reduce((sum, group) => sum + 24 * latticeCellsMost(group), 0);
    if (floats <= latticeStaging.length) return;
    latticeStaging = new Float32Array(floats);
    // Destroyed once the frames that drew from it are done.
    latticeVertices?.destroy();
    latticeVertices = device.createBuffer({ size: floats * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  };
  depositPipeline(false, false);
  if (wetness?.landings.size) {
    if (!compositor.deposit.wet) throw new Error('stamp paint: the painting has washes, and its compositor lays none');
    depositPipeline(false, true);
  }
  const outputModule = device.createShaderModule({ code: outputWgsl(compositor, format.endsWith('8unorm')) });
  const outputPipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: outputModule }, fragment: { module: outputModule, targets: [{ format }] } });
  const regionPipeline = (code: string, entryPoint: string) => {
    const module = device.createShaderModule({ code });
    return device.createRenderPipeline({ layout: 'auto', vertex: { module }, fragment: { module, entryPoint, targets: [{ format: STAMP_REGION_FORMAT }] } });
  };
  const maskStepPipeline = regionPipeline(MASK_STEP_WGSL, 'maskStep'), floodBodyPipeline = regionPipeline(FLOOD_BODY_WGSL, 'floodBodyAt');
  const bodyModule = device.createShaderModule({ code: BODY_DRAW_WGSL });
  // B ← b + B(1 − b): a toward-full build's lay (STAMP_ACCUMULATIONS) of a body laid whole.
  const screenBlend: GPUBlendState = { color: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const bodyPipelines = new Map<string, GPURenderPipeline>();
  /** The pipeline joining a flood's body to its build: toward full by screen, else by max; a glaze's cap too; a tinted pass's tints over. */
  const bodyPipeline = (towardFull: boolean, glaze: boolean, tinted: boolean) => {
    const key = `${towardFull}|${glaze}|${tinted}`;
    if (!bodyPipelines.has(key)) {
      bodyPipelines.set(key, device.createRenderPipeline({
        layout: 'auto', vertex: { module: bodyModule },
        fragment: {
          module: bodyModule, entryPoint: tinted ? 'laidBodyTinted' : 'laidBody',
          targets: [
            { format: 'rg16float', blend: towardFull ? screenBlend : maxBlend, writeMask: GPUColorWrite.RED },
            { format: 'rgba16float', blend: maxBlend, writeMask: glaze ? GPUColorWrite.RED | GPUColorWrite.BLUE : 0 },
            ...(tinted ? [0, 1].map(() => ({ format: 'rgba16float' as const, blend: overBlend })) : []),
          ],
        },
      }));
    }
    return bodyPipelines.get(key)!;
  };

  done();
  done = span('stamp paint targets load');
  // Targets are the surface's, shared with every painting drawn on it: a frame overwrites all it reads of them.
  const target = (name: string, w: number, h: number, usage: number, targetFormat: GPUTextureFormat = 'rgba16float') => {
    const texture = surface.target(name, { size: [w, h], format: targetFormat, usage: usage | GPUTextureUsage.TEXTURE_BINDING });
    return { texture, view: texture.createView(), layers: [texture.createView()] };
  };
  /** A compositor's target, an array's layers each cleared through a view of its own. */
  const layered = (name: string, shape: StampPaintTarget, usage: number) => {
    if (shape.kind === 'plain') return target(name, width, height, usage);
    const texture = surface.target(name, { size: [width, height, shape.layers], format: 'rgba16float', usage: usage | GPUTextureUsage.TEXTURE_BINDING });
    return {
      texture, view: texture.createView({ dimension: '2d-array' }),
      layers: Array.from({ length: shape.layers }, (_, layer) => texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 })),
    };
  };
  const RENDER = GPUTextureUsage.RENDER_ATTACHMENT, STORAGE = GPUTextureUsage.STORAGE_BINDING;
  // What a checkpoint saves and restores (stamp-paint-checkpoints.ts).
  const SAVED = GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
  const halfW = Math.ceil(width / 2), halfH = Math.ceil(height / 2);
  const laysTints = compositor.readsStampTints && painting.groups.some((group) => group.passes.some((pass) => stampPassDeposits(pass).some((deposit) => deposit.brush.color)));
  const targets = {
    painting: layered('painting', compositor.targets.painting, STORAGE | SAVED),
    // Saved by checkpoints, and copied out by readLayer for the GPU gate's pigment checks.
    layer: layered('layer', compositor.targets.layer, STORAGE | RENDER | SAVED),
    mask: target('mask', width, height, RENDER, 'rg16float'),
    cap: target('cap', width, height, RENDER, 'rgba16float'),
    blurA: target('blurA', halfW, halfH, STORAGE),
    blurB: target('blurB', halfW, halfH, STORAGE),
    clip: target('clip', width, height, STORAGE | RENDER | SAVED),
    blank: target('blank', 1, 1, 0, 'r8unorm'),
    // Only a painting with colour dynamics lays tints, and only for a compositor that reads them.
    tintA: laysTints ? target('tintA', width, height, RENDER) : null,
    tintB: laysTints ? target('tintB', width, height, RENDER) : null,
    // Only a painting with washes leaves footprints, and what each wash deposit laid (`fresh`, shaped as the layer).
    footprint: wetness?.landings.size ? target('footprint', width, height, STORAGE) : null,
    fresh: wetness?.landings.size ? layered('fresh', compositor.targets.layer, STORAGE) : null,
  };

  /** Binds each of `resources` at its index; a null is a binding the pipeline doesn't have. */
  const bindGroup = (pipeline: GPURenderPipeline | GPUComputePipeline, resources: (GPUBindingResource | null)[]) =>
    device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: resources.flatMap((resource, binding) => (resource ? [{ binding, resource }] : [])) });
  const dispatch = (encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, resources: (GPUBindingResource | null)[], w: number, h: number) => {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup(pipeline, resources));
    pass.dispatchWorkgroups(Math.ceil(w / WORKGROUP), Math.ceil(h / WORKGROUP));
    pass.end();
  };

  /**
   * How far past its stamps' reach a deposit resolves: its edges' blur, and for a wash deposit its stages' reach and
   * two lattice cells more, so the box holds every pixel whose settled paint its landing would leave unzeroed.
   */
  const depositPad = (identity: CompiledStampDeposit, loadedDeposit: LoadedDeposit, pass: CompiledStampPass) => {
    const sigma = loadedDeposit.active.edgeSigma;
    return (sigma > 0 ? sigma * 3 : 2) + (pass.kind === 'wash' ? stampWetStageReach(wetStages, identity, wetMedium!) + 2 * STAMP_WET_CELL : 0);
  };
  /** Readies every stage `bank` draws with for each of `groups`' wash deposits' whole boxes (StampLoadedWetStage.reserve). */
  const reserveWashBoxes = (groups: readonly CompiledStampGroup[], bank: DepositBank) => {
    for (const pass of groups.flatMap((group) => group.passes)) {
      if (pass.kind !== 'wash') continue;
      for (const deposit of stampPassDeposits(pass)) {
        const loadedDeposit = bank.deposits.get(deposit)!;
        const box = depositBox(deposit, loadedDeposit, deposit.stamps.length, deposit.dualStamps.length, depositPad(loadedDeposit.identity, loadedDeposit, pass));
        if (box) for (const { running } of bank.home.stages) running.reserve?.(box);
      }
    }
  };
  // A wet stage asks the compositor about the deposits it knows; live marks' own are painted as the deposit as written.
  const stageWash: StampWashLayer | undefined = compositor.wash && {
    ...compositor.wash,
    layersOf: (deposit) => compositor.wash!.layersOf(asWritten.get(deposit.id)!),
    holdWgsl: (deposit) => compositor.wash!.holdWgsl(asWritten.get(deposit.id)!),
  };
  done();
  done = span('stamp paint bank load');
  const writtenBank = loadBank(painting.groups, { kind: 'written', wetness });
  done();

  /**
   * Works out, once a bank, what of `groups` doesn't change with time: each flood's body, each state of the fluid a
   * deposit lands under, each pass's `within`, as cropped textures made through `on` (none for an empty state). All
   * are planned and held to STAMP_REGION_BUDGET, refused past it naming what's there, before any is made.
   */
  function loadRegions(groups: readonly CompiledStampGroup[], on: StampPaintDevice): LoadedRegions {
    const passes = groups.flatMap((group) => group.passes);
    const all = passes.flatMap((pass) => stampPassDeposits(pass));
    // Every polygon once, each flood's thickness grid and every op of the fluid, in storage buffers.
    const points: number[] = [], placed = new Map<readonly StampPoint[], [number, number]>();
    const pointsOf = (polygon: readonly StampPoint[]) => {
      if (!placed.has(polygon)) {
        placed.set(polygon, [points.length / 2, polygon.length]);
        for (const { x, y } of polygon) points.push(x, y);
      }
      return placed.get(polygon)!;
    };
    const grids: number[] = [];
    const opWords: { floats: number[]; words: number[] }[] = [];
    type Step = { box: Box; draw: (views: StampUniformViews) => GPURenderPipeline; parent?: Step | null; grid?: boolean };
    const steps: Step[] = [];
    const inPainting = (box: StampBox): Box | null => {
      const x = Math.max(0, Math.floor(box.x0)), y = Math.max(0, Math.floor(box.y0));
      const w = Math.min(width, Math.ceil(box.x1)) - x, h = Math.min(height, Math.ceil(box.y1)) - y;
      return w > 0 && h > 0 ? { x, y, w, h } : null;
    };
    /** An op of the fluid, its region's area or everywhere, as a MaskOp; its index. */
    const opOf = (kind: 'mask' | 'unmask', amount: number, area: CompiledStampMaskArea | null) => {
      const [first, count] = area ? pointsOf(area.polygon) : [0, 0], reach = area ? areaBox(area) : null, ragged = area?.edge?.ragged;
      opWords.push({
        floats: [reach?.x0 ?? 0, reach?.y0 ?? 0, reach?.x1 ?? 0, reach?.y1 ?? 0, ragged?.amount ?? 0, ragged?.scale ?? 0, stampEdgeWidth(area?.edge), amount],
        words: [first, count, kind === 'mask' ? 0 : 1, area?.seed ?? 0],
      });
      return opWords.length - 1;
    };
    /** A step drawing `opCount` ops from `firstOp` over `box`, on `parent`'s state. */
    const maskStep = (box: Box, parent: Step | null, firstOp: number, opCount: number): Step => ({
      box, parent,
      draw: (views) => {
        const put = stampUniformWriter(MASK_STEP, views);
        put('box', boxWords(box));
        put('parent', boxWords(parent?.box));
        put('firstOp', firstOp);
        put('opCount', opCount);
        return maskStepPipeline;
      },
    });

    const bodies = new Map<CompiledStampDeposit, Step>();
    for (const deposit of all) {
      if (deposit.kind !== 'flood') continue;
      const { flood } = deposit, box = inPainting(flood.box);
      if (!box) continue;
      const [first, count] = pointsOf(flood.polygon), gridFirst = grids.length;
      for (const v of flood.thickness.values) grids.push(v);
      const step: Step = {
        box, grid: true,
        draw: (views) => {
          const put = stampUniformWriter(FLOOD_BODY, views);
          put('box', boxWords(box));
          put('grid', [flood.thickness.x0, flood.thickness.y0, flood.thickness.cell, 0]);
          put('gridSize', [flood.thickness.columns, flood.thickness.rows]);
          put('first', first);
          put('count', count);
          put('gridFirst', gridFirst);
          put('inset', flood.inset);
          return floodBodyPipeline;
        },
      };
      steps.push(step);
      bodies.set(deposit, step);
    }

    // Only the states a deposit lands under are made: each on the nearest such state under it, with the ops between
    // in one step, so a run of masks costs one texture. A state covers the one it's built on and each mask's reach.
    const read = new Set(all.flatMap((deposit) => (deposit.mask ? [deposit.mask] : [])));
    const fluids = new Map<CompiledStampMask, Step | null>();
    const fluidOf = (mask: CompiledStampMask): Step | null => {
      if (fluids.has(mask)) return fluids.get(mask)!;
      const between: CompiledStampMask[] = [];
      let base: CompiledStampMask | null = mask;
      for (; base && (base === mask || !read.has(base)); base = base.under) between.unshift(base);
      const parent = base ? fluidOf(base) : null;
      let box = parent?.box ?? null;
      for (const op of between) {
        const own = op.kind === 'mask' ? inPainting(areaBox(op.area)) : null;
        if (own) box = box ? union(box, own) : own;
      }
      const step = box && maskStep(box, parent, opWords.length, between.length);
      if (step) {
        for (const op of between) opOf(op.kind, op.kind === 'mask' ? 1 : op.amount, op.area);
        steps.push(step);
      }
      fluids.set(mask, step);
      return step;
    };
    for (const mask of read) fluidOf(mask);

    // A pass's `within` is a state of its own: one mask of its region on no fluid.
    const withins = new Map<CompiledStampPass, Step | null>();
    for (const pass of passes) {
      if (!pass.within) continue;
      const area = { polygon: pass.within, seed: 0 }, box = inPainting(areaBox(area));
      const step = box && maskStep(box, null, opWords.length, 1);
      if (step) {
        opOf('mask', 1, area);
        steps.push(step);
      }
      withins.set(pass, step);
    }

    const bytes = steps.reduce((sum, { box }) => sum + box.w * box.h * STAMP_REGION_TEXEL_BYTES, 0);
    if (bytes > STAMP_REGION_BUDGET) {
      throw new Error(`stamp paint: the painting's fills, masking fluid and within regions need ${Math.round(bytes / 2 ** 20)} MB, over ${STAMP_REGION_BUDGET / 2 ** 20} MB: ${bodies.size} fill bodies, ${[...fluids.values()].filter(Boolean).length} states of the fluid, ${withins.size} within regions; share masks between deposits or crop them`);
    }
    const made = new Map(steps.map((step): [Step, RegionTexture] => {
      const texture = on.createTexture({ size: [step.box.w, step.box.h], format: STAMP_REGION_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      return [step, { view: texture.createView(), box: step.box }];
    }));
    if (steps.length) {
      const opBytes = new ArrayBuffer(Math.max(1, opWords.length) * MASK_OP_WORDS * 4), opFloats = new Float32Array(opBytes), opInts = new Uint32Array(opBytes);
      opWords.forEach(({ floats, words }, i) => {
        opFloats.set(floats, i * MASK_OP_WORDS);
        opInts.set(words, i * MASK_OP_WORDS + floats.length);
      });
      const pointBuffer = buffer(new Float32Array(points.length ? points : [0, 0]), GPUBufferUsage.STORAGE, on), gridBuffer = buffer(new Float32Array(grids.length ? grids : [0]), GPUBufferUsage.STORAGE, on);
      const opBuffer = buffer(opFloats, GPUBufferUsage.STORAGE, on);
      const words = new ArrayBuffer(steps.length * SLOT), uniformBuffer = on.createBuffer({ size: steps.length * SLOT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const encoder = device.createCommandEncoder();
      // In the order planned, so a state of the fluid is drawn after the state it's built on.
      steps.forEach((step, i) => {
        const at = (i * SLOT) / 4, n = SLOT / 4;
        const pipeline = step.draw({ floats: new Float32Array(words, at * 4, n), ints: new Int32Array(words, at * 4, n), words: new Uint32Array(words, at * 4, n) });
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: made.get(step)!.view, loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup(pipeline, step.grid
          ? [{ buffer: uniformBuffer, offset: i * SLOT, size: SLOT }, { buffer: pointBuffer }, { buffer: gridBuffer }]
          : [{ buffer: uniformBuffer, offset: i * SLOT, size: SLOT }, { buffer: pointBuffer }, step.parent ? made.get(step.parent)!.view : targets.blank.view, { buffer: opBuffer }]));
        pass.draw(3);
        pass.end();
      });
      device.queue.writeBuffer(uniformBuffer, 0, words);
      device.queue.submit([encoder.finish()]);
    }
    const texturesOf = <K,>(byKey: Map<K, Step | null>) => new Map([...byKey].map(([key, step]): [K, RegionTexture | null] => [key, step && made.get(step)!]));
    return { bodies: texturesOf(bodies), fluids: texturesOf(fluids), withins: texturesOf(withins) };
  }

  /** A layer's canvas grain's tile (a share of its stamps' diameter across), offset and mip level, written as a Grain at `at`. */
  const canvasGrainAt = (views: StampUniformViews, at: number, layer: StampActiveLayer<StampPaintImage> | undefined, offset: readonly [number, number]) => {
    const grain = layer?.canvasGrain;
    if (!grain) return;
    const size = grain.scale * layer.diameter;
    writeGrain(views, at, grain, [size, size * (grain.image.height / grain.image.width)], offset, grainLod(grain.image, size));
  };

  /** What drawing `layer`'s stamps binds, the main brush's (`stampChannel` 0) or its dual's. */
  const stampInputs = (deposit: CompiledStampDeposit, layer: BoundLayer, active: StampActiveLayer<StampPaintImage>, stampChannel: 0 | 1) => {
    const { rollingGrain: rolling, diameter } = active;
    const { pressed } = layer.tip;
    const center: [number, number] = [layer.tip.center?.[0] ?? 0.5, layer.tip.center?.[1] ?? 0.5];
    const pressedWords: [number, number, number, number] = pressed ? [pressed.softness, ...pressed.range, pressed.diameter ?? 0] : [0, 0, 0, 0];
    return {
      rolling, diameter, offset: deposit.grainOffset[stampChannel === 0 ? 'main' : 'dual'], center, pressedWords,
      textures: [layer.tip.image.view, rolling ? rolling.image.view : targets.blank.view, layer.tip.sampling === 'anisotropic' ? anisotropicClamp : linearClamp, rolling?.tiling === 'mirror' ? mirrorTile : tile],
      contact: pressed ? pressed.contact.view : targets.blank.view,
    };
  };
  /** The fixed path's bindings (STAMP_WGSL) for `layer`'s stamps, each laid toward full or its opacity. */
  const fixedStampResources = (deposit: CompiledStampDeposit, layer: BoundLayer, active: StampActiveLayer<StampPaintImage>, hull: StampTipHull, stampChannel: 0 | 1, towardFull: boolean) => {
    const { rolling, diameter, offset, textures, center, contact, pressedWords } = stampInputs(deposit, layer, active, stampChannel);
    return [
      slot((views) => {
        const put = stampUniformWriter(STAMP_DRAW, views);
        put('resolution', [width, height]);
        put('roundness', layer.tip.roundness * aspectOf(layer));
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
        put('towardFull', towardFull ? 1 : 0);
        put('center', center);
        put('noise', layer.tip.noise ?? 0);
        put('pressed', pressedWords);
      }),
      ...textures, contact,
    ];
  };

  /**
   * For a compositor that reads it (reads.press), how hard each dry deposit's main stamps pressed, laid by max: that's
   * order-free, so a layer laid in order lays it so too.
   */
  const pressing = compositor.reads.press ? pressLaying() : null;
  function pressLaying() {
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: stampVertex(0),
      fragment: { module: stampModule, entryPoint: 'pressOf', targets: [{ format: 'r16float', blend: maxBlend, writeMask: GPUColorWrite.RED }] },
    });
    const { view } = target('press', width, height, RENDER, 'r16float');
    return {
      view,
      /** Lays the deposit's first `count` stamps' pressure in `box`. */
      draw(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, loadedDeposit: LoadedDeposit, count: number, box: Box) {
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
        pass.setScissorRect(box.x, box.y, box.w, box.h);
        if (count) {
          pass.setIndexBuffer(fanBuffer, 'uint16');
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup(pipeline, fixedStampResources(deposit, loadedDeposit.brush, loadedDeposit.active.main, loadedDeposit.mainHull, 0, true)));
          pass.setVertexBuffer(0, loadedDeposit.stampBuffer, loadedDeposit.main * STAMP_FLOATS * 4);
          pass.setVertexBuffer(1, noTintBuffer);
          pass.drawIndexed((loadedDeposit.mainHull.length / 2 - 2) * 3, count);
        }
        pass.end();
      },
    };
  }

  /**
   * For a compositor that reads it (reads.before), the layer as each dry deposit found it, copied as far past the
   * deposit's box as its lay reads round a pixel: `reach` texels of the paper's grain, as wide as the paper is drawn.
   */
  const { before: beforeRead } = compositor.reads;
  const before = beforeRead ? beforeLaying(beforeRead.reach) : null;
  function beforeLaying(texels: number) {
    const tooth = paper.grain;
    const reach = tooth ? (texels * tooth.scale * width) / image(tooth.image).width : 0, pad = Math.ceil(reach);
    const { texture, view } = layered('before', compositor.targets.layer, GPUTextureUsage.COPY_DST);
    const layers = compositor.targets.layer.kind === 'array' ? compositor.targets.layer.layers : 1;
    return {
      view, reach,
      copy(encoder: GPUCommandEncoder, box: Box) {
        const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
        const w = Math.min(width, box.x + box.w + pad) - x, h = Math.min(height, box.y + box.h + pad) - y;
        encoder.copyTextureToTexture({ texture: targets.layer.texture, origin: { x, y, z: 0 } }, { texture, origin: { x, y, z: 0 } }, [w, h, layers]);
      },
    };
  }

  function drawStamps(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, loadedDeposit: LoadedDeposit, count: number, dualCount: number, box: Box) {
    const tinted = loadedDeposit.tint !== null;
    const pass = encoder.beginRenderPass({
      colorAttachments: [targets.mask, targets.cap, ...(tinted ? [targets.tintA!, targets.tintB!] : [])].map(({ view }) => ({ view, loadOp: 'clear' as const, storeOp: 'store' as const })),
    });
    pass.setScissorRect(box.x, box.y, box.w, box.h);
    pass.setIndexBuffer(fanBuffer, 'uint16');
    const stamp = (layer: BoundLayer, active: StampActiveLayer<StampPaintImage>, plan: LoadedPlan, first: number, n: number, hull: StampTipHull, stampChannel: 0 | 1) => {
      if (!n) return;
      const { rolling, diameter, offset, textures, center, contact, pressedWords } = stampInputs(deposit, layer, active, stampChannel);
      const tintBinding = stampChannel === 0 && tinted ? { buffer: loadedDeposit.tintBuffer, at: loadedDeposit.tint! } : { buffer: noTintBuffer, at: 0 };
      if (plan.kind === 'ordered') {
        // Only this layer's stamps and tints are bound, so no painting's whole buffer meets the storage binding limit.
        const stampSlice = storageSlice(loadedDeposit.stampBuffer, first, n, STAMP_FLOATS), tintSlice = storageSlice(tintBinding.buffer, tintBinding.at, tinted ? n : 1, TINT_FLOATS);
        const pipeline = orderedPipelines[tinted ? 'tinted' : 'plain'][stampChannel];
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup(pipeline, [
          slot((views) => {
            const put = stampUniformWriter(ORDERED_DRAW, views);
            put('roundness', layer.tip.roundness * aspectOf(layer));
            put('rolling', rolling ? 1 : 0);
            if (rolling) {
              const size = rolling.scale * diameter;
              writeGrain(views, ORDERED_DRAW.at.grain, rolling, [size, size * (rolling.image.height / rolling.image.width)], offset, 0);
              put('diameter', diameter);
              put('zoom', rolling.zoom);
              put('movement', rolling.movement);
            }
            put('span', spanOf(layer));
            put('first', stampSlice.first);
            put('count', n);
            put('tint', tintSlice.first / TINT_FLOATS);
            put('bins', plan.bins);
            put('tilesX', tilesX);
            put('accumulation', stampAccumulationIndex(layer.accumulation.kind));
            put('center', center);
            put('noise', layer.tip.noise ?? 0);
            put('pressed', pressedWords);
          }),
          ...textures, stampSlice.binding, tintSlice.binding, { buffer: loadedDeposit.binBuffer }, contact,
        ]));
        pass.draw(3);
        return;
      }
      const pipeline = stampPipelines[STAMP_ACCUMULATIONS[layer.accumulation.kind].keepsCap ? 'glaze' : 'build'][tinted ? 'tinted' : 'plain'][stampChannel];
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup(pipeline, fixedStampResources(deposit, layer, active, hull, stampChannel, plan.toward === 'full')));
      pass.setVertexBuffer(0, loadedDeposit.stampBuffer, first * STAMP_FLOATS * 4);
      pass.setVertexBuffer(1, tintBinding.buffer, tintBinding.at * TINT_FLOATS * 4);
      pass.drawIndexed((hull.length / 2 - 2) * 3, n);
    };
    stamp(loadedDeposit.brush, loadedDeposit.active.main, loadedDeposit.mainPlan, loadedDeposit.main, count, loadedDeposit.mainHull, 0);
    if (loadedDeposit.brush.dual && loadedDeposit.active.dual && loadedDeposit.dualPlan) stamp(loadedDeposit.brush.dual, loadedDeposit.active.dual, loadedDeposit.dualPlan, loadedDeposit.dual, dualCount, loadedDeposit.dualHull!, 1);
    // A flood's body joins the build its edge stamps laid, before any rim blurs it, so rims see the whole flood.
    const body = loadedDeposit.home.regions.bodies.get(loadedDeposit.staged);
    if (deposit.kind === 'flood' && body) {
      const { kind } = loadedDeposit.brush.accumulation, { towardFull, keepsCap } = STAMP_ACCUMULATIONS[kind];
      const pipeline = bodyPipeline(towardFull, keepsCap, tinted);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup(pipeline, [slot((views) => {
        const put = stampUniformWriter(BODY_DRAW, views);
        put('box', [body.box.x, body.box.y, body.box.w, body.box.h]);
        const { levels, tint } = deposit.flood;
        put('tint', [tint.hue, tint.saturation, tint.lightness, tint.secondary]);
        put('levels', [levels.built, levels.densest]);
      }), body.view]));
      pass.draw(3);
    }
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

  /** `pass`: the pass as `loadedDeposit`'s bank's regions know it (LoadedDeposit's `staged`). */
  function resolveDeposit(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, loadedDeposit: LoadedDeposit, pass: CompiledStampPass, t: number, blurred: boolean, box: Box, frameTrace?: FrameTrace) {
    const trace = frameTrace?.deposits.get(loadedDeposit.identity), { regions, stages } = loadedDeposit.home;
    const clipped = !!pass.clipTo, fluid = deposit.mask ? regions.fluids.get(deposit.mask) ?? null : null;
    // A pass within a region wholly off the painting lands nowhere: its `within` is an empty texture, read as none.
    const within = pass.within ? regions.withins.get(pass) ?? null : null;
    const { brush, active, landing } = loadedDeposit;
    // Where a stage rims the deposit's drying (the drying rim, stamp-wet-rim.ts), a brush's own wet edges would rim
    // each stroke again. Its Procreate rim goes, and Photoshop's pooling keeps its body, not its peak.
    const washRims = !!landing && stages.some(({ running }) => running.ownsWetEdges?.(loadedDeposit.staged));
    const edgesOf = (layer?: StampActiveLayer<StampPaintImage>): [number, number, number, number] => (blurred && layer
      ? [washRims ? 0 : layer.rim?.rim ?? 0, layer.rim?.sharpness ?? 0, layer.burntEdge?.strength ?? 0, layer.burntEdge?.sharpness ?? 0] : [0, 0, 0, 0]);
    const mainGrain = active.main.canvasGrain, dualGrain = active.dual?.canvasGrain;
    const tooth = paper.grain;
    let paperTile = [1, 1, 0];
    if (tooth) {
      const grain = image(tooth.image), size = tooth.scale * width;
      paperTile = [size, size * (grain.height / grain.width), grainLod(grain, size)];
    }
    const tinted = loadedDeposit.tint !== null;
    const flags: (keyof typeof DEPOSIT_FLAGS)[] = [
      ...(mainGrain ? ['canvasGrain' as const] : []), ...(brush.dual ? ['dual' as const] : []), ...(dualGrain ? ['dualCanvasGrain' as const] : []),
      ...(tooth ? ['paper' as const] : []), ...(fluid ? ['masked' as const] : []), ...(pass.within ? ['within' as const] : []),
      ...(deposit.kind === 'flood' ? ['flood' as const] : []),
      ...(deposit.kind === 'flood' && !landing && stampFloodCarriesWater(brush, wetMedium) ? ['floodWater' as const] : []),
      // Only paint makes a clip base: water and a lift leave where a pass holds paint as it was.
      ...(clipped ? ['clipped' as const] : []), ...(!clipped && deposit.action.kind === 'paint' ? ['clips' as const] : []),
      ...(active.main.pooling ? ['pooled' as const] : []), ...(active.dual?.pooling ? ['dualPooled' as const] : []),
      ...(brush.dual?.blend.family === 'layer' ? ['dualLayer' as const] : []),
    ];
    dispatch(encoder, depositPipeline(!!trace, !!landing), [
      slot((views) => {
        const put = stampUniformWriter(DEPOSIT, views);
        put('view', [width, height, paperTile[0], paperTile[1]]);
        put('edges', edgesOf(active.main));
        put('dualEdges', edgesOf(active.dual));
        canvasGrainAt(views, DEPOSIT.at.grain, active.main, deposit.grainOffset.main);
        canvasGrainAt(views, DEPOSIT.at.dualGrain, active.dual, deposit.grainOffset.dual);
        put('paperDepth', tooth?.depth ?? 0);
        put('paperLod', paperTile[2]);
        put('opacity', deposit.opacity);
        put('dualBlend', brush.dual ? stampDualModeIndex(brush.dual.blend) : 0);
        put('flags', flags.reduce((all, flag) => all | DEPOSIT_FLAGS[flag], 0));
        put('resolveOrder', trace?.order ?? loadedDeposit.resolveOrder);
        put('origin', [box.x, box.y]);
        put('extent', [box.w, box.h]);
        // A layer that isn't there reads its build as none, as a `build` accumulation, whatever it resolves to.
        const accumulations = [brush.accumulation, brush.dual?.accumulation ?? { kind: 'build' as const }];
        put('build', [stampAccumulationBuild(accumulations[0]), stampAccumulationBuild(accumulations[1])]);
        put('accumulation', [stampAccumulationIndex(accumulations[0].kind), stampAccumulationIndex(accumulations[1].kind)]);
        const { pooling } = active.main, dualPooling = active.dual?.pooling;
        const peakOf = (edges?: { peak: number; body: number }) => (washRims ? edges?.body : edges?.peak) ?? 0;
        put('pooling', [peakOf(pooling), pooling?.body ?? 0, peakOf(dualPooling), dualPooling?.body ?? 0]);
        put('press', deposit.action.kind === 'paint' && deposit.action.burnish ? PAINT_DRY_BURNISHED_PRESS - 1 : 0);
        put('beforeReach', before?.reach ?? 0);
      }),
      targets.mask.view, blurred ? targets.blurB.view : targets.mask.view,
      mainGrain ? mainGrain.image.view : targets.blank.view,
      dualGrain ? dualGrain.image.view : targets.blank.view,
      tooth ? image(tooth.image).view : targets.blank.view,
      fluid?.view ?? targets.blank.view, targets.clip.view, targets.layer.view, linearClamp, tile,
      { buffer: trace ? frameTrace!.buffer : noTraceBuffer },
      trace ? slot((views) => {
        const put = stampUniformWriter(TRACE_CROP, views);
        const { crop } = trace.request;
        put('origin', [crop.x, crop.y]);
        put('extent', [crop.w, crop.h]);
        put('offset', trace.offset);
      }) : { buffer: noTraceCrop },
      targets.cap.view, mirrorTile,
      slot((views) => {
        const put = stampUniformWriter(KEEP, views);
        put('fluid', boxWords(fluid?.box));
        put('within', boxWords(within?.box));
        put('bodyReach', WET_BODY_REACH * deposit.diameter);
        if (deposit.kind !== 'flood') return;
        const { load, front } = deposit.flood, ends = stampPaintFieldEnds(load);
        put('load', ends.geometry);
        put('loadEnds', [ends.first, ends.second]);
        put('loadKind', ends.kind);
        put('front', [front.normal[0], front.normal[1], front.from, front.to]);
        put('frontShape', [front.soft, stampFloodProgressAt(deposit, t)]);
        put('bodyLevels', [deposit.flood.levels.built, deposit.flood.levels.densest]);
      }),
      within?.view ?? targets.blank.view,
      slot((views) => loadedDeposit.writePaint(views, t)),
      landing && { buffer: loadedDeposit.home.grids.buffer },
      landing && slot((views) => {
        const put = stampUniformWriter(WET_OP, views);
        const { window } = landing.before, { action } = deposit;
        put('lattice', [window.x0, window.y0, window.cell, 0]);
        put('size', [window.columns, window.rows]);
        put('first', loadedDeposit.wetFirst!);
        put('tau', landing.tau);
        put('water', landing.water);
        put('strength', action.kind === 'lift' ? action.strength : 0);
        put('action', WET_ACTIONS[action.kind]);
      }),
      landing && targets.footprint!.view, landing && targets.fresh!.view, !landing && pressing ? pressing.view : null, !landing && before ? before.view : null,
      ...compositor.deposit.resources({ tints: { a: tinted ? targets.tintA!.view : targets.blank.view, b: tinted ? targets.tintB!.view : targets.blank.view }, wet: !!landing }),
    ], box.w, box.h);
  }

  /** The pixels a deposit's first `count` stamps (and dual stamps) reach, padded for its edges' blur, or null. */
  function depositBox(deposit: CompiledStampDeposit, loadedDeposit: LoadedDeposit, count: number, dualCount: number, pad: number): Box | null {
    const reach = [Infinity, Infinity, -Infinity, -Infinity];
    const { brush } = loadedDeposit;
    reachOfFirst(deposit.stamps, loadedDeposit.mainReach, count, reachSpanOf(brush), reach);
    if (brush.dual) reachOfFirst(deposit.dualStamps, loadedDeposit.dualReach, dualCount, reachSpanOf(brush.dual), reach);
    if (deposit.kind === 'flood') {
      const { x0, y0, x1, y1 } = deposit.flood.box;
      reach.splice(0, 4, Math.min(reach[0], x0), Math.min(reach[1], y0), Math.max(reach[2], x1), Math.max(reach[3], y1));
    }
    const x = Math.max(0, Math.floor(reach[0] - pad)), y = Math.max(0, Math.floor(reach[1] - pad));
    const w = Math.min(width, Math.ceil(reach[2] + pad)) - x, h = Math.min(height, Math.ceil(reach[3] + pad)) - y;
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  }

  const photograph = paper.image ? image(paper.image) : null;
  /** The paper's Paper uniform at word `at`. Cover: the photograph fills the painting, cropped along whichever side it has to spare. */
  const writePaper = (views: StampUniformViews, at: number) => {
    const put = stampUniformWriter(PAPER, views, at);
    put('color', rgb(paper.color));
    if (!photograph) return;
    const fit = Math.max(width / photograph.width, height / photograph.height);
    put('hasImage', 1);
    put('cover', [width / (photograph.width * fit), height / (photograph.height * fit)]);
    put('lod', Math.max(0, Math.log2(1 / fit)));
  };
  const groupResources = compositor.group.resources({ photograph: photograph?.view ?? targets.blank.view, sampler: linearClamp });
  /** The moved group pass's bindings from after the compositor's up to GROUP_REST_BINDING: the rest points. */
  const groupRest = (rest: GPUTextureView): (GPUBindingResource | null)[] => [...Array<null>(GROUP_REST_BINDING - 3 - groupResources.length).fill(null), rest];

  function drawPaper(encoder: GPUCommandEncoder) {
    dispatch(encoder, pipelines.paper, [slot((views) => writePaper(views, 0)), photograph?.view ?? targets.blank.view, targets.painting.view, linearClamp], width, height);
  }

  /** Each warped group's last lattice, by its index: a frame warping it alike over the same box samples its map no more. */
  const lattices = new Map<number, { key: string; triangles: Float32Array }>();
  /**
   * Lays group `index`'s layer over `painted` onto the painting at its frame's visibility: where it's painted, or
   * resampled to where its frame's warp bends it and its placement puts it, its own paper read where it's painted, too.
   */
  function layGroup(encoder: GPUCommandEncoder, index: number, { group, moved, pivot, warp, visibility }: StampGroupFrame, painted: Box) {
    if (!visibility) return;
    let box: Box | null = painted, lay: ReturnType<typeof latticeLayOf> | null = null;
    const placed = moved && stampPlacementWarpMap(moved, pivot);
    if (warp || placed) {
      // A pixel past the painted box, for the bilinear read's reach. A placement is affine, so one cell carries it exactly.
      const rest = { x: painted.x - 1, y: painted.y - 1, w: painted.w + 2, h: painted.h + 2 };
      let triangles: Float32Array;
      if (warp) {
        const key = `${JSON.stringify(warp.key)}|${warp.cell}|${moved ? `${moved.x},${moved.y},${moved.rotation},${moved.scale},${pivot?.x},${pivot?.y}` : ''}|${rest.x},${rest.y},${rest.w},${rest.h}`;
        const kept = lattices.get(index);
        if (kept?.key === key) triangles = kept.triangles;
        else {
          const { columns, rows } = stampWarpCells(rest.w, rest.h, warp.cell);
          triangles = stampWarpTriangles(placed ? (point) => placed(warp.map(point)) : warp.map, rest, columns, rows);
          lattices.set(index, { key, triangles });
        }
      } else triangles = stampWarpTriangles(placed!, rest, 1, 1);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let v = 0; v < triangles.length; v += 4) {
        x0 = Math.min(x0, triangles[v]); x1 = Math.max(x1, triangles[v]);
        y0 = Math.min(y0, triangles[v + 1]); y1 = Math.max(y1, triangles[v + 1]);
        // To clip space, y up.
        latticeStaging.set([(triangles[v] / width) * 2 - 1, 1 - (triangles[v + 1] / height) * 2, triangles[v + 2], triangles[v + 3]], latticeUsed + v);
      }
      box = inPainting(x0, y0, x1, y1);
      if (!box) return;
      lay = latticeLayOf();
      const first = latticeUsed;
      latticeUsed += triangles.length;
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: lay.rest.view, loadOp: 'clear', clearValue: [STAMP_NO_REST, STAMP_NO_REST, 0, 0], storeOp: 'store' }] });
      pass.setPipeline(lay.latticePipeline);
      pass.setBindGroup(0, bindGroup(lay.latticePipeline, [targets.layer.view, linearClamp]));
      pass.setVertexBuffer(0, latticeVertices, first * 4, triangles.length * 4);
      pass.draw(triangles.length / 4);
      pass.end();
    }
    const at = box;
    dispatch(encoder, lay ? lay.movedGroupPipeline : pipelines.group, [
      slot((views) => {
        const put = stampUniformWriter(GROUP, views);
        put('opacity', group.opacity * visibility);
        put('glaze', group.composite === 'glaze' ? 1 : 0);
        put('origin', [at.x, at.y]);
        put('extent', [at.w, at.h]);
        put('group', index);
        writePaper(views, GROUP.at.paper);
        put('paperFromRest', lay && group.paper === 'own' ? 1 : 0);
      }),
      targets.layer.view, targets.painting.view, ...groupResources, ...(lay ? groupRest(lay.rest.view) : []),
    ], at.w, at.h);
  }

  /** Whole pixels of the painting within x0..x1, y0..y1, or null for none. */
  const inPainting = (x0: number, y0: number, x1: number, y1: number): Box | null => {
    const x = Math.max(0, Math.floor(x0)), y = Math.max(0, Math.floor(y0));
    const w = Math.min(width, Math.ceil(x1)) - x, h = Math.min(height, Math.ceil(y1)) - y;
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  };

  // Frames start from the latest checkpoint their settled events stand for (stamp-paint-checkpoints.ts).
  const events = stampPaintEvents(painting);
  // Made on the surface's device: they come and go as frames save them, and dispose destroys what's left.
  const checkpoints = stampPaintCheckpoints(surface.device, { painting: targets.painting.texture, layer: targets.layer.texture, clip: targets.clip.texture });
  const groupEvents = stampGroupEvents(painting);

  // A boiling group's epochs other than 0 (the painting as written), each group's recently drawn ones kept on the GPU.
  const epochs = new Map<CompiledStampGroup, Map<number, { marks: CompiledStampGroup; bank: DepositBank; used: number }>>();
  let epochClock = 0;
  /** `group` as drawn at boil `epoch`, and the bank holding its deposits; an epoch is compiled and loaded once while kept. */
  function epochOf(group: CompiledStampGroup, epoch: number): { marks: CompiledStampGroup; bank: DepositBank } {
    if (!epoch) return { marks: group, bank: writtenBank };
    const kept = epochs.get(group) ?? new Map<number, { marks: CompiledStampGroup; bank: DepositBank; used: number }>();
    epochs.set(group, kept);
    let found = kept.get(epoch);
    if (!found) {
      if (kept.size >= STAMP_BOIL_EPOCHS_KEPT) {
        const [oldest, { bank }] = [...kept].reduce((a, b) => (b[1].used < a[1].used ? b : a));
        bank.destroy();
        kept.delete(oldest);
      }
      const marks = group.boil!.reseeded(epoch);
      found = { marks, bank: loadBank([marks], { kind: 'epoch', written: writtenBank }), used: 0 };
      kept.set(epoch, found);
    }
    found.used = ++epochClock;
    return found;
  }

  // Each live group's recently drawn marks, by their key, kept on the GPU: the frame drawing, and one a hold returns to.
  const lives = new Map<CompiledStampGroup, Map<string, { marks: CompiledStampGroup; bank: DepositBank; used: number }>>();
  /**
   * `group`'s `live` marks and the bank holding them, with their own wetness, regions and wet stages: loaded once while
   * kept under their key, which names them (equal keys, equal marks), so a frame repeating one draws the marks loaded.
   */
  function liveOf(group: CompiledStampGroup, live: NonNullable<StampGroupFrame['live']>): { marks: CompiledStampGroup; bank: DepositBank } {
    const kept = lives.get(group) ?? new Map<string, { marks: CompiledStampGroup; bank: DepositBank; used: number }>();
    lives.set(group, kept);
    let found = kept.get(live.key);
    if (!found) {
      if (kept.size >= STAMP_LIVE_MARKS_KEPT) {
        const [oldest, { bank }] = [...kept].reduce((a, b) => (b[1].used < a[1].used ? b : a));
        bank.destroy();
        kept.delete(oldest);
      }
      const loaded = span('stamp paint live load');
      found = { marks: live.marks, bank: loadBank([live.marks], { kind: 'live' }), used: 0 };
      loaded();
      kept.set(live.key, found);
    }
    found.used = ++epochClock;
    return found;
  }

  /**
   * Draws a shown deposit of `pass` (as its bank's home knows it) and runs the deposit stages after it, returning the
   * pixels changed. `settled`: the deposit is wholly shown at `t`.
   */
  function drawDeposit(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, loadedDeposit: LoadedDeposit, pass: CompiledStampPass, t: number, epoch: number, settled: boolean, frameTrace?: FrameTrace): Box | null {
    const count = visibleStampCountAt(deposit, t);
    const dualCount = visibleStampCountAt(deposit, t, 'dualStamps');
    // The rim is where the mask stands above a blur as wide as its edge.
    const sigma = loadedDeposit.active.edgeSigma, blurred = sigma > 0;
    const box = depositBox(deposit, loadedDeposit, count, dualCount, depositPad(loadedDeposit.identity, loadedDeposit, pass));
    if (!box) return null;
    drawStamps(encoder, deposit, loadedDeposit, count, dualCount, box);
    if (!loadedDeposit.landing) {
      pressing?.draw(encoder, deposit, loadedDeposit, count, box);
      before?.copy(encoder, box);
    }
    if (blurred) blurMask(encoder, sigma, box);
    resolveDeposit(encoder, deposit, loadedDeposit, pass, t, blurred, box, frameTrace);
    let painted: Box = box;
    // A stage knows each deposit as its bank's home does (`staged`); a boil's epoch lands as its deposit as written does
    // (loadBank), and draws its randomness from the epoch's seed.
    const { landing, identity, staged, home } = loadedDeposit;
    if (!landing) return painted;
    const seed = paintPigmentSeed(stampBoilSeed(identity.id, epoch));
    for (const stage of home.stages) {
      if (stage.after === 'deposit' && (settled || !stage.settled)) painted = unionOf(painted, stage.running.encode(encoder, { deposit: staged, pass, landing, box, seed }))!;
    }
    return painted;
  }

  /**
   * Encodes the frame at `t`. `whole` draws it from bare paper, neither restoring nor saving a checkpoint: a traced
   * frame, so every deposit it asks for is resolved in it, and a read-back layer, which a checkpoint may skip past.
   */
  function draw(t: number, { frameTrace, whole = frameTrace !== undefined, state }: { frameTrace?: FrameTrace; whole?: boolean; state?: StampPaintFrameState } = {}) {
    surface.assertLive();
    const { groups, settled, checkpointKey, checkpointSaves } = stampFramePlan(painting, groupEvents, events, t, fps, state);
    slots = 0;
    latticeUsed = 0;
    latticeRoom(groups);
    const encoder = device.createCommandEncoder();
    const start = whole ? null : checkpoints.latest(settled, checkpointKey);
    const from = start?.event ?? 0;
    const saves = whole ? new Set<number>() : checkpointSaves(from);
    // A group placed afresh at the last event is saved there painted, before its lay; the store keeps the first save of a key.
    const save = (event: number, inGroup: boolean, painted: Box | null) => {
      if (saves.has(event)) checkpoints.save(encoder, { event, key: checkpointKey(event), inGroup, painted });
    };
    if (start) checkpoints.restore(encoder, start);
    else drawPaper(encoder);
    for (const [index, groupFrame] of groups.entries()) {
      const { group, epoch, live, ownPlacement } = groupFrame;
      const { first, end } = groupEvents[index];
      // A checkpoint at a group's end within it holds it painted, not laid: only its lay is left.
      if (end < from || (end === from && !start?.inGroup)) continue;
      const { marks, bank } = live ? liveOf(group, live) : epochOf(group, epoch);
      save(first, false, null);
      if (first >= from) for (const view of targets.layer.layers) clear(encoder, view);
      let painted: Box | null = start && from > first ? start.painted : null;
      let event = first;
      for (const [p, pass] of group.passes.entries()) {
        // Live marks' regions and stages know their own passes; an epoch's know those as written.
        const drawnPass = marks.passes[p], stagedPass = bank.own ? drawnPass : pass;
        if (!pass.clipTo && event >= from) clear(encoder, targets.clip.view);
        const passFirst = event;
        for (const deposit of stampPassDeposits(drawnPass)) {
          if (event > first) save(event, true, painted);
          if (event++ < from) continue;
          const loadedDeposit = bank.deposits.get(deposit)!;
          if (stampDepositShowsAt(deposit, t)) painted = unionOf(painted, drawDeposit(encoder, deposit, loadedDeposit, stagedPass, t, epoch, events[event - 1].settledAt <= t, frameTrace));
          // A drying waits until every deposit in its wash so far is wholly shown, so no rim forms round paint still
          // being revealed: the same wait a checkpoint past it makes.
          const drying = loadedDeposit.home.dryingsByLast.get(loadedDeposit.staged);
          if (!drying || events.slice(passFirst, event).some((settling) => settling.settledAt > t)) continue;
          const seed = paintPigmentSeed(stampBoilSeed(drying.id, epoch));
          for (const stage of loadedDeposit.home.stages) if (stage.after === 'drying') painted = unionOf(painted, stage.running.encode(encoder, { drying, seed }));
        }
      }
      if (ownPlacement) save(end, true, painted);
      if (painted) layGroup(encoder, index, groupFrame, painted);
    }
    save(events.length, false, null);
    const out = encoder.beginRenderPass({ colorAttachments: [{ view: surface.frameTexture().createView(), loadOp: 'clear', storeOp: 'store' }] });
    out.setPipeline(outputPipeline);
    out.setBindGroup(0, bindGroup(outputPipeline, [targets.painting.view]));
    out.draw(3);
    out.end();
    device.queue.writeBuffer(uniforms, 0, staging, 0, slots * SLOT);
    if (latticeUsed) device.queue.writeBuffer(latticeVertices!, 0, latticeStaging, 0, latticeUsed);
    return encoder;
  }

  // A painting whose inputs change in the same commit as its time is disposed before its last draw is asked for.
  let disposed = false;
  // A frame's own read-back buffers are the surface's, made and destroyed by the frame.
  const { queue } = surface.device;
  return {
    draw: async (t, state) => {
      if (disposed) return;
      await surface.checked(`drawing the painting at ${t} s`, () => queue.submit([draw(t, { state }).finish()]));
    },
    trace: async (t, requests, state) => {
      if (disposed) throw new Error('stamp paint: a disposed renderer traces nothing');
      const traced: FrameTrace['deposits'] = new Map();
      let floats = 0;
      for (const request of requests) {
        const { deposit, crop } = request;
        if (!writtenBank.deposits.has(deposit)) throw new Error(`stamp paint: can't trace ${deposit.id}, which isn't in the painting`);
        if (traced.has(deposit)) throw new Error(`stamp paint: ${deposit.id} is traced twice in one frame`);
        if (!(crop.w > 0 && crop.h > 0)) throw new Error(`stamp paint: ${deposit.id}'s trace crop is ${crop.w} × ${crop.h}, and a crop needs pixels`);
        traced.set(deposit, { request, order: request.order ? stampResolveOrderIndex(request.order) : writtenBank.deposits.get(deposit)!.resolveOrder, offset: floats });
        floats += crop.w * crop.h * TRACE_SLOTS;
      }
      const bytes = Math.max(4, floats * 4);
      const traceBuffer = surface.device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const read = surface.device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      try {
        await surface.checked(`tracing the painting at ${t} s`, () => {
          const encoder = draw(t, { frameTrace: { deposits: traced, buffer: traceBuffer }, state });
          encoder.copyBufferToBuffer(traceBuffer, 0, read, 0, bytes);
          queue.submit([encoder.finish()]);
        });
        await read.mapAsync(GPUMapMode.READ);
        const all = new Float32Array(read.getMappedRange().slice(0));
        read.unmap();
        return requests.map(({ deposit, crop }) => {
          const { order, offset } = traced.get(deposit)!, plane = crop.w * crop.h;
          const at = (index: number) => all.slice(offset + index * plane, offset + (index + 1) * plane);
          return { crop, built: at(0), stages: STAMP_RESOLVE_ORDERS[order].map((stage, k) => ({ stage, coverage: at(k + 1) })), coverage: at(TRACE_SLOTS - 1) };
        });
      } finally {
        traceBuffer.destroy();
        read.destroy();
      }
    },
    readLayer: async (t, state) => {
      if (disposed) throw new Error('stamp paint: a disposed renderer reads back nothing');
      const layers = targets.layer.layers.length, rowBytes = Math.ceil((width * 8) / 256) * 256;
      const read = surface.device.createBuffer({ size: rowBytes * height * layers, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      try {
        await surface.checked(`reading back the layer at ${t} s`, () => {
          const encoder = draw(t, { whole: true, state });
          encoder.copyTextureToBuffer({ texture: targets.layer.texture }, { buffer: read, bytesPerRow: rowBytes, rowsPerImage: height }, [width, height, layers]);
          queue.submit([encoder.finish()]);
        });
        await read.mapAsync(GPUMapMode.READ);
        const halves = new Uint16Array(read.getMappedRange()), values = new Float32Array(width * height * 4 * layers);
        for (let l = 0; l < layers; l++) {
          for (let y = 0; y < height; y++) {
            const from = (l * height + y) * (rowBytes / 2), to = (l * height + y) * width * 4;
            for (let i = 0; i < width * 4; i++) values[to + i] = halfFloat(halves[from + i]);
          }
        }
        read.unmap();
        return { width, height, layers, values };
      } finally {
        read.destroy();
      }
    },
    finish: () => (disposed ? Promise.resolve() : queue.onSubmittedWorkDone()),
    dispose() {
      disposed = true;
      // Destroyed once submitted work is done with them; the surface and its targets stay for the next painting.
      for (const kept of [...epochs.values(), ...lives.values()]) for (const { bank } of kept.values()) bank.destroy();
      checkpoints.dispose();
      scope.destroy();
    },
  };
}


const clear = (encoder: GPUCommandEncoder, view: GPUTextureView) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }).end();
const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
const rgb = (hex: string): [number, number, number] => [channel(hex, 1), channel(hex, 3), channel(hex, 5)];
/** The mip level a grain `texture` tiled `tileW` pixels across reads: texels per pixel, as a fragment's derivatives would say. */
const grainLod = (texture: StampPaintImage, tileW: number) => Math.max(0, Math.log2(texture.width / tileW));

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

/** Where a mask's region can cover anything: its box grown by how far its edge reaches. */
const areaBox = (area: CompiledStampMaskArea) => stampPolygonBox(area.polygon, stampEdgeReach(area.edge) + 1);

/** A box as a uniform's four words; an empty box for none, whose region reads 0 everywhere. */
const boxWords = (box: Box | undefined): [number, number, number, number] => (box ? [box.x, box.y, box.w, box.h] : [0, 0, 0, 0]);

const unionOf = (a: Box | null, b: Box | null) => (a && b ? union(a, b) : a ?? b);

/** A wet stage as loaded, by when it runs, a deposit stage with whether it waits for its deposit to be wholly shown. */
type LoadedWetStage =
  | { after: 'deposit'; settled: boolean; running: StampLoadedWetStage<StampWetDepositMoment> }
  | { after: 'drying'; running: StampLoadedWetStage<StampWetDryingMoment> };

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

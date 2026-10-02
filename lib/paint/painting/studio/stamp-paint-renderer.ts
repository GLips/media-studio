// stamp-paint-renderer.ts: draws a compiled stamp painting through WebGPU on a surface (stamp-paint-surface.ts), whose
// device's owner holds what outlasts it; a painting loads its own stamps, regions and wet stages, and keeps its groups'
// films and its planes' pictures (stamp-plane.ts), laid where each frame's lens puts them (stamp-paint-plane-passes.ts).
//
// A deposit paints within its stamps' box in Photoshop's order: a render pass stamps its coverage mask and joins a
// flood's body to it, compute passes blur it, and a compute pass resolves it onto its group's layer.
//
// What doesn't change with time is made at load into cropped single-channel textures (loadRegions).
//
// Formulas and stage orders come from the models' WGSL registries; the GPU gate (lib/paint/gate) holds them.

import { bindStampBrushImages, stampBrushImages, type StampBrush, type StampBrushAsset, type StampBrushGrain, type StampBrushImageSource, type StampBrushLayer } from '#lib/paint/brush/models/stamp-brush.ts';
import { COVERAGE_FORMULAS_WGSL, stampDualModeIndex, stampGrainModeIndex } from '#lib/paint/brush/models/coverage-formulas.ts';
import {
  STAMP_ACCUMULATION_LAY_WGSL, STAMP_ACCUMULATION_RESOLVE_WGSL, STAMP_ACCUMULATIONS, STAMP_BLUR_LEVELS, STAMP_RESOLVE_ORDERS, STAMP_RESOLVE_PLANS, stampAccumulationBuild, stampAccumulationIndex,
  stampActiveLayers, stampResolveOrderIndex, stampResolveOrdersWgsl, stampResolvePlan, type StampAccumulationPlan, type StampActiveLayer, type StampResolveStage,
} from '../models/stamp-deposit-stages.ts';
import { STAMP_PAINT_FIELD_SHARE, stampPaintFieldEnds } from '../models/stamp-paint-field.ts';
import {
  stampBoilSeed, stampPassDeposits, type CompiledStampDeposit, type CompiledStampFlood, type CompiledStampGroup, type CompiledStampMask, type CompiledStampPaint, type CompiledStampPass,
} from '../models/stamp-paint-recipe-compile.ts';
import type { StampPaintPaper } from '../models/stamp-paint-recipe-types.ts';
import { compileStampPigmentPaint, stampGrainDepthSourceIn, stampPigmentGroupMedium, type StampPaintMixing } from '../models/stamp-pigment-paint.ts';
import { compileStampWetness, STAMP_WET_CELL, STAMP_COVERAGE_SAMPLE_STEP, stampCoverageSampleGrid, type StampBrushedCoverage, type StampCoverageSamples, type StampWashDrying, type StampWetLanding, type StampWetness } from '../models/stamp-wetness.ts';
import { STAMP_RESIST_TOOTH, stampPaintingBrushedMasks, type CompiledStampBrushedMask, type CompiledStampMarkPlacement } from '../models/stamp-brushed-mask.ts';
import { stampWetReport, stampWetReportStrictFailures, stampWetReportWarnings } from '../models/stamp-wet-report.ts';
import { STAMP_WET_LAND_WGSL, stampDepositionLaw, stampFloodCarriesWater } from '../models/stamp-wet-landing.ts';
import { PAINT_DRY_BURNISHED_PRESS, PAINT_PAPER_WGSL, paintPigmentSeed } from '#lib/paint/materials/models/paint-paper.ts';
import { PAINT_BANDS } from '#lib/paint/materials/models/paint-spectrum.ts';
import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { STAMP_GRID_AT_WGSL, STAMP_POLYGON_DISTANCE_WGSL, STAMP_REGION_WGSL, stampEdgeWidth, type StampBox, type StampPoint } from '../models/stamp-region.ts';
import { STAMP_AREA_COVERAGE_WGSL, stampAreaBox, type CompiledStampArea } from '../models/stamp-area.ts';
import type { FrozenStampMarks } from '#lib/paint/brush/models/stamp-placement.ts';
import { STAMP_FLOATS, STAMP_ORDERED_TILE, stampBinsAppended, stampInstanceFloats, stampMarksExtremes, stampMarksOrderedBins, stampMarksPlan, stampMarksReach, stampTintFloats, TINT_FLOATS } from '../models/stamp-mark-load.ts';
import { stampBlurRegion, type StampPixelBox } from '../models/stamp-blur-region.ts';
import { coarsestStampTipLevel, STAMP_TIP_HULL_SIDES, type StampTipHull, type StampTipLevel } from '../models/stamp-tip-hull.ts';
import { flatStampPaintCompositor, type StampPaintCompositor, type StampPaintTarget, type StampWashLayer } from './stamp-paint-compositor.ts';
import { stampPigmentCompositor } from './stamp-paint-pigment-compositor.ts';
import { type StampPaintDevice, type StampPaintImage } from './stamp-paint-gpu.ts';
import type { StampPaintGpuScope } from './stamp-paint-gpu-owner.ts';
import type { StampPaintSurface } from './stamp-paint-surface.ts';
import type { StampLensSource, StampLensSourceExposure } from './stamp-lens-source.ts';
import { gpuUniformLayout, gpuUniformStruct, gpuUniformWriter, type GpuUniformViews } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { STAMP_WET_STAGES, stampWetStageReach, type StampLoadedWetStage, type StampWetStage, type StampWetDepositMoment, type StampWetDryingMoment, type StampWetStageContext } from './stamp-wet-stages.ts';
import {
  STAMP_GLOW_OCCLUSION, STAMP_GLOW_SOURCE, STAMP_PLANE_LIGHT, STAMP_PLANE_PICTURE, stampGlowOcclusionWgsl, stampGlowSourceWgsl,
  stampPlaneLightWgsl, stampPlanePictureLayerCount, stampPlanePictureLayers, stampPlanePictureLayersKey, stampPlanePictureWgsl,
  type StampPlanePictureLayers,
} from './stamp-paint-plane-passes.ts';
import { LENS_DEFOCUS_LEAST, lensGaussianReach, lensSigmaStepped, type LensFocus } from '#lib/picture/lens/models/lens-focus.ts';
import { GPU_GAUSSIAN_PASS, gpuGaussianPassWgsl } from '#lib/platform/gpu/models/gpu-gaussian.ts';
import { createLensCompositor, type LensFrameExposures, type LensLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import type { LensPictureLayers } from '#lib/picture/lens/studio/lens-passes.ts';
import type { FrameProfileStart } from '#lib/picture/profiling/studio/frame-profile.ts';
import { stampWarpCells, stampWarpTriangles, STAMP_WARP_MOST_CELLS } from '../models/stamp-group-warp.ts';
import {
  stampFramePlan, stampFramePlanExposed, stampFramePlanMotion, stampGroupSceneMap, type StampGroupFrame, type StampGroupTravel, type StampMotionSpan, type StampPosedMoment,
} from '../models/stamp-frame-plan.ts';
import type { StampGroupMarks, StampPaintFrameState } from '../models/stamp-paint-frame-state.ts';
import { stampSinglePlane, type StampLaidPlanes, type StampLensFrame, type StampPlaneLook } from '../models/stamp-plane.ts';
import { stampStage, stampStageWgsl, type StampStage } from '../models/stamp-stage.ts';
import { GPU_FULL_FRAME_WGSL, GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';

/** Bytes per uniform slot: every draw's uniforms sit at an offset WebGPU allows binding at (256). */
const SLOT = 256;
/**
 * The uniform slots a plane takes besides its groups': its paper (white) and black, a light pass, its picture, its
 * defocus (two passes) and its composite. A renderer measuring its backings at load takes four, fewer than one plane's.
 */
const PLANE_SLOTS = 7;
/** The uniform slots a frame's bloom takes: a gaussian's two passes. */
const BLOOM_SLOTS = 2;

/** A compute pass's workgroup is 8 × 8 pixels. */
const WORKGROUP = 8;

/**
 * A grain as its brush reads it: `place` is its tile (px) and offset (tiles), `shape` its depth, mip level, brightness
 * and contrast; `layer` whether its blend is a layer formula, `aboutMean` its contrast's pivot, `mirror` whether it
 * tiles mirrored.
 */
const GRAIN = gpuUniformLayout('Grain', [['place', 'vec4f'], ['shape', 'vec4f'], ['blend', 'i32'], ['layer', 'u32'], ['aboutMean', 'u32'], ['mirror', 'u32']]);

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
const STAMP_DRAW = gpuUniformLayout('StampDraw', [
  ['resolution', 'vec2f'], ['roundness', 'f32'], ['rolling', 'u32'], ['grain', gpuUniformStruct(GRAIN)], ['diameter', 'f32'], ['zoom', 'f32'],
  ['movement', 'f32'], ['hull', { vec4fArray: STAMP_TIP_HULL_SIDES / 2 }], ['span', 'f32'], ['towardFull', 'u32'], ['center', 'vec2f'], ['noise', 'f32'], ['pressed', 'vec4f'],
]);
const stampWgsl = (stage: StampStage) => /* wgsl */ `
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
  let at = (stamp.xy + local + vec2f(STAGE_MARGIN)) / u.resolution * 2.0 - 1.0;
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

// An `ordered` layer is one triangle over the deposit's box: each texel walks its tile's stamps in order, laying each
// by its accumulation's lay. A stamp's tip place inverts the fixed path's vertex transform; tip and rolling grain are
// sampled at that path's interpolated gradients, the tip's grown by its blur as the fixed path's bias grows it.
const ORDERED_DRAW = gpuUniformLayout('OrderedDraw', [
  ['grain', gpuUniformStruct(GRAIN)], ['roundness', 'f32'], ['rolling', 'u32'], ['diameter', 'f32'], ['zoom', 'f32'], ['movement', 'f32'],
  // `first`: the layer's first stamp's first float in its bound slice; `tint`: its first tint's index there.
  ['span', 'f32'], ['first', 'u32'], ['count', 'u32'], ['tint', 'u32'], ['bins', 'u32'], ['tilesX', 'u32'], ['accumulation', 'i32'], ['center', 'vec2f'], ['noise', 'f32'], ['pressed', 'vec4f'],
]);
const orderedWgsl = (stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${GPU_FULL_FRAME_WGSL}
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

/** The WGSL declaring a compositor's `target` as `name` at `binding`: storage with `access`, or sampled for null. */
function stampPaintTargetWgsl(name: string, binding: number, target: StampPaintTarget, access: 'read_write' | 'write' | null) {
  const array = target.kind === 'array' ? '_array' : '';
  const type = access ? `texture_storage_2d${array}<rgba16float, ${access}>` : `texture_2d${array}<f32>`;
  return `@group(0) @binding(${binding}) var ${name}: ${type};`;
}

/** A deposit's resolve uniform. Its compositor's PaintDeposit has a slot of its own, `paint`, as this one is full. */
const DEPOSIT = gpuUniformLayout('Deposit', [
  ['view', 'vec4f'], ['edges', 'vec4f'], ['dualEdges', 'vec4f'],
  ['grain', gpuUniformStruct(GRAIN)], ['dualGrain', gpuUniformStruct(GRAIN)], ['paperDepth', 'f32'], ['paperLod', 'f32'], ['opacity', 'f32'],
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
 * width, height), and a fill's load field (STAMP_PAINT_FIELD_SHARE) and body levels as it lands outside a wash (FLOOD_LAND_COVER_WGSL); how far round a pixel its stroke's body is
 * looked for, where its coverage hardens (strokeBodyAt).
 */
const KEEP = gpuUniformLayout('Keep', [
  ['fluid', 'vec4f'], ['within', 'vec4f'], ['load', 'vec4f'], ['loadEnds', 'vec2f'], ['loadKind', 'i32'], ['bodyReach', 'f32'],
  ['bodyLevels', 'vec2f'],
]);
/**
 * A wash deposit's landing (StampWetLanding): its grids' lattice (x0, y0, cell) and size, where its wetness starts in
 * the wet grid buffer (workable and settled follow it), its painting time, its brush's water, a lift's strength, and
 * what it does.
 */
const WET_OP = gpuUniformLayout('WetOp', [
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

// A canvas grain cutting coverage `a` at `at`, its tile repeating or mirrored; after GRAIN_WGSL, with `tile` and
// `mirrorTile` bound.
const TEXTURIZED_WGSL = /* wgsl */ `
fn texturized(g: texture_2d<f32>, at: vec2f, a: f32, p: Grain) -> f32 {
  let uv = at / p.place.xy + p.place.zw;
  let raw = select(textureSampleLevel(g, tile, uv, p.shape.y).r, textureSampleLevel(g, mirrorTile, uv, p.shape.y).r, p.mirror == 1u);
  return grained(a, raw, grainMean(g, tile), p, 1.0);
}`;

/** Values a traced resolve records per pixel: the build as its accumulation resolves it, after each stage, and the coverage laid. */
const TRACE_SLOTS = STAMP_RESOLVE_PLANS.grainFirst.length + 2;

/** A traced deposit's crop (its origin and size in the painting's pixels) and where in the trace buffer its slots start, in floats. */
const TRACE_CROP = gpuUniformLayout('TraceCrop', [['origin', 'vec2u'], ['extent', 'vec2u'], ['offset', 'u32']]);

// A compute pass has no derivatives, so each grain's mip level is worked out on the CPU. A wash's resolve (`wet`) is
// a module of its own: WGSL counts a binding read under a false override as used, and a dry resolve mustn't hold
// the wet bindings.
const depositWgsl = (compositor: StampPaintCompositor, wet: boolean, stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
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
// A region texture's value at a texel, its box's x, y, width and height in the stage's texels: none outside it.
fn regionAt(region: texture_2d<f32>, box: vec4f, pixel: vec2u) -> f32 {
  let q = vec2f(pixel) - box.xy;
  if (any(q < vec2f(0.0)) || any(q >= box.zw)) { return 0.0; }
  return textureLoad(region, vec2u(q), 0).r;
}
${TEXTURIZED_WGSL}

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
  // \`pixel\` is the stage's texel, \`at\` its centre as a painting point: what every grain, field and noise reads.
  let pixel = u.origin + id.xy;
  let at = stagePoint(vec2i(pixel));
  tracedPixel = pixel;
  // Each layer's stroke as its accumulation resolves it: a glaze's from its densest stamp (the cap's blue or alpha)
  // toward the build held under its cap (red or green).
  let built = textureLoad(mask, pixel, 0).rg;
  let kept = textureLoad(cap, pixel, 0);
  var raw = vec2f(
    accumulationResolve(built.x, kept.b, kept.r, u.build.x, i32(u.accumulation.x)),
    accumulationResolve(built.y, kept.a, kept.g, u.build.y, i32(u.accumulation.y)),
  );
  let soft = textureSampleLevel(blurred, linearClamp, (vec2f(pixel) + 0.5) / u.view.xy, 0.0);
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
  // A fill's load is how much paint it lays: burnt edges and a clip base alike.
  if ((u.flags & FLOOD) != 0u) {
    let load = clamp(mix(k.loadEnds.x, k.loadEnds.y, paintFieldShare(at, k.loadKind, k.load)), 0.0, 1.0);
    keep *= load;
    reach *= load;
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

/**
 * A brushed mask's mark resolved into its texture (stamp-brushed-mask.ts): the stage's texel the texture's first is,
 * and its resist's amount (0 for fluid).
 */
const BRUSHED_COVER = gpuUniformLayout('BrushedCover', [['origin', 'vec2f'], ['resist', 'f32']]);
// A mark's coverage as a deposit's resolve has it before its paper, fluid and pigment: its builds resolved, the
// dual's grain and pooling, then its plan's stages. Wax keeps only what catches the paper's peaks, as a dry stick
// pressed fully does (paintDryContact). A mask's marks join by max, the blend.
const brushedCoverWgsl = (stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${DEPOSIT.wgsl}
${BRUSHED_COVER.wgsl}
${GRAIN_WGSL}
${DEPOSIT_FLAGS_WGSL}
${STAMP_ACCUMULATION_RESOLVE_WGSL}
${PAINT_PAPER_WGSL}
${GPU_FULL_FRAME_WGSL}
@group(0) @binding(0) var<uniform> u: Deposit;
@group(0) @binding(1) var mask: texture_2d<f32>;
@group(0) @binding(2) var cap: texture_2d<f32>;
@group(0) @binding(3) var grain: texture_2d<f32>;
@group(0) @binding(4) var dualGrain: texture_2d<f32>;
@group(0) @binding(5) var paperGrain: texture_2d<f32>;
@group(0) @binding(6) var tile: sampler;
@group(0) @binding(7) var mirrorTile: sampler;
@group(0) @binding(8) var<uniform> b: BrushedCover;
${TEXTURIZED_WGSL}
fn traced(slot: u32, value: f32) {}
${RESOLVE_STAGES_WGSL}
@fragment fn brushedCover(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let pixel = vec2u(floor(at.xy + b.origin));
  let p = stagePoint(vec2i(pixel));
  let built = textureLoad(mask, pixel, 0).rg;
  let kept = textureLoad(cap, pixel, 0);
  let raw = vec2f(
    accumulationResolve(built.x, kept.b, kept.r, u.build.x, i32(u.accumulation.x)),
    accumulationResolve(built.y, kept.a, kept.g, u.build.y, i32(u.accumulation.y)),
  );
  var d = 0.0;
  if ((u.flags & DUAL) != 0u) {
    d = raw.g;
    if ((u.flags & DUAL_CANVAS_GRAIN) != 0u) { d = texturized(dualGrain, p, d, u.dualGrain); }
    if ((u.flags & DUAL_POOLED) != 0u) { d = pooled(d, u.pooling.z, u.pooling.w); }
  }
  var m = clamp(resolveStages(raw.r, d, p, u.resolveOrder), 0.0, 1.0);
  if (b.resist > 0.0) {
    var contact = 1.0;
    if ((u.flags & PAPER) != 0u) {
      let h = textureSampleLevel(paperGrain, mirrorTile, p / u.view.zw, u.paperLod).r;
      let mean = textureSampleLevel(paperGrain, tile, vec2f(0.5), 16.0).r;
      contact = paintDryContact(h, mean, ${STAMP_RESIST_TOOTH.toFixed(4)}, u.paperDepth, 1.0, 0.0);
    }
    m *= contact * b.resist;
  }
  return vec4f(m);
}`;

/** A brushed mask's texture's first pixel on the painting, and the first sample it's read onto (stampCoverageSampleGrid). */
const SAMPLE_COVER = gpuUniformLayout('SampleCover', [['origin', 'vec2f'], ['first', 'vec2f']]);
// Each of the wetness's samples a brushed mask's texture reaches: the mean of its pixels, none outside the texture.
const SAMPLE_COVER_WGSL = /* wgsl */ `
${SAMPLE_COVER.wgsl}
${GPU_FULL_FRAME_WGSL}
const STEP = ${STAMP_COVERAGE_SAMPLE_STEP}i;
@group(0) @binding(0) var mask: texture_2d<f32>;
@group(0) @binding(1) var<uniform> s: SampleCover;
@fragment fn sampleCover(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let start = (vec2i(floor(at.xy)) + vec2i(s.first) - 1) * STEP - vec2i(s.origin);
  let size = vec2i(textureDimensions(mask));
  var sum = 0.0;
  for (var y = 0; y < STEP; y++) {
    for (var x = 0; x < STEP; x++) {
      let p = start + vec2i(x, y);
      if (all(p >= vec2i(0)) && all(p < size)) { sum += textureLoad(mask, p, 0).r; }
    }
  }
  return vec4f(sum / f32(STEP * STEP));
}`;

const PAPER = gpuUniformLayout('Paper', [['color', 'vec3f'], ['hasImage', 'u32'], ['cover', 'vec2f'], ['lod', 'f32'], ['frame', 'vec2f']]);
const PAPER_COLOR_WGSL = /* wgsl */ `
${PAPER.wgsl}
// The paper's gamma-encoded colour at painting point \`at\`: its photograph's, covering the frame (p.frame) and mirrored
// past it over the stage's margin, or its colour.
fn paperColor(image: texture_2d<f32>, paperSampler: sampler, p: Paper, at: vec2f) -> vec3f {
  let uv = at / p.frame;
  if (p.hasImage == 1u) { return textureSampleLevel(image, paperSampler, (uv - 0.5) * p.cover + 0.5, p.lod).rgb; }
  return p.color;
}`;
const paperWgsl = (compositor: StampPaintCompositor, stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${stampPaintTargetWgsl('painting', 2, compositor.targets.painting, 'write')}
${GPU_SRGB_WGSL}
${compositor.paper}
${PAPER_COLOR_WGSL}
@group(0) @binding(0) var<uniform> u: Paper;
@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(3) var photographSampler: sampler;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn paper(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(painting))) { return; }
  layPaper(id.xy, paperColor(image, photographSampler, u, stagePoint(vec2i(id.xy))));
}`;

/** A scene pixel's rest point where no moved or warped group's lattice covers it: outside any layer. */
const STAMP_NO_REST = -65536;

// \`paper\` is the paper under a group, read where a scene pixel is (groupGroundAt, fixed to the stage) unless the group
// carries its own as it moves or warps (StampGroupPaper, \`paperFromRest\`): then where its texel was painted.
// \`backing\` (STAMP_PAINT_BACKING_WORDS): what a reserve or lift shows, the paper or a clear plane's measuring backing.
const GROUP = gpuUniformLayout('Group', [
  ['opacity', 'f32'], ['glaze', 'u32'], ['origin', 'vec2u'], ['extent', 'vec2u'], ['group', 'u32'], ['paper', gpuUniformStruct(PAPER)], ['paperFromRest', 'u32'],
  ['backing', 'u32'],
]);
/**
 * What a plane's groups are laid on: the painting's paper (the back), or plain white or black (a clear plane measured
 * on each, stamp-paint-plane-passes.ts), no photograph.
 */
type StampPaintBacking = 'paper' | 'white' | 'black';
const STAMP_PAINT_BACKING_WORDS = { paper: 0, white: 1, black: 2 } as const satisfies Record<StampPaintBacking, number>;
/** Where the moved group pass binds the rest point of each scene pixel, past any compositor's own bindings. */
const GROUP_REST_BINDING = 16;
const groupWgsl = (compositor: StampPaintCompositor, moved: boolean, stage: StampStage) => {
  const { layer, painting } = compositor.targets;
  const layerAt = (texel: string) => (layer.kind === 'array' ? `textureLoad(layer, ${texel}, l, 0)` : `textureLoad(layer, ${texel}, 0)`);
  const paintingAt = painting.kind === 'array' ? 'textureLoad(painting, pixel, i)' : 'textureLoad(painting, pixel)';
  const store = (value: string) => (painting.kind === 'array' ? `textureStore(painting, pixel, i, ${value})` : `textureStore(painting, pixel, ${value})`);
  const paintingLayers = painting.kind === 'array' ? painting.layers : 1;
  const common = /* wgsl */ `
${stampStageWgsl(stage)}
${stampPaintTargetWgsl('layer', 1, layer, null)}
${stampPaintTargetWgsl('painting', 2, painting, 'read_write')}
${PAPER_COLOR_WGSL}
${GPU_SRGB_WGSL}
${GROUP.wgsl}
@group(0) @binding(0) var<uniform> u: Group;
fn groupUnderAt(pixel: vec2u, i: u32) -> vec4f { return ${paintingAt}; }
fn groupGroundAt(pixel: vec2u) -> vec2f { return stagePoint(vec2i(pixel)); }
// What a reserve or lift shows where \`paper\` lies under it: that, or the measuring backing.
fn groupBackingShown(paper: vec3f) -> vec3f {
  if (u.backing == 0u) { return paper; }
  return vec3f(select(0.0, 1.0, u.backing == 1u));
}`;
  if (!moved) return /* wgsl */ `${common}
fn groupLayerAt(pixel: vec2u, l: u32) -> vec4f { return ${layerAt('pixel')}; }
fn groupLaid(pixel: vec2u, i: u32, value: vec4f) { ${store('value')}; }
fn groupPaperAt(pixel: vec2u) -> vec2f { return stagePoint(vec2i(pixel)); }
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
  if (u.paperFromRest == 1u) { return stagePoint(tapTexel); }
  return stagePoint(vec2i(pixel));
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
    tapTexel = vec2i(base) + STAGE_MARGIN + vec2i(corner);
    for (var i = 0u; i < ${paintingLayers}u; i++) { tapLaid[i] = groupUnderAt(pixel, i); }
    layGroup(pixel, u.glaze == 1u, u.opacity);
    for (var i = 0u; i < ${paintingLayers}u; i++) { blended[i] += w * tapLaid[i]; }
  }
  for (var i = 0u; i < ${paintingLayers}u; i++) { ${store('blended[i]')}; }
}`;
};

const latticeMotionInto = (view: GPUTextureView): GPURenderPassColorAttachment => ({ view, loadOp: 'load', storeOp: 'store' });

// A moved or warped group's lattice (stamp-group-warp.ts) rasterised into \`rest\`: each scene pixel it covers learns its
// rest point; the rest keep STAMP_NO_REST. Where it folds, a later triangle covers an earlier unless its rest holds
// nothing. \`traced\`: its travel goes into the plane's motion, where its paint lies (\`paint\`), or over
// all it covers (\`region\`, a pass alone).
const groupLatticeWgsl = (layer: StampPaintTarget, stage: StampStage, traced: StampMotionCover | null) => /* wgsl */ `
${stampStageWgsl(stage)}
${stampPaintTargetWgsl('source', 0, layer, null)}
@group(0) @binding(1) var linearClamp: sampler;
struct LatticePoint { @builtin(position) at: vec4f, @location(0) rest: vec2f, @location(1) travel: vec2f };
struct LatticeLaid { ${traced === 'region' ? '@location(0) motion: vec4f' : `@location(0) rest: vec4f${traced ? ', @location(1) motion: vec4f' : ''}`} };
@vertex fn latticeVertex(@location(0) clip: vec2f, @location(1) rest: vec2f, @location(2) travel: vec2f) -> LatticePoint {
  return LatticePoint(vec4f(clip, 0.0, 1.0), rest, travel);
}
@fragment fn latticeRest(point: LatticePoint) -> LatticeLaid {${traced === 'region' ? `
  return LatticeLaid(vec4f(point.travel, 0.0, 1.0));` : `
  let uv = (point.rest + vec2f(STAGE_MARGIN)) / vec2f(textureDimensions(source));
  var held = vec4f(0.0);
  ${layer.kind === 'array'
    ? `for (var l = 0u; l < ${layer.layers}u; l++) { held += abs(textureSampleLevel(source, linearClamp, uv, l, 0.0)); }`
    : 'held = abs(textureSampleLevel(source, linearClamp, uv, 0.0));'}
  if (all(held == vec4f(0.0))) { discard; }
  return LatticeLaid(vec4f(point.rest, 0.0, 1.0)${traced ? ', vec4f(point.travel, 0.0, 1.0)' : ''});`}
}`;

/** A boiling group's epochs kept on the GPU besides its first: the one drawing, and a couple a scrub returns to. */
const STAMP_BOIL_EPOCHS_KEPT = 3;
/** A live group's marks kept on the GPU: the frame drawing's, and the last, which a hold on twos draws again. */
const STAMP_LIVE_MARKS_KEPT = 2;
/** A lattice vertex's floats: its stage clip point, its rest point, and its travel over its plane's motion span. */
const LATTICE_VERTEX_FLOATS = 6;
const STILL_TRAVEL = { x: 0, y: 0 };
/**
 * Where a group writes its motion: where its paint lies, as the lens gathers it, or over all its lattice covers, as
 * paper is carried with it (vid-151).
 */
type StampMotionCover = 'paint' | 'region';
const stampMotionCover = (span: StampMotionSpan['kind']): StampMotionCover => (span === 'shutter' ? 'paint' : 'region');
/**
 * A plane's motion as its picture is painted: each group's over `span` (stampFramePlanMotion), when one moves.
 */
type StampPlaneMotion = { readonly span: StampMotionSpan['kind']; readonly travels: readonly (StampGroupTravel | null)[] };
/** A frame's groups as its planes' pictures are painted: `motion`, when asked for and some group moves; `whole` and `frameTrace` as draw takes them. */
type StampPlaneDraw = { readonly groups: readonly StampGroupFrame[]; readonly motion: StampPlaneMotion | null; readonly whole: boolean; readonly frameTrace?: FrameTrace };
/** A plane's motion traced as its groups are laid: `into`, its motion target; `travel`, the group's (null: it lies still). */
type StampTracedMotion = { readonly into: GPUTextureView; readonly travel: StampGroupTravel | null; readonly cover: StampMotionCover };
/** How far past its painted box a group's lay reads its layer, px: the lattice's held test and four-tap read. */
const LAY_READ_REACH = 2;

// The frame's window of the stage, a painting shown as it is: an output pixel is the stage's texel a margin in.
const outputWgsl = (compositor: StampPaintCompositor, dithered: boolean, stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${GPU_FULL_FRAME_WGSL}
${stampPaintTargetWgsl('painting', 0, compositor.targets.painting, null)}
${GPU_SRGB_WGSL}
${compositor.output}
@fragment fn output(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let pixel = vec2u(at.xy);
  // An ordered dither, the same each frame, so a smooth flood doesn't band when the half floats become bytes.
  let dither = ${dithered ? '(fract(dot(vec2f(pixel), vec2f(0.7548776662, 0.5698402910))) - 0.5) / 255.0' : '0.0'};
  return vec4f(clamp(screenColor(pixel + vec2u(STAGE_MARGIN)) + dither, vec3f(0.0), vec3f(1.0)), 1.0);
}`;

// A state of the masking fluid over its box: the state it's built on (`parent`, width 0 for none), then `opCount` ops
// from `firstOp`: a mask joins its area by max, an unmask lifts its amount (everywhere for `count` 0), a clip keeps
// only its area (an application's `within`). An op's area is worked out only within its `reach`.
const MASK_STEP = gpuUniformLayout('MaskStep', [['box', 'vec4f'], ['parent', 'vec4f'], ['source', 'vec4f'], ['firstOp', 'u32'], ['opCount', 'u32']]);
/** A MaskOp's words: its fifteen, padded to its vec4f's alignment. */
const MASK_OP_WORDS = 16;
const MASK_STEP_WGSL = /* wgsl */ `
${COVERAGE_FORMULAS_WGSL}
${STAMP_REGION_WGSL}
${GPU_FULL_FRAME_WGSL}
${MASK_STEP.wgsl}
struct MaskOp { reach: vec4f, ragged: vec2f, width: f32, amount: f32, first: u32, count: u32, kind: u32, seed: u32, inset: f32, boundaryFirst: u32, boundaryCount: u32 }
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
      if (all(p >= op.reach.xy) && all(p <= op.reach.zw)) { r = areaCoverage(p, op.first, op.count, op.inset, op.ragged, op.width, op.seed, op.boundaryFirst, op.boundaryCount); }
    }
    if (op.kind == 2u) { fluid *= r; } else { fluid = select(fluid * (1.0 - op.amount * r), max(fluid, r), op.kind == 0u || op.kind == 3u); }
  }
  return vec4f(fluid);
}`;

// A flood's body over its box (floodBody), how thick its region is read from its grid (gridAt): the grid's first value
// in `grid`, its origin and cell, and its columns and rows.
const FLOOD_BODY = gpuUniformLayout('FloodBody', [['box', 'vec4f'], ['grid', 'vec4f'], ['gridSize', 'vec2u'], ['first', 'u32'], ['count', 'u32'], ['gridFirst', 'u32'], ['inset', 'f32']]);
const FLOOD_BODY_WGSL = /* wgsl */ `
${COVERAGE_FORMULAS_WGSL}
${STAMP_REGION_WGSL}
${GPU_FULL_FRAME_WGSL}
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
const BODY_DRAW = gpuUniformLayout('BodyDraw', [['box', 'vec4f'], ['tint', 'vec4f'], ['levels', 'vec2f']]);
const BODY_DRAW_WGSL = /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
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

/** Every image a painting's `brushes` and its paper need, each once, with how it wraps: a grain tiles, a tip or photograph doesn't. */
function paintingImages(brushes: readonly StampBrush[], paper: StampPaintPaper): [StampBrushAsset, 'tile' | 'clamp'][] {
  const assets = brushes.flatMap((brush) => stampBrushImages(brush).map(({ image, wrap }): [StampBrushAsset, 'tile' | 'clamp'] => [image, wrap]));
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

type LoadedPlan = Exclude<StampAccumulationPlan, { kind: 'ordered' }> | { kind: 'ordered'; bins: number };

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
  /**
   * A deposit laid by the wash law (stampDepositionLaw): its landing, and where its grids start in the painting's wet
   * grid buffer; null for one its medium's dry law lays, outside a wash or in it.
   */
  landing: StampWetLanding | null; wetFirst: number | null;
  /** Its brush with each image bound to its texture, and which of its layers' stages are active. */
  brush: StampBrush<StampPaintImage>;
  active: ReturnType<typeof stampActiveLayers<StampPaintImage>>;
  main: number; dual: number; tint: number | null;
  /** Writes its compositor's PaintDeposit at scene time `t` into a uniform slot. */
  writePaint: (views: GpuUniformViews, t: number) => void;
  mainHull: StampTipHull; dualHull: StampTipHull | null;
  /** How each layer's stamps are laid, and an `ordered` layer's bins' table in the bin buffer (stampMarksOrderedBins). */
  mainPlan: LoadedPlan; dualPlan: LoadedPlan | null;
  /** Its plan's order's case in the resolve (stampResolveOrderIndex). */
  resolveOrder: number;
};

/**
 * Stamps as drawStamps lays them, a deposit's (LoadedDeposit) or a brushed mask's mark's: its bound brush, where its
 * layers' stamps start in `stampBuffer`, how each layer is laid, and its tip hulls.
 */
type LoadedMarks = Pick<LoadedDeposit, 'brush' | 'active' | 'main' | 'dual' | 'tint' | 'mainHull' | 'dualHull' | 'mainPlan' | 'dualPlan' | 'stampBuffer' | 'tintBuffer' | 'binBuffer'>;

/** A mark's grain offsets, its main layer's and its dual's (stampGrainOffsets). */
type GrainOffset = CompiledStampDeposit['grainOffset'];
/** What a deposit or a brushed mask's mark places: its stamps, its dual's, and its grain's offset. */
type StampPlacedMarks = { stamps: FrozenStampMarks; dualStamps: FrozenStampMarks; grainOffset: GrainOffset };

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

/** A bank's regions: each flood's body by its deposit, each state of the fluid a deposit lands under, each deposit's `within`. */
type LoadedRegions = {
  bodies: ReadonlyMap<CompiledStampDeposit, RegionTexture | null>;
  fluids: ReadonlyMap<CompiledStampMask, RegionTexture | null>;
  withins: ReadonlyMap<CompiledStampDeposit, RegionTexture | null>;
};

/**
 * A frame of a painting, `t` seconds into its scene, each group in `state` (as painted where it gives none).
 * `once`: as painted, every plane at rest and sharp. `fast`: each plane where `lens` puts it, gathered along what
 * moves over `shutter` (null: shut). `exposure`: one of a reference frame's, each plane where `lens` puts it then.
 */
export type StampPaintFrame =
  | { readonly kind: 'once'; readonly t: number; readonly state?: StampPaintFrameState }
  | { readonly kind: 'fast'; readonly t: number; readonly state?: StampPaintFrameState; readonly lens: StampLensFrame; readonly shutter: StampPaintShutter | null }
  | { readonly kind: 'exposure'; readonly t: number; readonly state?: StampPaintFrameState; readonly lens: StampLensFrame; readonly exposure: StampPaintExposure };

/** A frame's groups as its shutter opens and closes, each group's travel between them gathered as its own motion. */
export type StampPaintShutter = { readonly open: StampPosedMoment; readonly close: StampPosedMoment };

/**
 * Exposure `index` of a reference frame's `count` (lens-mode.ts): its groups laid as at `at` in `state`, their paint
 * held at the frame's `t` (stampFramePlanExposed), seen from `aperture` (lens-exposures.ts). Exposures are drawn in
 * order; the last develops the frame.
 */
export type StampPaintExposure = { readonly index: number; readonly count: number; readonly at: number; readonly aperture: StampLensSourceExposure['aperture']; readonly state?: StampPaintFrameState };

export type StampPaintRenderer = {
  /** The stage it paints on: its targets' size, and the frame its output shows. */
  stage: StampStage;
  /** Draws `frame`. Resolves once WebGPU has checked the draw, or rejects with its error: hold the frame until then. */
  draw: (frame: StampPaintFrame) => Promise<void>;
  /** Resolves once the GPU has finished what's been drawn: for timing a draw, which a render never needs. */
  finish: () => Promise<void>;
  /**
   * Draws `frame` as `draw` does, recording each requested deposit's resolve stage by stage, read back once: for
   * diagnosing a brush against a capture, not for rendering. Throws on a deposit not in the painting or asked for twice.
   */
  trace: (frame: StampPaintFrame, requests: readonly StampDepositTraceRequest[]) => Promise<StampDepositTrace[]>;
  /**
   * Draws `frame` as `draw` does and reads back the layer its last group left, before that group dried into the
   * painting: for checking what the compositor laid (the GPU gate's pigment checks), not for rendering.
   */
  readLayer: (frame: StampPaintFrame) => Promise<StampLayerReadback>;
  /** Frees what the painting loaded; its surface stays for the next. */
  dispose: () => void;
  /**
   * The wet effects (a bloom, a backrun, a damp charge) that certainly won't act, a line each, worked out as it loaded
   * (stampWetReportWarnings): none for a painting without washes.
   */
  wetWarnings: readonly string[];
  /** How wet each wash deposit lands, worked out as it loaded, brushed masks measured; null for a painting in flat colour. */
  wetness: StampWetness | null;
};

/**
 * A group's layer as read back: `layers` of rgba16float, each `width` × `height` (the stage's), in `values` layer by
 * layer, row by row, four channels a texel. For pigment, layer 0's first channel is coverage and each other channel a pigment's amount.
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
  /** Times the load's parts, for `studio profile`. */
  profile?: FrameProfileStart | null;
  /** The wet stages its washes run: every one, but for a check measuring what some do. */
  wetStages?: readonly StampWetStage[];
  /**
   * The stage it paints on (stamp-stage.ts), its frame the surface's size: as far past the frame as a camera moving
   * the painting's planes may bring in. The frame alone, no margin, when left out.
   */
  stage?: StampStage;
  /**
   * The scene's planes as laid, farthest first: a painting camera's (buildPaintingCamera) or a check's
   * (stampScenePlanes); one plane of every group when left out (stampSinglePlane).
   */
  planes?: StampLaidPlanes;
  /** Each source plane's source by its id (stamp-lens-source.ts), rendered before each draw. */
  sources?: ReadonlyMap<string, StampLensSource>;
};

/** The most lattice cells a frame lays `group` through: a warp's most; a move's one, as is a still group's whose motion is traced. */
const latticeCellsMost = ({ warp }: StampGroupFrame) => (warp ? STAMP_WARP_MOST_CELLS ** 2 : 1);

/**
 * A renderer for one painting on `surface`, on its paper and mixed as its mixing says; `profile` times the load's parts. Refuses a
 * painting it can't mix. A frame may round a few pixels a level differently between draws (docs/private-styles.md,
 * "Same pixels"). No render fps reaches it: a boil counts animation frames (stampBoilEpoch).
 */
export async function createStampPaintRenderer(
  surface: StampPaintSurface, painting: CompiledStampPaint,
  { profile, wetStages = STAMP_WET_STAGES, stage: given, planes = stampSinglePlane(painting), sources = new Map() }: StampPaintRendererOptions = {},
): Promise<StampPaintRenderer> {
  const { paper, mixing } = painting;
  const { owner } = surface;
  const span = profile ?? (() => () => {});
  const stage = given ?? stampStage({ width: surface.width, height: surface.height });
  if (stage.frame.width !== surface.width || stage.frame.height !== surface.height) {
    throw new Error(`stamp paint: the stage's frame is ${stage.frame.width} × ${stage.frame.height}, and its surface ${surface.width} × ${surface.height}`);
  }
  checkStampLensSources(planes, sources, stage);
  let done = span('stamp paint compositor load');
  const { compositorOn, wetnessOf, mediumOf } = compositorFor(painting, paper, mixing, stage, wetStages);
  done();

  done = span('stamp paint images load');
  // Brushed masks' marks are drawn too, though they lay no paint.
  const brushedMasks = stampPaintingBrushedMasks(painting), maskMarks = brushedMasks.flatMap(({ marks }) => marks);
  const deposits = painting.groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass)));
  const assets = paintingImages([...deposits, ...maskMarks].map(({ brush }) => brush), paper);
  // The paper's photograph is the one image whose colour is read.
  const isPhotograph = (asset: StampBrushAsset) => !!paper.image && assetKey(asset) === assetKey(paper.image);
  const loaded = await owner.images(assets.map(([asset]) => ({ asset, channels: isPhotograph(asset) ? 'colour' : 'red' })));
  const images = new Map(assets.map(([asset], i) => [assetKey(asset), loaded[i]]));
  // A bristle tip's images are drawn for each diameter it's painted at, once a surface.
  const image = (source: StampBrushImageSource) => ('draw' in source ? owner.drawnImage(source.key, source.draw) : images.get(assetKey(source))!);
  const { bound, boundMarks } = await owner.checked('drawing the brushes\' bristle tips', () => ({
    bound: new Map(deposits.map((deposit) => [deposit, bindStampBrushImages(deposit.brush, deposit.diameter, image)] as const)),
    boundMarks: new Map(maskMarks.map((mark) => [mark, bindStampBrushImages(mark.brush, mark.diameter, image)] as const)),
  }));
  // Each tip's paint at every mip level, for its hulls.
  const tips = new Set([...bound.values(), ...boundMarks.values()].flatMap((brush) => (brush.dual ? [brush.tip.image, brush.dual.tip.image] : [brush.tip.image])));
  const tipLevels = new Map<StampPaintImage, StampTipLevel[]>(await Promise.all([...tips].map(async (tip) => [tip, await owner.tipLevels(tip)] as const)));
  done();

  const scope = owner.scope();
  try {
    const loading = owner.checked('loading the painting onto the GPU', () =>
      rendererOnSurface(
        surface, stage, scope, compositorOn, wetnessOf, mediumOf, painting, paper, image, bound, { masks: brushedMasks, bound: boundMarks }, tipLevels, wetStages, { planes, sources }, span,
      ));
    // The load itself ran within the call: what's left is WebGPU's check of it, and reading back what the brushed
    // masks cover, which the wetness is worked out with.
    done = span('stamp paint gpu check load');
    const { measured, finish } = await loading;
    const coverage = await measured;
    done();
    return await owner.checked('loading the painting\'s washes onto the GPU', () => finish(coverage));
  } catch (error) {
    scope.destroy();
    throw error;
  }
}

/**
 * How `mixing` composites `painting`, how wet a set of its groups' washes land, and the medium each group (by its
 * ID) paints in, worked out before anything is loaded, so a painting it can't mix fails first. Only pigment has
 * washes or media: the flat compositor refuses a wash, and a group naming a mixing of its own.
 */
function compositorFor(painting: CompiledStampPaint, paper: StampPaintPaper, mixing: StampPaintMixing, stage: StampStage, wetStages: readonly StampWetStage[]) {
  if (mixing.kind === 'pigment') {
    const paint = compileStampPigmentPaint(painting, mixing, PAINT_BANDS);
    const mediumOf = (group: Pick<CompiledStampGroup, 'id'>) => stampPigmentGroupMedium(paint, painting, group);
    const margin = (deposit: CompiledStampDeposit, medium: PaintMedium) => stampWetStageReach(wetStages, deposit, medium);
    const wetnessOf = (groups: CompiledStampPaint, brushed: StampBrushedCoverage) => compileStampWetness(groups, mediumOf, stage, margin, brushed);
    return { compositorOn: (device: StampPaintDevice) => stampPigmentCompositor(device, paint, paper.color), wetnessOf, mediumOf };
  }
  for (const { id, mixing: own } of painting.groups) {
    if (own) throw new Error(`stamp paint: group ${id} paints in ${own.medium.name}, but its style mixes in flat colour, which has no media; paint it in a pigment style`);
  }
  const flat = flatStampPaintCompositor(painting);
  return { compositorOn: () => flat, wetnessOf: null, mediumOf: null };
}

/**
 * Refuses a source plane without a source, a picture that isn't rgba16float to sample or doesn't cover the frame, and
 * a source for a plane that isn't a source plane.
 */
function checkStampLensSources(planes: StampLaidPlanes, sources: ReadonlyMap<string, StampLensSource>, { frame }: StampStage) {
  const sourcePlanes = new Set(planes.nearer.flatMap((plane) => (plane.kind === 'three' ? [plane.id] : [])));
  for (const id of sources.keys()) if (!sourcePlanes.has(id)) throw new Error(`stamp paint: a source is handed in for ${id}, which isn't a source plane`);
  for (const id of sourcePlanes) {
    const source = sources.get(id);
    if (!source) throw new Error(`stamp paint: source plane ${id} has no source handed in`);
    const { texture, motion, at } = source.picture;
    for (const [name, made] of [['texture', texture], ['motion', motion]] as const) {
      const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
      if (made.format !== 'rgba16float' || made.depthOrArrayLayers !== 1 || (made.usage & usage) !== usage || made.width !== texture.width || made.height !== texture.height) {
        throw new Error(`stamp paint: source plane ${id}'s ${name} must be rgba16float, one layer, the colour's size, with TEXTURE_BINDING and COPY_SRC usage`);
      }
    }
    if (!(Number.isInteger(at.x) && Number.isInteger(at.y) && at.x <= 0 && at.y <= 0 && at.x + texture.width >= frame.width && at.y + texture.height >= frame.height)) {
      throw new Error(`stamp paint: source plane ${id}'s picture, ${texture.width} × ${texture.height} at (${at.x}, ${at.y}), must cover the ${frame.width} × ${frame.height} frame from whole px`);
    }
  }
}

/**
 * The renderer for `painting`, made in `scope`, its targets `stage`-sized, in two steps, each within a surface check:
 * this loads all but the washes and draws the brushed masks; `finish` loads the washes once `measured`, what they
 * cover, is read back. A Box is in stage texels (a painting point plus the margin), a region's in painting points.
 */
function rendererOnSurface(
  surface: StampPaintSurface, stage: StampStage, scope: StampPaintGpuScope, compositorOn: (device: StampPaintDevice) => StampPaintCompositor,
  wetnessOf: ((groups: CompiledStampPaint, brushed: StampBrushedCoverage) => StampWetness) | null, mediumOf: ((group: Pick<CompiledStampGroup, 'id'>) => PaintMedium) | null,
  painting: CompiledStampPaint, paper: StampPaintPaper, image: (source: StampBrushImageSource) => StampPaintImage, bound: ReadonlyMap<CompiledStampDeposit, StampBrush<StampPaintImage>>,
  brushed: { masks: readonly CompiledStampBrushedMask[]; bound: ReadonlyMap<CompiledStampMarkPlacement, StampBrush<StampPaintImage>> },
  tipLevels: ReadonlyMap<StampPaintImage, StampTipLevel[]>, wetStages: readonly StampWetStage[],
  { planes, sources }: { planes: StampLaidPlanes; sources: ReadonlyMap<string, StampLensSource> },
  span: FrameProfileStart,
): { measured: Promise<StampBrushedCoverage>; finish: (coverage: StampBrushedCoverage) => StampPaintRenderer } {
  const { width, height, frame, margin } = stage, { format, owner } = surface, { device } = scope;
  let done = span('stamp paint compositor gpu load');
  const compositor = compositorOn(device);
  const paintBytes = compositor.deposit.layout.words * 4;
  if (paintBytes > SLOT) throw new Error(`stamp paint: a compositor's ${compositor.deposit.layout.name} takes ${paintBytes} bytes, over a uniform slot's ${SLOT}`);
  done();

  /** The hull `layer`'s tip is drawn in, for the coarsest level its smallest or most blurred stamp reads. */
  function tipHull(layer: BoundLayer, stamps: FrozenStampMarks): StampTipHull {
    const marks = stampMarksExtremes(stamps);
    // The tip's texels spread over its span, so its pixels per texel go by the image's width, not the diameter.
    const smallest = marks.smallest * spanOf(layer);
    const blurred = Math.ceil(marks.blurred * STAMP_BLUR_LEVELS);
    const levels = tipLevels.get(layer.tip.image)!;
    const squashed = layer.tip.roundness * (levels[0].height / levels[0].width) * marks.roundest;
    const coarsest = Math.min(levels.length - 1, coarsestStampTipLevel(levels[0], smallest, squashed, levels.length) + blurred);
    return owner.tipHull(layer.tip.image, coarsest);
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
  // Each group's lays (on paper or white and, on a clear plane, on black), glow occlusion and source; each plane's and
  // the bloom's.
  const frameSlots = (1 + planes.nearer.length) * PLANE_SLOTS + BLOOM_SLOTS + painting.groups.reduce((sum, group) => sum + 4 + group.passes.reduce((n, pass) => n + stampPassDeposits(pass).length * depositSlots(pass.kind === 'wash'), 0), 0);
  // Drawing the brushed masks at load takes the same slots, four a mark: its stamps and dual's, its cover's two.
  const slotsPerFrame = Math.max(frameSlots, 4 * brushed.masks.reduce((sum, { marks }) => sum + marks.length, 0));
  const tilesX = Math.ceil(width / STAMP_ORDERED_TILE), tilesY = Math.ceil(height / STAMP_ORDERED_TILE);
  const asWritten = new Map(painting.groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass).map((deposit) => [deposit.id, deposit] as const))));
  // Each deposit's medium by its ID, its group's as written (an epoch's and live marks' alike); none in flat colour.
  const depositMedia = new Map(painting.groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass).map((deposit) => [deposit.id, mediumOf?.(group) ?? null] as const))));
  const mediumOfDeposit = (deposit: CompiledStampDeposit): PaintMedium | null => depositMedia.get(deposit.id) ?? null;

  /** How a layer's stamps are laid, an `ordered` one's bins appended to `binData`. */
  const planLoader = (binData: number[]) => (layer: BoundLayer, stamps: FrozenStampMarks): LoadedPlan => {
    const plan = stampMarksPlan(stamps, layer.accumulation);
    return plan.kind === 'ordered' ? { kind: 'ordered', bins: stampBinsAppended(stampMarksOrderedBins(stamps, reachSpanOf(layer), tilesX, tilesY, margin), binData) } : plan;
  };

  /**
   * `groups`' deposits on the GPU, and what they're drawn with. A boil epoch (epochOf) lands as the deposits as
   * written do, wet where the author's stroke wets it; live marks (liveOf) load their own wetness, regions and wet
   * stages, as their pose lands. Either is scoped, destroyed as it's given up or the painting disposed.
   */
  function loadBank(groups: readonly CompiledStampGroup[], source: BankSource): DepositBank {
    const bankScope = source.kind === 'written' ? null : owner.scope(), on = bankScope?.device ?? device;
    const binData: number[] = [];
    const loadPlan = planLoader(binData);
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
    for (const { deposit, main, dual, tint } of placed) {
      const grainDepthSource = stampGrainDepthSourceIn(mediumOfDeposit(deposit));
      stampData.set(stampInstanceFloats(deposit.stamps, grainDepthSource), main * STAMP_FLOATS);
      stampData.set(stampInstanceFloats(deposit.dualStamps, grainDepthSource), dual * STAMP_FLOATS);
      if (tint !== null) tintData.set(stampTintFloats(deposit.stamps), tint * TINT_FLOATS);
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
        mainHull: tipHull(brush, deposit.stamps), dualHull: brush.dual ? tipHull(brush.dual, deposit.dualStamps) : null,
        mainPlan, dualPlan, resolveOrder: stampResolveOrderIndex(STAMP_RESOLVE_PLANS[stampResolvePlan(brush.dual)]),
        stampBuffer, tintBuffer, binBuffer, landing: washLanding(identity, staged, wetness), wetFirst: home.grids.firsts.get(staged) ?? null,
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
    return wetnessOf?.({ ...painting, groups }, writtenBank.wetness?.brushed ?? new Map()) ?? null;
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
        device: on, painting: { ...painting, groups }, wetness, stage, layer: targets.layer, wash: stageWash!,
        footprint: targets.footprint!, fresh: targets.fresh!, grids, paperDepth: paper.grain?.depth ?? 0,
      };
      for (const wetStage of wetStages) {
        stages.push(wetStage.after === 'deposit' ? { after: 'deposit', running: wetStage.load(wetContext) } : { after: 'drying', running: wetStage.load(wetContext) });
      }
    }
    loaded();
    const dryingsByLast = new Map([...wetness?.washes.values() ?? []].flatMap((record) => record.dryings).map((drying) => [drying.deposits.at(-1)!, drying]));
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
  // Every deposit of a wash lands (StampWetness's landings), which only its wetness, worked out in `finish`, says how.
  const washes = painting.groups.some((group) => group.passes.some((pass) => pass.kind === 'wash' && stampPassDeposits(pass).length));
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
  const slot = (fill: (views: GpuUniformViews) => void): GPUBufferBinding => {
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
  const stampModule = device.createShaderModule({ code: stampWgsl(stage) });
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
  const orderedModule = device.createShaderModule({ code: orderedWgsl(stage) });
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
  const depositModules = { dry: device.createShaderModule({ code: depositWgsl(compositor, false, stage) }), wet: compositor.deposit.wet ? device.createShaderModule({ code: depositWgsl(compositor, true, stage) }) : null };
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
  const pipelines = { blur: computePipeline(gpuGaussianPassWgsl({ layers: 1, read: 'bilinear', workgroup: WORKGROUP })), group: computePipeline(groupWgsl(compositor, false, stage)), paper: computePipeline(paperWgsl(compositor, stage)) };
  /**
   * What laying a group through a lattice takes, made the first time a frame moves or warps one: its pipelines, and
   * each scene pixel's rest point.
   */
  type LatticeLay = { movedGroupPipeline: GPUComputePipeline; pipeline: (traced: StampMotionCover | null) => GPURenderPipeline; rest: ReturnType<typeof target> };
  let latticeLay: LatticeLay | null = null;
  const latticeLayOf = (): LatticeLay => {
    if (latticeLay) return latticeLay;
    const latticePipelines = new Map<StampMotionCover | null, GPURenderPipeline>();
    const latticePipeline = (traced: StampMotionCover | null) => {
      const module = device.createShaderModule({ code: groupLatticeWgsl(compositor.targets.layer, stage, traced) });
      const attributes: GPUVertexAttribute[] = [0, 1, 2].map((shaderLocation) => ({ shaderLocation, offset: shaderLocation * 8, format: 'float32x2' }));
      const rest: GPUColorTargetState[] = traced === 'region' ? [] : [{ format: 'rg32float' }];
      return device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, buffers: [{ arrayStride: LATTICE_VERTEX_FLOATS * 4, attributes }] },
        fragment: { module, targets: [...rest, ...(traced ? [{ format: 'rgba16float' as const }] : [])] },
      });
    };
    latticeLay = {
      movedGroupPipeline: computePipeline(groupWgsl(compositor, true, stage)),
      pipeline: (traced) => {
        if (!latticePipelines.has(traced)) latticePipelines.set(traced, latticePipeline(traced));
        return latticePipelines.get(traced)!;
      },
      rest: target('rest', width, height, GPUTextureUsage.RENDER_ATTACHMENT, 'rg32float'),
    };
    return latticeLay;
  };
  /** How many times a frame may lay each group: twice on a clear plane, on its paper and on black. */
  const laysOf = painting.groups.map((_, index) => (planes.nearer.some((plane) => plane.kind === 'picture' && plane.groups.includes(index)) ? 2 : 1));
  /**
   * Room for a frame laying `groups` through lattices, each lay: a moved group's one cell, a warped group's most, and
   * a still group's one when its plane's motion is traced.
   */
  const latticeRoom = (groups: readonly StampGroupFrame[]) => {
    const floats = groups.reduce((sum, group, index) => sum + 6 * LATTICE_VERTEX_FLOATS * latticeCellsMost(group) * laysOf[index], 0);
    if (floats <= latticeStaging.length) return;
    latticeStaging = new Float32Array(floats);
    // Destroyed once the frames that drew from it are done.
    latticeVertices?.destroy();
    latticeVertices = device.createBuffer({ size: floats * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  };
  depositPipeline(false, false);
  if (washes) {
    if (!compositor.deposit.wet) throw new Error('stamp paint: the painting has washes, and its compositor lays none');
    depositPipeline(false, true);
  }
  const dithered = format.endsWith('8unorm');
  const outputPipeline = (() => {
    const module = device.createShaderModule({ code: outputWgsl(compositor, dithered, stage) });
    return device.createRenderPipeline({ layout: 'auto', vertex: { module }, fragment: { module, targets: [{ format }] } });
  })();
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
  // Targets are the owner's, shared with every painting drawn on its device: a frame overwrites all it reads of them.
  const target = (name: string, w: number, h: number, usage: number, targetFormat: GPUTextureFormat = 'rgba16float') => {
    const texture = owner.target(name, { size: [w, h], format: targetFormat, usage: usage | GPUTextureUsage.TEXTURE_BINDING });
    return { texture, view: texture.createView(), layers: [texture.createView()] };
  };
  /** A compositor's target, an array's layers each cleared through a view of its own. */
  const layered = (name: string, shape: StampPaintTarget, usage: number) => {
    if (shape.kind === 'plain') return target(name, width, height, usage);
    const texture = owner.target(name, { size: [width, height, shape.layers], format: 'rgba16float', usage: usage | GPUTextureUsage.TEXTURE_BINDING });
    return {
      texture, view: texture.createView({ dimension: '2d-array' }),
      layers: Array.from({ length: shape.layers }, (_, layer) => texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 })),
    };
  };
  const RENDER = GPUTextureUsage.RENDER_ATTACHMENT, STORAGE = GPUTextureUsage.STORAGE_BINDING;
  // What a film is copied out of and back into.
  const SAVED = GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
  const halfW = Math.ceil(width / 2), halfH = Math.ceil(height / 2);
  const laysTints = compositor.readsStampTints && painting.groups.some((group) => group.passes.some((pass) => stampPassDeposits(pass).some((deposit) => deposit.brush.color)));
  const targets = {
    painting: layered('painting', compositor.targets.painting, STORAGE | SAVED),
    // Kept as films, and copied out by readLayer for the GPU gate's pigment checks.
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
    footprint: washes ? target('footprint', width, height, STORAGE) : null,
    fresh: washes ? layered('fresh', compositor.targets.layer, STORAGE) : null,
  };

  // The gaussian binds arrays; the mask's targets are plain.
  const maskArrays = { mask: arrayView(targets.mask.texture), blurA: arrayView(targets.blurA.texture), blurB: arrayView(targets.blurB.texture) };

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
   * How far past its stamps' reach a deposit resolves: its edges' blur, and for one the wash law lays its stages'
   * reach and two lattice cells more, so the box holds every pixel whose settled paint its landing would leave unzeroed.
   */
  const depositPad = (loadedDeposit: LoadedDeposit) => {
    const sigma = loadedDeposit.active.edgeSigma;
    // Only a wash's deposits land, each in its group's medium.
    const { landing, identity } = loadedDeposit;
    return (sigma > 0 ? sigma * 3 : 2) + (landing ? stampWetStageReach(wetStages, identity, landing.medium) + 2 * STAMP_WET_CELL : 0);
  };
  /** Readies every stage `bank` draws with for each of `groups`' wash deposits' whole boxes (StampLoadedWetStage.reserve). */
  const reserveWashBoxes = (groups: readonly CompiledStampGroup[], bank: DepositBank) => {
    for (const pass of groups.flatMap((group) => group.passes)) {
      for (const deposit of stampPassDeposits(pass)) {
        const loadedDeposit = bank.deposits.get(deposit)!;
        if (!loadedDeposit.landing) continue;
        const box = depositBox(deposit, loadedDeposit, depositPad(loadedDeposit));
        if (box) for (const { running } of bank.home.stages) running.reserve?.(box);
      }
    }
  };
  // A wet stage asks the compositor about the deposits it knows; live marks' own are painted as the deposit as written.
  const stageWash: StampWashLayer | undefined = compositor.wash && {
    ...compositor.wash,
    layersOf: (deposit) => compositor.wash!.layersOf(asWritten.get(deposit.id)!),
    movedWgsl: (deposit) => compositor.wash!.movedWgsl(asWritten.get(deposit.id)!),
    holdWgsl: (deposit) => compositor.wash!.holdWgsl(asWritten.get(deposit.id)!),
  };
  done();
  // The painting's deposits as written, loaded by `finish` once the brushed masks are measured.
  let writtenBank: DepositBank;

  /**
   * Works out, once a bank, what of `groups` doesn't change with time: each flood's body, each state of the fluid a
   * deposit lands under, and each deposit's `within`, as cropped textures made through `on` (none for an empty
   * state). All are planned against STAMP_REGION_BUDGET, refused past it before any is made.
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
    const opWords: { floats: number[]; words: number[]; inset: number; boundaries: [number, number] }[] = [];
    // A within's treated stretches, each a vec4f: its path's first point and count in `points`, merge or feather, reach.
    const boundaryFloats: number[] = [];
    const boundariesOf = (area: CompiledStampArea | null): [number, number] => {
      const treated = area?.boundaries ?? [], first = boundaryFloats.length / 4;
      for (const { path, treatment, reach } of treated) boundaryFloats.push(...pointsOf(path), treatment === 'merge' ? 1 : 0, reach);
      return [first, treated.length];
    };
    type Step = { box: Box; draw: (views: GpuUniformViews) => GPURenderPipeline; parent?: Step | null; source?: RegionTexture | null; grid?: boolean };
    const steps: Step[] = [];
    // A region's box is in painting points, held to the stage.
    const inPainting = (box: StampBox): Box | null => {
      const x = Math.max(-margin, Math.floor(box.x0)), y = Math.max(-margin, Math.floor(box.y0));
      const w = Math.min(frame.width + margin, Math.ceil(box.x1)) - x, h = Math.min(frame.height + margin, Math.ceil(box.y1)) - y;
      return w > 0 && h > 0 ? { x, y, w, h } : null;
    };
    /** An op of the fluid, over its area or everywhere, or a brushed mask's coverage (`source`), as a MaskOp; its index. */
    const opOf = (kind: 'mask' | 'unmask' | 'clip' | 'source', amount: number, area: CompiledStampArea | null) => {
      const [first, count] = area ? pointsOf(area.polygon) : [0, 0], reach = area ? stampAreaBox(area) : null, ragged = area?.edge?.ragged;
      opWords.push({
        floats: [reach?.x0 ?? 0, reach?.y0 ?? 0, reach?.x1 ?? 0, reach?.y1 ?? 0, ragged?.amount ?? 0, ragged?.scale ?? 0, stampEdgeWidth(area?.edge), amount],
        words: [first, count, { mask: 0, unmask: 1, clip: 2, source: 3 }[kind], area?.seed ?? 0],
        inset: area?.inset ?? 0,
        boundaries: boundariesOf(area),
      });
      return opWords.length - 1;
    };
    /** A step drawing `opCount` ops from `firstOp` over `box`, on `parent`'s state, a `source` op reading `source`. */
    const maskStep = (box: Box, parent: Step | null, firstOp: number, opCount: number, source: RegionTexture | null = null): Step => ({
      box, parent, source,
      draw: (views) => {
        const put = gpuUniformWriter(MASK_STEP, views);
        put('box', boxWords(box));
        put('parent', boxWords(parent?.box));
        put('source', boxWords(source?.box));
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
          const put = gpuUniformWriter(FLOOD_BODY, views);
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
    // in one step, so a run of masks costs one texture; a step reads one brushed mask, so a run is cut after each. A
    // state covers the one it's built on and each mask's reach.
    const read = new Set(all.flatMap((deposit) => (deposit.mask ? [deposit.mask] : [])));
    const fluids = new Map<CompiledStampMask, Step | null>();
    const brushedRegion = (mask: CompiledStampBrushedMask) => {
      const region = brushedMasks.textures.get(mask);
      if (region === undefined) throw new Error(`stamp paint: ${mask.id} is brushed on under marks the painting didn't load with; brush masks outside live marks`);
      return region;
    };
    /** A step drawing `run` on `parent`'s state; a brushed mask off the painting masks nothing. */
    const runStep = (run: readonly CompiledStampMask[], parent: Step | null): Step | null => {
      let box = parent?.box ?? null, source: RegionTexture | null = null;
      for (const op of run) {
        if (op.kind === 'mask') box = unionOf(box, inPainting(stampAreaBox(op.area)));
        if (op.kind === 'brushed') source = brushedRegion(op.brushed);
      }
      box = unionOf(box, source?.box ?? null);
      const ops = run.filter((op) => op.kind !== 'brushed' || source);
      const step = box && maskStep(box, parent, opWords.length, ops.length, source);
      if (step) {
        for (const op of ops) {
          if (op.kind === 'brushed') opOf('source', 1, null);
          else opOf(op.kind, op.kind === 'mask' ? 1 : op.amount, op.area);
        }
        steps.push(step);
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

    // A deposit's `within` is a state of its own on no fluid: its pass's area, clipped to each of its applications'.
    // Deposits of a pass under the same applications share it.
    const withins = new Map<CompiledStampDeposit, Step | null>();
    for (const pass of passes) {
      const shared = new Map<CompiledStampDeposit['within'], Step | null>();
      for (const deposit of stampPassDeposits(pass)) {
        const areas = [...(pass.within ? [pass.within] : []), ...(deposit.within ?? [])];
        if (!areas.length) continue;
        if (!shared.has(deposit.within)) {
          const box = inPainting(stampAreaBox(areas[0]));
          const step = box && maskStep(box, null, opWords.length, areas.length);
          if (step) {
            areas.forEach((area, i) => opOf(i ? 'clip' : 'mask', 1, area));
            steps.push(step);
          }
          shared.set(deposit.within, step);
        }
        withins.set(deposit, shared.get(deposit.within)!);
      }
    }

    const bytes = steps.reduce((sum, { box }) => sum + box.w * box.h * STAMP_REGION_TEXEL_BYTES, 0);
    if (bytes > STAMP_REGION_BUDGET) {
      throw new Error(`stamp paint: the painting's fills, masking fluid and within regions need ${Math.round(bytes / 2 ** 20)} MB, over ${STAMP_REGION_BUDGET / 2 ** 20} MB: ${bodies.size} fill bodies, ${[...fluids.values()].filter(Boolean).length} states of the fluid, ${new Set(withins.values()).size} within regions; share masks between deposits or crop them`);
    }
    const made = new Map(steps.map((step): [Step, RegionTexture] => {
      const texture = on.createTexture({ size: [step.box.w, step.box.h], format: STAMP_REGION_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      return [step, { view: texture.createView(), box: step.box }];
    }));
    if (steps.length) {
      const opBytes = new ArrayBuffer(Math.max(1, opWords.length) * MASK_OP_WORDS * 4), opFloats = new Float32Array(opBytes), opInts = new Uint32Array(opBytes);
      opWords.forEach(({ floats, words, inset, boundaries }, i) => {
        opFloats.set(floats, i * MASK_OP_WORDS);
        opInts.set(words, i * MASK_OP_WORDS + floats.length);
        opFloats[i * MASK_OP_WORDS + floats.length + words.length] = inset;
        opInts.set(boundaries, i * MASK_OP_WORDS + floats.length + words.length + 1);
      });
      const pointBuffer = buffer(new Float32Array(points.length ? points : [0, 0]), GPUBufferUsage.STORAGE, on), gridBuffer = buffer(new Float32Array(grids.length ? grids : [0]), GPUBufferUsage.STORAGE, on);
      const opBuffer = buffer(opFloats, GPUBufferUsage.STORAGE, on), boundaryBuffer = buffer(new Float32Array(boundaryFloats.length ? boundaryFloats : [0, 0, 0, 0]), GPUBufferUsage.STORAGE, on);
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
          : [
            { buffer: uniformBuffer, offset: i * SLOT, size: SLOT }, { buffer: pointBuffer }, step.parent ? made.get(step.parent)!.view : targets.blank.view, { buffer: opBuffer },
            { buffer: boundaryBuffer }, step.source?.view ?? targets.blank.view,
          ]));
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
  const canvasGrainAt = (views: GpuUniformViews, at: number, layer: StampActiveLayer<StampPaintImage> | undefined, offset: readonly [number, number]) => {
    const grain = layer?.canvasGrain;
    if (!grain) return;
    const size = grain.scale * layer.diameter;
    writeGrain(views, at, grain, [size, size * (grain.image.height / grain.image.width)], offset, grainLod(grain.image, size));
  };

  /** What drawing `layer`'s stamps binds, the main brush's (`stampChannel` 0) or its dual's. */
  const stampInputs = (grainOffset: GrainOffset, layer: BoundLayer, active: StampActiveLayer<StampPaintImage>, stampChannel: 0 | 1) => {
    const { rollingGrain: rolling, diameter } = active;
    const { pressed } = layer.tip;
    const center: [number, number] = [layer.tip.center?.[0] ?? 0.5, layer.tip.center?.[1] ?? 0.5];
    const pressedWords: [number, number, number, number] = pressed ? [pressed.softness, ...pressed.range, pressed.diameter ?? 0] : [0, 0, 0, 0];
    return {
      rolling, diameter, offset: grainOffset[stampChannel === 0 ? 'main' : 'dual'], center, pressedWords,
      textures: [layer.tip.image.view, rolling ? rolling.image.view : targets.blank.view, layer.tip.sampling === 'anisotropic' ? anisotropicClamp : linearClamp, rolling?.tiling === 'mirror' ? mirrorTile : tile],
      contact: pressed ? pressed.contact.view : targets.blank.view,
    };
  };
  /** The fixed path's bindings (STAMP_WGSL) for `layer`'s stamps, each laid toward full or its opacity. */
  const fixedStampResources = (grainOffset: GrainOffset, layer: BoundLayer, active: StampActiveLayer<StampPaintImage>, hull: StampTipHull, stampChannel: 0 | 1, towardFull: boolean) => {
    const { rolling, diameter, offset, textures, center, contact, pressedWords } = stampInputs(grainOffset, layer, active, stampChannel);
    return [
      slot((views) => {
        const put = gpuUniformWriter(STAMP_DRAW, views);
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
      /** Lays the deposit's stamps' pressure in `box`. */
      draw(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, loadedDeposit: LoadedDeposit, box: Box) {
        const count = deposit.stamps.length;
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
        pass.setScissorRect(box.x, box.y, box.w, box.h);
        if (count) {
          pass.setIndexBuffer(fanBuffer, 'uint16');
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup(pipeline, fixedStampResources(deposit.grainOffset, loadedDeposit.brush, loadedDeposit.active.main, loadedDeposit.mainHull, 0, true)));
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
    const reach = tooth ? (texels * tooth.scale * frame.width) / image(tooth.image).width : 0, pad = Math.ceil(reach);
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

  /**
   * Lays `placed`'s stamps and dual stamps, loaded as `marks`, into the mask and cap (and a tinted pass's tints)
   * within `box`, then a flood's `body` over them.
   */
  function drawStamps(encoder: GPUCommandEncoder, marks: LoadedMarks, placed: StampPlacedMarks, box: Box, body: { region: RegionTexture; flood: CompiledStampFlood } | null) {
    const tinted = marks.tint !== null;
    const pass = encoder.beginRenderPass({
      colorAttachments: [targets.mask, targets.cap, ...(tinted ? [targets.tintA!, targets.tintB!] : [])].map(({ view }) => ({ view, loadOp: 'clear' as const, storeOp: 'store' as const })),
    });
    pass.setScissorRect(box.x, box.y, box.w, box.h);
    pass.setIndexBuffer(fanBuffer, 'uint16');
    const stamp = (layer: BoundLayer, active: StampActiveLayer<StampPaintImage>, plan: LoadedPlan, first: number, n: number, hull: StampTipHull, stampChannel: 0 | 1) => {
      if (!n) return;
      const { rolling, diameter, offset, textures, center, contact, pressedWords } = stampInputs(placed.grainOffset, layer, active, stampChannel);
      const tintBinding = stampChannel === 0 && tinted ? { buffer: marks.tintBuffer, at: marks.tint! } : { buffer: noTintBuffer, at: 0 };
      if (plan.kind === 'ordered') {
        // Only this layer's stamps and tints are bound, so no painting's whole buffer meets the storage binding limit.
        const stampSlice = storageSlice(marks.stampBuffer, first, n, STAMP_FLOATS), tintSlice = storageSlice(tintBinding.buffer, tintBinding.at, tinted ? n : 1, TINT_FLOATS);
        const pipeline = orderedPipelines[tinted ? 'tinted' : 'plain'][stampChannel];
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup(pipeline, [
          slot((views) => {
            const put = gpuUniformWriter(ORDERED_DRAW, views);
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
          ...textures, stampSlice.binding, tintSlice.binding, { buffer: marks.binBuffer }, contact,
        ]));
        pass.draw(3);
        return;
      }
      const pipeline = stampPipelines[STAMP_ACCUMULATIONS[layer.accumulation.kind].keepsCap ? 'glaze' : 'build'][tinted ? 'tinted' : 'plain'][stampChannel];
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup(pipeline, fixedStampResources(placed.grainOffset, layer, active, hull, stampChannel, plan.toward === 'full')));
      pass.setVertexBuffer(0, marks.stampBuffer, first * STAMP_FLOATS * 4);
      pass.setVertexBuffer(1, tintBinding.buffer, tintBinding.at * TINT_FLOATS * 4);
      pass.drawIndexed((hull.length / 2 - 2) * 3, n);
    };
    stamp(marks.brush, marks.active.main, marks.mainPlan, marks.main, placed.stamps.length, marks.mainHull, 0);
    if (marks.brush.dual && marks.active.dual && marks.dualPlan) stamp(marks.brush.dual, marks.active.dual, marks.dualPlan, marks.dual, placed.dualStamps.length, marks.dualHull!, 1);
    // A flood's body joins the build its edge stamps laid, before any rim blurs it, so rims see the whole flood.
    if (body) {
      const { kind } = marks.brush.accumulation, { towardFull, keepsCap } = STAMP_ACCUMULATIONS[kind];
      const pipeline = bodyPipeline(towardFull, keepsCap, tinted);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup(pipeline, [slot((views) => {
        const put = gpuUniformWriter(BODY_DRAW, views);
        put('box', texelBoxWords(body.region.box));
        const { levels, tint } = body.flood;
        put('tint', [tint.hue, tint.saturation, tint.lightness, tint.secondary]);
        put('levels', [levels.built, levels.densest]);
      }), body.region.view]));
      pass.draw(3);
    }
    pass.end();
  }

  function blurMask(encoder: GPUCommandEncoder, sigma: number, box: Box) {
    const halfSigma = Math.max(0.5, sigma / 2);
    const half = stampBlurRegion(box, halfW, halfH);
    // Reached as the GPU would work it out in f32, so the taps match the mask-edge goldens'.
    const taps = Math.min(40, Math.ceil(Math.fround(Math.fround(halfSigma) * 2.5)));
    // The across pass also covers the rows the down pass reaches past the box: blurA outside them holds whatever an
    // earlier deposit or frame left, which would make a frame depend on what was drawn before it.
    const reach = taps + 1;
    const top = Math.max(0, half.y - reach);
    const across = { ...half, y: top, h: half.h + (half.y - top) + reach };
    const blur = (source: GPUTextureView, into: GPUTextureView, axis: 0 | 1, stride: number, region: typeof half) => dispatch(encoder, pipelines.blur, [
      slot((views) => {
        const put = gpuUniformWriter(GPU_GAUSSIAN_PASS, views);
        put('sigma', halfSigma);
        put('reach', taps);
        put('axis', axis);
        put('stride', stride);
        put('box', [region.x, region.y, region.w, region.h]);
      }),
      source, into, linearClamp,
    ], region.w, region.h);
    // Sampling the full-size mask at half size, at a texel's corner, averages four pixels: a box before the blur.
    blur(maskArrays.mask, maskArrays.blurA, 0, 2, across);
    blur(maskArrays.blurA, maskArrays.blurB, 1, 1, half);
  }

  // The paper's tooth's tile in pixels and the mip level it's read at.
  const paperTile = ((tooth) => {
    if (!tooth) return [1, 1, 0];
    // The tooth's size goes by the frame, so a margin leaves it as it was.
    const grain = image(tooth.image), size = tooth.scale * frame.width;
    return [size, size * (grain.height / grain.width), grainLod(grain, size)];
  })(paper.grain);
  /** What of DEPOSIT_FLAGS `marks`' own coverage resolves with: its grains, dual and pooling, and the paper's tooth. */
  const coverageFlags = ({ brush, active }: LoadedMarks): (keyof typeof DEPOSIT_FLAGS)[] => [
    ...(active.main.canvasGrain ? ['canvasGrain' as const] : []), ...(brush.dual ? ['dual' as const] : []), ...(active.dual?.canvasGrain ? ['dualCanvasGrain' as const] : []),
    ...(paper.grain ? ['paper' as const] : []),
    ...(active.main.pooling ? ['pooled' as const] : []), ...(active.dual?.pooling ? ['dualPooled' as const] : []),
    ...(brush.dual?.blend.family === 'layer' ? ['dualLayer' as const] : []),
  ];
  /**
   * Writes into a Deposit what `marks`' coverage resolves with, in `resolveOrder`: the view and paper, its grains at
   * `grainOffset`, its dual's blend, its accumulations and pooling (a pooled peak at its body's where `washRims`).
   * Returns the writer, for the rest.
   */
  const writeCoverage = (views: GpuUniformViews, { brush, active }: LoadedMarks, grainOffset: GrainOffset, resolveOrder: number, washRims: boolean) => {
    const put = gpuUniformWriter(DEPOSIT, views);
    put('view', [width, height, paperTile[0], paperTile[1]]);
    canvasGrainAt(views, DEPOSIT.at.grain, active.main, grainOffset.main);
    canvasGrainAt(views, DEPOSIT.at.dualGrain, active.dual, grainOffset.dual);
    put('paperDepth', paper.grain?.depth ?? 0);
    put('paperLod', paperTile[2]);
    put('dualBlend', brush.dual ? stampDualModeIndex(brush.dual.blend) : 0);
    put('resolveOrder', resolveOrder);
    // A layer that isn't there reads its build as none, as a `build` accumulation, whatever it resolves to.
    const accumulations = [brush.accumulation, brush.dual?.accumulation ?? { kind: 'build' as const }];
    put('build', [stampAccumulationBuild(accumulations[0]), stampAccumulationBuild(accumulations[1])]);
    put('accumulation', [stampAccumulationIndex(accumulations[0].kind), stampAccumulationIndex(accumulations[1].kind)]);
    const { pooling } = active.main, dualPooling = active.dual?.pooling;
    const peakOf = (edges?: { peak: number; body: number }) => (washRims ? edges?.body : edges?.peak) ?? 0;
    put('pooling', [peakOf(pooling), pooling?.body ?? 0, peakOf(dualPooling), dualPooling?.body ?? 0]);
    return put;
  };

  /**
   * `pass`: the pass as `loadedDeposit`'s bank's regions know it (LoadedDeposit's `staged`). Its paint is read at
   * `paintAt`, the frame state's, which a recipe's keyed paint holds to its keys' span.
   */
  function resolveDeposit(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, loadedDeposit: LoadedDeposit, pass: CompiledStampPass, paintAt: number, blurred: boolean, box: Box, frameTrace?: FrameTrace) {
    const trace = frameTrace?.deposits.get(loadedDeposit.identity), { regions, stages } = loadedDeposit.home;
    const clipped = !!pass.clipTo, fluid = deposit.mask ? regions.fluids.get(deposit.mask) ?? null : null;
    // A deposit within a region wholly off the painting lands nowhere: its `within` is an empty texture, read as none.
    const within = regions.withins.get(deposit) ?? null, isWithin = !!pass.within || !!deposit.within;
    const { brush, active, landing } = loadedDeposit;
    // Where a stage rims the deposit's drying (the drying rim, stamp-wet-rim.ts), a brush's own wet edges would rim
    // each stroke again. Its Procreate rim goes, and Photoshop's pooling keeps its body, not its peak.
    const washRims = !!landing && stages.some(({ running }) => running.ownsWetEdges?.(loadedDeposit.staged));
    const edgesOf = (layer?: StampActiveLayer<StampPaintImage>): [number, number, number, number] => (blurred && layer
      ? [washRims ? 0 : layer.rim?.rim ?? 0, layer.rim?.sharpness ?? 0, layer.burntEdge?.strength ?? 0, layer.burntEdge?.sharpness ?? 0] : [0, 0, 0, 0]);
    const mainGrain = active.main.canvasGrain, dualGrain = active.dual?.canvasGrain;
    const tooth = paper.grain;
    const tinted = loadedDeposit.tint !== null;
    const flags: (keyof typeof DEPOSIT_FLAGS)[] = [
      ...coverageFlags(loadedDeposit), ...(fluid ? ['masked' as const] : []), ...(isWithin ? ['within' as const] : []),
      ...(deposit.kind === 'flood' ? ['flood' as const] : []),
      ...(deposit.kind === 'flood' && !landing && stampFloodCarriesWater(brush, mediumOfDeposit(deposit)) ? ['floodWater' as const] : []),
      // Only paint makes a clip base: water and a lift leave where a pass holds paint as it was.
      ...(clipped ? ['clipped' as const] : []), ...(!clipped && deposit.action.kind === 'paint' ? ['clips' as const] : []),
    ];
    dispatch(encoder, depositPipeline(!!trace, !!landing), [
      slot((views) => {
        const put = writeCoverage(views, loadedDeposit, deposit.grainOffset, trace?.order ?? loadedDeposit.resolveOrder, washRims);
        put('edges', edgesOf(active.main));
        put('dualEdges', edgesOf(active.dual));
        put('opacity', deposit.opacity);
        put('flags', flags.reduce((all, flag) => all | DEPOSIT_FLAGS[flag], 0));
        put('origin', [box.x, box.y]);
        put('extent', [box.w, box.h]);
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
        const put = gpuUniformWriter(TRACE_CROP, views);
        const { crop } = trace.request;
        put('origin', [crop.x + margin, crop.y + margin]);
        put('extent', [crop.w, crop.h]);
        put('offset', trace.offset);
      }) : { buffer: noTraceCrop },
      targets.cap.view, mirrorTile,
      slot((views) => {
        const put = gpuUniformWriter(KEEP, views);
        put('fluid', texelBoxWords(fluid?.box));
        put('within', texelBoxWords(within?.box));
        put('bodyReach', WET_BODY_REACH * deposit.diameter);
        if (deposit.kind !== 'flood') return;
        const ends = stampPaintFieldEnds(deposit.flood.load);
        put('load', ends.geometry);
        put('loadEnds', [ends.first, ends.second]);
        put('loadKind', ends.kind);
        put('bodyLevels', [deposit.flood.levels.built, deposit.flood.levels.densest]);
      }),
      within?.view ?? targets.blank.view,
      slot((views) => loadedDeposit.writePaint(views, paintAt)),
      landing && { buffer: loadedDeposit.home.grids.buffer },
      landing && slot((views) => {
        const put = gpuUniformWriter(WET_OP, views);
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

  /** The pixels a deposit's stamps (and dual stamps) reach, padded for its edges' blur, or null. */
  function depositBox(deposit: CompiledStampDeposit, loadedDeposit: LoadedDeposit, pad: number): Box | null {
    return marksBox(deposit, loadedDeposit.brush, pad, deposit.kind === 'flood' ? deposit.flood.box : null);
  }
  /** The pixels `placed`'s stamps and its dual's reach, with `also`'s, `pad` past, or null. */
  function marksBox(placed: Pick<StampPlacedMarks, 'stamps' | 'dualStamps'>, brush: StampBrush<StampPaintImage>, pad: number, also: StampBox | null): Box | null {
    const reach = [Infinity, Infinity, -Infinity, -Infinity];
    stampMarksReach(placed.stamps, reachSpanOf(brush), reach);
    if (brush.dual) stampMarksReach(placed.dualStamps, reachSpanOf(brush.dual), reach);
    if (also) reach.splice(0, 4, Math.min(reach[0], also.x0), Math.min(reach[1], also.y0), Math.max(reach[2], also.x1), Math.max(reach[3], also.y1));
    return onStage(reach[0] - pad, reach[1] - pad, reach[2] + pad, reach[3] + pad);
  }

  const photograph = paper.image ? image(paper.image) : null;
  /**
   * The Paper uniform at word `at` for `backing`: the painting's paper, or plain white or black. Cover: the photograph
   * fills the frame, cropped along whichever side it has to spare, so a margin leaves the frame's paper as it was;
   * past the frame it's mirrored.
   */
  const writePaper = (views: GpuUniformViews, at: number, backing: StampPaintBacking) => {
    const put = gpuUniformWriter(PAPER, views, at);
    put('frame', [frame.width, frame.height]);
    if (backing !== 'paper') {
      put('color', backing === 'white' ? [1, 1, 1] : [0, 0, 0]);
      return;
    }
    put('color', rgb(paper.color));
    if (!photograph) return;
    const fit = Math.max(frame.width / photograph.width, frame.height / photograph.height);
    put('hasImage', 1);
    put('cover', [frame.width / (photograph.width * fit), frame.height / (photograph.height * fit)]);
    put('lod', Math.max(0, Math.log2(1 / fit)));
  };
  // Mirrored, which within the frame reads as clamped does: at its edge the texel past it is the edge's own.
  const photographSampler = mirrorTile;
  const groupResources = compositor.group.resources({ photograph: photograph?.view ?? targets.blank.view, sampler: photographSampler });
  /** The moved group pass's bindings from after the compositor's up to GROUP_REST_BINDING: the rest points. */
  const groupRest = (rest: GPUTextureView): (GPUBindingResource | null)[] => [...Array<null>(GROUP_REST_BINDING - 3 - groupResources.length).fill(null), rest];

  /** `backing` over the painting target's first `w` × `h` texels (all of it when left out). */
  function drawPaper(encoder: GPUCommandEncoder, backing: StampPaintBacking, w = width, h = height) {
    dispatch(encoder, pipelines.paper, [slot((views) => writePaper(views, 0, backing)), photograph?.view ?? targets.blank.view, targets.painting.view, photographSampler], w, h);
  }

  /** Each warped group's last lattice, by its index: a frame warping it alike over the same box samples its map no more. */
  const lattices = new Map<number, { key: string; triangles: Float32Array }>();
  /**
   * Lays group `index`'s layer over `painted` onto the painting at its frame's visibility, resampled where its warp
   * and placement put it, its own paper read where it's painted, a reserve or lift showing `backing`. `traced`: its
   * travel goes into its plane's motion where its paint lies. Returns the stage box and rest map (moved), or null.
   */
  function layGroup(encoder: GPUCommandEncoder, index: number, groupFrame: StampGroupFrame, painted: Box, backing: StampPaintBacking, traced: StampTracedMotion | null): { box: Box; rest: GPUTextureView | null } | null {
    const { group, lay: laidAt, warp, visibility } = groupFrame;
    let box: Box | null = painted, lay: ReturnType<typeof latticeLayOf> | null = null;
    const map = stampGroupSceneMap(groupFrame);
    if (map || traced) {
      // A pixel past the painted box, for the bilinear read's reach, in painting points as the warp and placement map
      // them. A placement is affine, so one cell carries it exactly.
      const rest = { x: painted.x - margin - 1, y: painted.y - margin - 1, w: painted.w + 2, h: painted.h + 2 };
      let triangles: Float32Array;
      if (warp) {
        const at = laidAt && { ...laidAt.placement, pivot: laidAt.pivot };
        const key = `${JSON.stringify(warp.key)}|${warp.cell}|${at ? JSON.stringify(at) : ''}|${rest.x},${rest.y},${rest.w},${rest.h}`;
        const kept = lattices.get(index);
        if (kept?.key === key) triangles = kept.triangles;
        else {
          const { columns, rows } = stampWarpCells(rest.w, rest.h, warp.cell);
          triangles = stampWarpTriangles(map!, rest, columns, rows);
          lattices.set(index, { key, triangles });
        }
      } else triangles = stampWarpTriangles(map ?? ((point) => point), rest, 1, 1);
      const travel = traced?.travel?.travel;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let v = 0, k = latticeUsed; v < triangles.length; v += 4, k += LATTICE_VERTEX_FLOATS) {
        x0 = Math.min(x0, triangles[v]); x1 = Math.max(x1, triangles[v]);
        y0 = Math.min(y0, triangles[v + 1]); y1 = Math.max(y1, triangles[v + 1]);
        const moved = travel ? travel({ x: triangles[v + 2], y: triangles[v + 3] }) : STILL_TRAVEL;
        // To the stage's texels, then clip space, y up.
        latticeStaging.set([((triangles[v] + margin) / width) * 2 - 1, 1 - ((triangles[v + 1] + margin) / height) * 2, triangles[v + 2], triangles[v + 3], moved.x, moved.y], k);
      }
      if (map) box = onStage(x0, y0, x1, y1);
      if (!box) return null;
      lay = latticeLayOf();
      const first = latticeUsed, floats = (triangles.length / 4) * LATTICE_VERTEX_FLOATS;
      latticeUsed += floats;
      const latticePass = (attachments: GPURenderPassColorAttachment[], mode: StampMotionCover | null) => {
        const pipeline = lay!.pipeline(mode), pass = encoder.beginRenderPass({ colorAttachments: attachments });
        pass.setPipeline(pipeline);
        // A region's pass reads nothing: its pipeline binds nothing.
        if (mode !== 'region') pass.setBindGroup(0, bindGroup(pipeline, [targets.layer.view, linearClamp]));
        pass.setVertexBuffer(0, latticeVertices, first * 4, floats * 4);
        pass.draw(triangles.length / 4);
        pass.end();
      };
      const restInto: GPURenderPassColorAttachment = { view: lay.rest.view, loadOp: 'clear', clearValue: [STAMP_NO_REST, STAMP_NO_REST, 0, 0], storeOp: 'store' };
      // A region's motion is drawn on its own: the rest's pass drops what holds no paint.
      if (traced?.cover === 'paint') latticePass([restInto, latticeMotionInto(traced.into)], 'paint');
      else latticePass([restInto], null);
      if (traced?.cover === 'region') latticePass([latticeMotionInto(traced.into)], 'region');
      // A still group's lattice is drawn for its motion alone: it's laid where it's painted.
      if (!map) lay = null;
    }
    const at = box;
    dispatch(encoder, lay ? lay.movedGroupPipeline : pipelines.group, [
      slot((views) => {
        const put = gpuUniformWriter(GROUP, views);
        put('opacity', group.opacity * visibility);
        put('glaze', group.composite === 'glaze' ? 1 : 0);
        put('origin', [at.x, at.y]);
        put('extent', [at.w, at.h]);
        put('group', index);
        // Its own paper even on a measuring backing: opaque paint is laid over that, as on one sheet.
        writePaper(views, GROUP.at.paper, 'paper');
        put('paperFromRest', lay && group.paper === 'own' ? 1 : 0);
        put('backing', STAMP_PAINT_BACKING_WORDS[backing]);
      }),
      targets.layer.view, targets.painting.view, ...groupResources, ...(lay ? groupRest(lay.rest.view) : []),
    ], at.w, at.h);
    return { box: at, rest: lay ? lay.rest.view : null };
  }

  // Planes (stamp-plane.ts). A painted plane's picture is kept on the device under what it shows, and its defocus
  // under that and its sigma; a source plane's texture is handed in, defocused each frame it's blurred. Every picture
  // box here is in the stage's texels. Pipelines and targets are made when a frame first asks.
  const planePipelines = new Map<string, GPUComputePipeline>();
  const planePipeline = (key: string, code: () => string) => {
    if (!planePipelines.has(key)) planePipelines.set(key, computePipeline(code()));
    return planePipelines.get(key)!;
  };
  const planeTargets = new Map<string, { texture: GPUTexture; view: GPUTextureView; array: GPUTextureView }>();
  /** A scratch target of `layers` array layers, `w` × `h`, as a storage array, a sampled array and a render target. */
  const planeTarget = (name: string, w: number, h: number, layers: number) => {
    const key = `${name}|${w}|${h}|${layers}`;
    if (!planeTargets.has(key)) {
      const texture = owner.target(name, { size: [w, h, layers], format: 'rgba16float', usage: STORAGE | RENDER | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      planeTargets.set(key, { texture, view: texture.createView({ dimension: layers > 1 ? '2d-array' : '2d' }), array: arrayView(texture) });
    }
    return planeTargets.get(key)!;
  };
  const stageBox: Box = { x: 0, y: 0, w: width, h: height };
  // The frame's lens: composites the planes' pictures, blooms what glows and writes the frame (lens-compositor.ts).
  // Its blur extent spans the stage, or a source's picture if wider.
  const sourceSizes = [...sources.values()].map(({ picture: { texture } }) => texture);
  const lensGpu = createLensCompositor(owner.webgpu, { ...frame, blurExtent: { w: Math.max(width, ...sourceSizes.map(({ width: w }) => w)), h: Math.max(height, ...sourceSizes.map(({ height: h }) => h)) } });

  /** A picture on the device: its layers (by its kind), its texture, and its box in stage texels. */
  type StampPictureNote = StampPlanePictureLayers & { readonly box: Box };
  type StampPlanePicture = StampPictureNote & { readonly texture: GPUTexture };
  const pictures = owner.cache.store<StampPictureNote>('picture'), blurredPictures = owner.cache.store<StampPictureNote>('blurred');
  /** The plane's emission as its groups glow, stage-sized: cleared for each plane that glows. */
  const emissionTarget = () => planeTarget('emission', width, height, 1);
  /**
   * The plane's own motion as its groups are laid, stage-sized, in the lens's motion layer (lens-passes.ts): each
   * pixel's travel over the shutter, painting px, as its nearest paint moves. Cleared for each plane whose groups travel.
   */
  const motionTarget = () => planeTarget('motion', width, height, 1);
  /** The painting's linear light over `box` (stage texels) into array layer `layer` of `into`, from its first texel. */
  function measureLight(encoder: GPUCommandEncoder, box: Box, into: GPUTextureView, layer: number) {
    dispatch(encoder, planePipeline('light', () => stampPlaneLightWgsl(compositor, WORKGROUP)), [slot((views) => {
      const put = gpuUniformWriter(STAMP_PLANE_LIGHT, views);
      put('origin', [box.x, box.y]);
      put('extent', [box.w, box.h]);
      put('layer', layer);
    }), targets.painting.view, into], box.w, box.h);
  }
  /**
   * The measuring backings' own light, white at layer 0 and black at 1: this renderer's, measured once as it's made
   * (measureBackings), since they never change. A plain backing lays alike at every texel, so one texel holds it.
   */
  const backingLight = planes.nearer.some((plane) => plane.kind === 'picture')
    ? device.createTexture({ size: [1, 1, 2], format: 'rgba16float', usage: STORAGE | GPUTextureUsage.TEXTURE_BINDING })
    : null;
  /** Measures backingLight, submitted on its own so no frame can be drawn before it. */
  function measureBackings(light: GPUTexture) {
    slots = 0;
    const encoder = device.createCommandEncoder(), corner: Box = { x: 0, y: 0, w: 1, h: 1 };
    for (const [layer, backing] of (['white', 'black'] as const).entries()) {
      drawPaper(encoder, backing, 1, 1);
      measureLight(encoder, corner, arrayView(light), layer);
    }
    device.queue.writeBuffer(uniforms, 0, staging, 0, slots * SLOT);
    device.queue.submit([encoder.finish()]);
  }
  /**
   * Adds group `groupFrame`'s glow over `laid` (its box, and its rest map for a moved group) to the plane's emission:
   * its light past the glow's threshold, as much as it covers.
   */
  function addGlow(encoder: GPUCommandEncoder, { group, glow, visibility }: StampGroupFrame, laid: { box: Box; rest: GPUTextureView | null }) {
    const cover = laid.rest ? 'moved group' : 'group';
    const pipeline = planePipeline(`glow|${cover}`, () => stampGlowSourceWgsl(compositor, cover, stage, STAMP_NO_REST, WORKGROUP));
    dispatch(encoder, pipeline, [slot((views) => {
      const put = gpuUniformWriter(STAMP_GLOW_SOURCE, views);
      put('threshold', glow!.threshold);
      put('strength', glow!.amount * group.opacity * visibility);
      put('glaze', group.composite === 'glaze' ? 1 : 0);
      put('origin', [laid.box.x, laid.box.y]);
      put('extent', [laid.box.w, laid.box.h]);
    }), targets.painting.view, emissionTarget().view, targets.layer.view, ...(laid.rest ? [laid.rest] : [])], laid.box.w, laid.box.h);
  }
  /** Takes opaque group `groupFrame`'s cover over `laid` out of the plane's emission so far, as its paint covers the light. */
  function occludeGlow(encoder: GPUCommandEncoder, { group, visibility }: StampGroupFrame, laid: { box: Box; rest: GPUTextureView | null }) {
    const cover = laid.rest ? 'moved group' : 'group';
    const pipeline = planePipeline(`glow occlusion|${cover}`, () => stampGlowOcclusionWgsl(compositor, cover, stage, STAMP_NO_REST, WORKGROUP));
    dispatch(encoder, pipeline, [slot((views) => {
      const put = gpuUniformWriter(STAMP_GLOW_OCCLUSION, views);
      put('strength', group.opacity * visibility);
      put('origin', [laid.box.x, laid.box.y]);
      put('extent', [laid.box.w, laid.box.h]);
    }), null, emissionTarget().view, targets.layer.view, ...(laid.rest ? [laid.rest] : [])], laid.box.w, laid.box.h);
  }
  /**
   * Paints a plane's groups (`planeGroups`) as `kind` and resolves them into its picture, kept under `key`: a paper
   * picture over the stage, on the painting's paper; a film over what its groups were laid over (stage texels), laid
   * on white and again on black, from the films the first lay kept. Null for none.
   */
  function paintPicture(encoder: GPUCommandEncoder, planeGroups: readonly number[], kind: StampPlanePictureLayers['kind'], { groups, motion: planeMotion, whole, frameTrace }: StampPlaneDraw, key: string): StampPlanePicture | null {
    const shown = planeGroups.filter((index) => groups[index].visibility);
    const travelling = !!planeMotion && shown.some((index) => planeMotion.travels[index]);
    const layers = stampPlanePictureLayers(kind, { emits: shown.some((index) => groups[index].glow), travels: travelling });
    const first = layers.kind === 'film' ? 'white' : 'paper';
    drawPaper(encoder, first);
    if (layers.emission !== null) clear(encoder, emissionTarget().view);
    if (travelling) clear(encoder, motionTarget().view);
    const motion = travelling && planeMotion ? { into: motionTarget().view, travels: planeMotion.travels, cover: stampMotionCover(planeMotion.span) } : undefined;
    const laidBox = layPlaneGroups(encoder, planeGroups, groups, { whole, frameTrace, backing: first, motion });
    const box = layers.kind === 'film' ? laidBox : stageBox;
    if (!box) return null;
    const note: StampPictureNote = { ...layers, box };
    const [texture] = pictures.make(key, encoder, [{ width: box.w, height: box.h, layers: stampPlanePictureLayerCount(layers), format: 'rgba16float', usage: STORAGE | GPUTextureUsage.TEXTURE_BINDING }], note).textures;
    if (layers.kind === 'film') {
      // Between the lays the picture's colour layer holds the light on white over its box; the picture pass replaces it.
      measureLight(encoder, box, arrayView(texture), 0);
      drawPaper(encoder, 'black');
      layPlaneGroups(encoder, planeGroups, groups, { whole, backing: 'black' });
    }
    const pipeline = planePipeline(`picture|${stampPlanePictureLayersKey(layers)}`, () => stampPlanePictureWgsl(compositor, layers, WORKGROUP));
    dispatch(encoder, pipeline, [slot((views) => {
      const put = gpuUniformWriter(STAMP_PLANE_PICTURE, views);
      put('origin', [box.x, box.y]);
      put('extent', [box.w, box.h]);
    }), targets.painting.view, layers.emission !== null ? emissionTarget().view : null, arrayView(texture), layers.kind === 'film' ? arrayView(backingLight!) : null, layers.motion !== null ? motionTarget().view : null], box.w, box.h);
    return { ...note, texture };
  }
  /**
   * Lays `planeGroups` onto the painting as `groups` says, a reserve or lift showing `backing`. The first lay (on
   * paper or white) adds what glows, paints each film it can't restore and traces `motion`; the lay on black restores
   * the films the first kept. Returns the union of its groups' laid boxes (stage texels); null for none.
   */
  function layPlaneGroups(encoder: GPUCommandEncoder, planeGroups: readonly number[], groups: readonly StampGroupFrame[], { whole, frameTrace, backing, motion }: {
    whole: boolean; frameTrace?: FrameTrace; backing: StampPaintBacking; motion?: { into: GPUTextureView; travels: readonly (StampGroupTravel | null)[]; cover: StampMotionCover };
  }): Box | null {
    const again = backing === 'black';
    // A whole frame paints each film once, so its trace sees each deposit once: a clear plane keeps its films for the
    // lay on black, which restores them onto a cleared layer so a read-back layer holds what painting would.
    const keeps = !whole || backing !== 'paper';
    let laidBox: Box | null = null, glowed = false;
    for (const index of planeGroups) {
      const groupFrame = groups[index];
      // Hidden, none of it is drawn or loaded.
      if (!groupFrame.visibility) continue;
      const filmKey = `${index}|${groupFrame.paintKey}`;
      const kept = whole && !again ? undefined : restoreFilm(encoder, filmKey, whole);
      let painted: Box | null;
      if (kept === undefined) {
        painted = paintFilm(encoder, groupFrame, index, frameTrace);
        if (keeps) keepFilm(encoder, filmKey, painted);
      } else painted = kept;
      if (!painted) continue;
      const laid = layGroup(encoder, index, groupFrame, painted, backing, motion && !again ? { into: motion.into, travel: motion.travels[index], cover: motion.cover } : null);
      if (!laid) continue;
      // Before the next group: the layer and the lattice's rest map are this group's until the next one is laid. A
      // glaze leaves the glow under it: dimming it by its tint would take its spectral transmittance.
      if (!again && glowed && groupFrame.group.composite === 'opaque') occludeGlow(encoder, groupFrame, laid);
      if (groupFrame.glow && !again) {
        addGlow(encoder, groupFrame, laid);
        glowed = true;
      }
      laidBox = unionOf(laidBox, laid.box);
    }
    return laidBox;
  }
  /** `picture` (under `key`) defocused by `sigma`, plane px: kept under its key and the stepped sigma. */
  function blurredPicture(encoder: GPUCommandEncoder, picture: StampPlanePicture, key: string, sigma: number): StampPlanePicture {
    const stepped = lensSigmaStepped(sigma), blurredKey = `${key}|${stepped}`;
    const found = blurredPictures.find(blurredKey, encoder);
    if (found) return { ...found.note, texture: found.textures[0] };
    const { texture: sharp, box: sharpBox, ...layers } = picture;
    const box = stampGrownBox(sharpBox, lensGaussianReach(stepped), width, height), count = sharp.depthOrArrayLayers;
    const note: StampPictureNote = { ...layers, box };
    const [texture] = blurredPictures.make(blurredKey, encoder, [{ width: box.w, height: box.h, layers: count, format: 'rgba16float', usage: STORAGE | GPUTextureUsage.TEXTURE_BINDING }], note).textures;
    lensGpu.gaussian(encoder, { source: arrayView(sharp), into: arrayView(texture), layers: count, sigma: stepped, read: sharpBox, sourceAt: sharpBox, box });
    return { ...note, texture };
  }
  /**
   * A plane's picture this frame (its id, `planeGroups` and `kind`), defocused as `look` says, from the device's cache
   * where it's kept; null for none. A film whose groups are all hidden is nothing, drawn or looked up.
   */
  function planePicture(encoder: GPUCommandEncoder, plane: { id: string; groups: readonly number[] }, kind: StampPlanePictureLayers['kind'], look: StampPlaneLook, planeDraw: StampPlaneDraw): StampPlanePicture | null {
    if (kind === 'film' && plane.groups.every((index) => !planeDraw.groups[index].visibility)) return null;
    const key = pictureKey(plane, planeDraw), found = planeDraw.whole ? null : pictures.find(key, encoder);
    let picture: StampPlanePicture | null;
    if (found) {
      const restored = span('stamp paint picture restore');
      picture = { ...found.note, texture: found.textures[0] };
      restored();
    } else picture = paintPicture(encoder, plane.groups, kind, planeDraw, key);
    if (!picture) return null;
    // A plane's defocus is frame px: on its picture, it's that over the view's scale.
    return look.defocus ? blurredPicture(encoder, picture, key, look.defocus / Math.hypot(look.view.ma, look.view.mb)) : picture;
  }
  /**
   * Source plane `id`'s picture for the lens and its box in frame px: its colour alone when sharp and still, else with
   * its motion layer, each texel defocused by `focus` at its own distance, at most twice the aperture: else a point by
   * the lens would blur the whole picture.
   */
  function sourcePicture(encoder: GPUCommandEncoder, id: string, focus: LensFocus | null, moving: boolean): { view: GPUTextureView; box: Box; layers: LensPictureLayers } {
    const { texture, motion, at } = sources.get(id)!.picture, { width: w, height: h } = texture;
    const box: Box = { x: at.x, y: at.y, w, h };
    const defocusing = focus !== null && focus.aperture >= LENS_DEFOCUS_LEAST;
    if (!defocusing && !moving) return { view: arrayView(texture), box, layers: SOURCE_LAYERS };
    const both = planeTarget(`source ${id}`, w, h, 2);
    encoder.copyTextureToTexture({ texture }, { texture: both.texture, origin: { x: 0, y: 0, z: 0 } }, [w, h, 1]);
    encoder.copyTextureToTexture({ texture: motion }, { texture: both.texture, origin: { x: 0, y: 0, z: 1 } }, [w, h, 1]);
    const layers = moving ? SOURCE_MOVING_LAYERS : SOURCE_LAYERS;
    if (!defocusing) return { view: both.array, box, layers };
    const defocused = planeTarget(`source ${id} defocused`, w, h, 2);
    lensGpu.defocus(encoder, { source: both.array, into: defocused.array, size: { w, h }, focus, most: 2 * focus.aperture });
    return { view: defocused.array, box, layers };
  }
  /** The stage's whole texels within painting points x0..x1, y0..y1, or null for none. */
  function onStage(x0: number, y0: number, x1: number, y1: number): Box | null {
    const x = Math.max(0, Math.floor(x0) + margin), y = Math.max(0, Math.floor(y0) + margin);
    const w = Math.min(width, Math.ceil(x1) + margin) - x, h = Math.min(height, Math.ceil(y1) + margin) - y;
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  }
  /** A region's box (painting points) as a uniform's four words in the stage's texels; none for none. */
  function texelBoxWords(box: Box | undefined): [number, number, number, number] {
    return box ? [box.x + margin, box.y + margin, box.w, box.h] : [0, 0, 0, 0];
  }

  // Each group's film, kept on the device so a frame laying it elsewhere copies it back rather than painting it again
  // (stamp-paint-gpu-cache.ts). A film starts clear and reads nothing laid before it, so it's a function of its plan's
  // paintKey: equal keys, equal texels. It holds the painted box grown by the lay's read reach.
  const films = owner.cache.store<{ painted: Box | null }>('film');
  const filmLayers = targets.layer.texture.depthOrArrayLayers;
  /** The box the lay reads round `painted`, held to the stage. */
  const filmBox = (painted: Box) => stampGrownBox(painted, LAY_READ_REACH, width, height);
  /**
   * Group `index`'s film under `paintKey` copied back into the layer target, cleared first when `clean`: its painted
   * box (null for none), or undefined for no film.
   */
  function restoreFilm(encoder: GPUCommandEncoder, key: string, clean: boolean): Box | null | undefined {
    const found = films.find(key, encoder);
    if (!found) return undefined;
    const restored = span('stamp paint film restore');
    const [texture] = found.textures, { painted } = found.note;
    if (clean) for (const view of targets.layer.layers) clear(encoder, view);
    if (texture && painted) {
      const held = filmBox(painted);
      encoder.copyTextureToTexture({ texture }, { texture: targets.layer.texture, origin: { x: held.x, y: held.y, z: 0 } }, [held.w, held.h, filmLayers]);
    }
    restored();
    return painted;
  }
  /** Keeps the layer target, as it'll stand at this point in `encoder`, as the film under `key`, its paint over `painted`. */
  function keepFilm(encoder: GPUCommandEncoder, key: string, painted: Box | null) {
    const held = painted && filmBox(painted);
    const textures = held ? [{ width: held.w, height: held.h, layers: filmLayers, format: targets.layer.texture.format, usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST }] : [];
    const [texture] = films.make(key, encoder, textures, { painted }).textures;
    if (texture && held) encoder.copyTextureToTexture({ texture: targets.layer.texture, origin: { x: held.x, y: held.y, z: 0 } }, { texture }, [held.w, held.h, filmLayers]);
  }

  // A boiling group's epochs other than 0 (the painting as written) and a live group's posed marks, each loaded into a
  // bank of its own; one store keeps each group's most recently drawn, least recently used given up.
  const banks = new Map<string, { group: number; marks: CompiledStampGroup; bank: DepositBank; used: number }>();
  let bankClock = 0;
  /** Group `index`'s marks under `key`, loaded by `load` once while kept; `kept` of the group's banks of its kind stay. */
  function bankOf(index: number, key: string, kept: number, load: () => { marks: CompiledStampGroup; bank: DepositBank }): { marks: CompiledStampGroup; bank: DepositBank } {
    let found = banks.get(key);
    if (!found) {
      const kind = key.slice(0, key.indexOf('|'));
      const mine = [...banks].filter(([other, { group }]) => group === index && other.startsWith(`${kind}|`));
      if (mine.length >= kept) {
        const [oldest, { bank }] = mine.reduce((a, b) => (b[1].used < a[1].used ? b : a));
        bank.destroy();
        banks.delete(oldest);
      }
      found = { group: index, ...load(), used: 0 };
      banks.set(key, found);
    }
    found.used = ++bankClock;
    return found;
  }
  /** Group `index` as drawn with `drawing`'s marks, and the bank holding its deposits. */
  function marksOf(index: number, group: CompiledStampGroup, drawing: StampGroupMarks): { marks: CompiledStampGroup; bank: DepositBank } {
    if (drawing.kind === 'live') {
      // Keyed by what names the marks (equal keys, equal marks), so a frame repeating one draws the marks loaded.
      return bankOf(index, `live|${index}|${drawing.key}`, STAMP_LIVE_MARKS_KEPT, () => {
        const loaded = span('stamp paint live load');
        const bank = loadBank([drawing.marks], { kind: 'live' });
        loaded();
        return { marks: drawing.marks, bank };
      });
    }
    if (!drawing.epoch) return { marks: group, bank: writtenBank };
    return bankOf(index, `epoch|${index}|${drawing.epoch}`, STAMP_BOIL_EPOCHS_KEPT, () => {
      const marks = group.boil!.reseeded(drawing.epoch);
      return { marks, bank: loadBank([marks], { kind: 'epoch', written: writtenBank }) };
    });
  }

  /** Draws a deposit of `pass` (as its bank's home knows it) and runs the deposit stages after it, returning the pixels changed. */
  function drawDeposit(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, loadedDeposit: LoadedDeposit, pass: CompiledStampPass, { paintAt, epoch }: { paintAt: number; epoch: number }, frameTrace?: FrameTrace): Box | null {
    // The rim is where the mask stands above a blur as wide as its edge.
    const sigma = loadedDeposit.active.edgeSigma, blurred = sigma > 0;
    const box = depositBox(deposit, loadedDeposit, depositPad(loadedDeposit));
    if (!box) return null;
    const body = deposit.kind === 'flood' ? loadedDeposit.home.regions.bodies.get(loadedDeposit.staged) : null;
    drawStamps(encoder, loadedDeposit, deposit, box, deposit.kind === 'flood' && body ? { region: body, flood: deposit.flood } : null);
    if (!loadedDeposit.landing) {
      pressing?.draw(encoder, deposit, loadedDeposit, box);
      before?.copy(encoder, box);
    }
    if (blurred) blurMask(encoder, sigma, box);
    resolveDeposit(encoder, deposit, loadedDeposit, pass, paintAt, blurred, box, frameTrace);
    let painted: Box = box;
    // A stage knows each deposit as its bank's home does (`staged`); a boil's epoch lands as its deposit as written does
    // (loadBank), and draws its randomness from the epoch's seed.
    const { landing, identity, staged, home } = loadedDeposit;
    if (!landing) return painted;
    const seed = paintPigmentSeed(stampBoilSeed(identity.id, epoch));
    for (const wetStage of home.stages) {
      if (wetStage.after === 'deposit') painted = unionOf(painted, wetStage.running.encode(encoder, { deposit: staged, pass, landing, box, seed }))!;
    }
    return painted;
  }

  /** Paints group `groupFrame`'s film into the layer target from clear, returning its painted box. */
  function paintFilm(encoder: GPUCommandEncoder, { group, marks: drawing, paintAt }: StampGroupFrame, index: number, frameTrace?: FrameTrace): Box | null {
    const epoch = drawing.kind === 'written' ? drawing.epoch : 0;
    const { marks, bank } = marksOf(index, group, drawing);
    // Unkeyed paint reads the same at any time; a recipe's keyed paint always gives its paintAt.
    const at = { paintAt: paintAt ?? 0, epoch };
    for (const view of targets.layer.layers) clear(encoder, view);
    let painted: Box | null = null;
    for (const [p, pass] of group.passes.entries()) {
      // Live marks' regions and stages know their own passes; an epoch's know those as written.
      const drawnPass = marks.passes[p], stagedPass = bank.own ? drawnPass : pass;
      if (!pass.clipTo) clear(encoder, targets.clip.view);
      for (const deposit of stampPassDeposits(drawnPass)) {
        const loadedDeposit = bank.deposits.get(deposit)!;
        painted = unionOf(painted, drawDeposit(encoder, deposit, loadedDeposit, stagedPass, at, frameTrace));
        const drying = loadedDeposit.home.dryingsByLast.get(loadedDeposit.staged);
        if (!drying) continue;
        const seed = paintPigmentSeed(stampBoilSeed(drying.id, epoch));
        for (const wetStage of loadedDeposit.home.stages) if (wetStage.after === 'drying') painted = unionOf(painted, wetStage.running.encode(encoder, { drying, seed }));
      }
    }
    return painted;
  }

  // The reference frame its exposures go into, from its first to its last.
  let referenceFrame: LensFrameExposures | null = null;
  /** The lens frame `paintFrame` draws into: its own for one exposure, else its reference frame's. */
  function lensFrameOf(paintFrame: StampPaintFrame): LensFrameExposures {
    if (paintFrame.kind !== 'exposure') return lensGpu.beginFrame(1);
    const { index, count } = paintFrame.exposure;
    if (index === 0) referenceFrame = lensGpu.beginFrame(count);
    if (referenceFrame?.count !== count) throw new Error(`stamp paint: exposure ${index} of ${count} drawn into a paintFrame of ${referenceFrame?.count ?? 'none'}`);
    return referenceFrame;
  }

  /**
   * Encodes `paintFrame`. `whole` paints every group afresh, keeping only the films a clear plane lays again: for a
   * traced frame and a read-back layer. `moved`: the source planes whose render moved over the shutter. One plane at
   * rest, nothing glowing or moving, is output as painted; else each picture is laid where the lens puts it.
   */
  function draw(paintFrame: StampPaintFrame, { frameTrace, whole = frameTrace !== undefined, moved = new Set() }: { frameTrace?: FrameTrace; whole?: boolean; moved?: ReadonlySet<string> } = {}) {
    owner.assertLive();
    const { t, state } = paintFrame, lensFrame = paintFrame.kind === 'once' ? null : paintFrame.lens;
    const groups = paintFrame.kind === 'exposure' ? stampFramePlanExposed(painting, { t, state }, { t: paintFrame.exposure.at, state: paintFrame.exposure.state }) : stampFramePlan(painting, t, state);
    slots = 0;
    latticeUsed = 0;
    latticeRoom(groups);
    const glows = groups.some(({ visibility, glow }) => visibility && glow);
    if (glows && !lensFrame) throw new Error(`stamp paint: a group glows at ${t} s, and only a lens blooms it: draw the paintFrame through a camera's lens (paint-camera.ts)`);
    const lookOf = (id: string) => lensFrame?.planes.get(id) ?? REST_LOOK;
    const encoder = device.createCommandEncoder();
    const output = (pipeline: GPURenderPipeline, resources: (GPUBindingResource | null)[]) => {
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: surface.frameTexture().createView(), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup(pipeline, resources));
      pass.draw(3);
      pass.end();
    };
    const { back, nearer } = planes;
    // A fast frame is gathered along whatever moves over its shutter: a plane's view, a group, a source's render.
    const travels = paintFrame.kind === 'fast' && paintFrame.shutter ? stampFramePlanMotion(painting, { t, state }, { kind: 'shutter', ...paintFrame.shutter }) : null;
    const planeMotion: StampPlaneMotion | null = travels?.some(Boolean) ? { span: 'shutter', travels } : null;
    const moving = paintFrame.kind === 'fast' && (!!planeMotion || moved.size > 0 || [...paintFrame.lens.planes.values()].some(({ shutter }) => shutter));
    if (paintFrame.kind !== 'exposure' && !nearer.length && !glows && isRest(lookOf(back.id)) && !planeMotion) {
      // The composite of one opaque plane at rest is its painting: shown as it is, not round linear light and back.
      drawPaper(encoder, 'paper');
      layPlaneGroups(encoder, back.groups, groups, { whole, frameTrace, backing: 'paper' });
      output(outputPipeline, [targets.painting.view]);
    } else {
      // Every picture first, as each plane is painted on the one painting target; then laid far to near.
      const planeDraw: StampPlaneDraw = { groups, motion: planeMotion, whole, frameTrace };
      const layerOf = (picture: StampPlanePicture | null, look: StampPlaneLook, clipped: boolean): LensLayer[] => (picture
        ? [{
          picture: arrayView(picture.texture), layers: picture, view: look.view, shutter: look.shutter,
          origin: { x: picture.box.x - margin, y: picture.box.y - margin }, size: picture.box, clipped, distance: look.distance, distances: 'layer',
        }]
        : []);
      const layers: LensLayer[] = [
        ...layerOf(planePicture(encoder, back, 'paper', lookOf(back.id), planeDraw), lookOf(back.id), false),
        ...nearer.flatMap((plane): LensLayer[] => {
          const look = lookOf(plane.id);
          switch (plane.kind) {
            case 'picture': return layerOf(planePicture(encoder, plane, 'film', look, planeDraw), look, true);
            case 'three': {
              // A source renders through the camera, its motion with it: only the lens's defocus is left to do.
              const sourceMoving = moving && moved.has(plane.id);
              const { view, box, layers: pictureLayers } = sourcePicture(encoder, plane.id, lensFrame?.focus ?? null, sourceMoving);
              return [{
                picture: view, layers: pictureLayers, view: REST_LOOK.view, shutter: null, origin: { x: box.x, y: box.y }, size: box, clipped: true,
                distance: look.distance, distances: sourceMoving ? 'texels' : 'layer',
              }];
            }
            default: return plane satisfies never;
          }
        }),
      ];
      const lensFrameExposures = lensFrameOf(paintFrame);
      lensFrameExposures.exposure(encoder, layers, { glowing: glows, moving });
      // One bloom, of all that glows as the frame shows it, once its exposures are in.
      if (paintFrame.kind !== 'exposure' || paintFrame.exposure.index === paintFrame.exposure.count - 1) {
        lensFrameExposures.develop(encoder, {
          bloom: lensFrame ? { sigma: lensFrame.bloom, strength: 1, glow: 'emission' } : null,
          into: surface.frameTexture().createView(), format, encoding: { kind: 'encoded', dithered },
        });
      }
    }
    device.queue.writeBuffer(uniforms, 0, staging, 0, slots * SLOT);
    if (latticeUsed) device.queue.writeBuffer(latticeVertices!, 0, latticeStaging, 0, latticeUsed);
    lensGpu.flush();
    return encoder;
  }

  /** Renders each source plane for `paintFrame`, one after another: the ones whose render moved over its shutter. */
  async function renderSources(paintFrame: StampPaintFrame): Promise<ReadonlySet<string>> {
    const exposure = paintFrame.kind === 'exposure' ? { index: paintFrame.exposure.index, at: paintFrame.exposure.at, aperture: paintFrame.exposure.aperture } : null;
    return [...sources].reduce<Promise<Set<string>>>(async (prior, [id, source]) => {
      const moved = await prior;
      if ((await source.render(paintFrame.t, exposure)).moved) moved.add(id);
      return moved;
    }, Promise.resolve(new Set()));
  }

  /**
   * Draws each brushed mask into a texture of its own over its marks' reach (none for one off the painting), each mark
   * resolved as a deposit's coverage is and joined by max, and reads them back: the coverage measured, on the
   * wetness's samples, once the GPU is done.
   */
  function loadBrushedMasks(): { textures: ReadonlyMap<CompiledStampBrushedMask, RegionTexture | null>; measured: Promise<StampBrushedCoverage> } {
    if (!brushed.masks.length) return { textures: new Map(), measured: Promise.resolve(new Map()) };
    const binData: number[] = [], loadPlan = planLoader(binData);
    let total = 0;
    const placed = brushed.masks.flatMap(({ marks }) => marks).map((mark) => {
      const brush = brushed.bound.get(mark)!;
      const at = {
        mark, brush, main: total, dual: total + mark.stamps.length,
        mainPlan: loadPlan(brush, mark.stamps), dualPlan: brush.dual ? loadPlan(brush.dual, mark.dualStamps) : null,
      };
      total += mark.stamps.length + mark.dualStamps.length;
      return at;
    });
    const stampData = new Float32Array(Math.max(1, total) * STAMP_FLOATS);
    for (const { mark, main, dual } of placed) {
      // Fluid has no medium: its marks' grain cuts as deep as their brush says, as a deposit's in flat colour does.
      stampData.set(stampInstanceFloats(mark.stamps, stampGrainDepthSourceIn(null)), main * STAMP_FLOATS);
      stampData.set(stampInstanceFloats(mark.dualStamps, stampGrainDepthSourceIn(null)), dual * STAMP_FLOATS);
    }
    const stampBuffer = buffer(stampData, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE), binBuffer = buffer(new Uint32Array(binData.length ? binData : [0]), GPUBufferUsage.STORAGE);
    // A mask lays no colour: its marks are drawn untinted.
    const loaded = new Map(placed.map(({ mark, brush, main, dual, mainPlan, dualPlan }): [CompiledStampMarkPlacement, LoadedMarks] => [mark, {
      brush, active: stampActiveLayers(brush, mark.diameter), main, dual, tint: null, mainPlan, dualPlan,
      mainHull: tipHull(brush, mark.stamps), dualHull: brush.dual ? tipHull(brush.dual, mark.dualStamps) : null,
      stampBuffer, tintBuffer: noTintBuffer, binBuffer,
    }]));
    // A pixel past each mark's reach, as a deposit's box with no edges to blur.
    const markBox = (mark: CompiledStampMarkPlacement) => marksBox(mark, loaded.get(mark)!.brush, 1, null);
    const boxes = new Map(brushed.masks.map((mask) => [mask, mask.marks.reduce<Box | null>((box, mark) => unionOf(box, markBox(mark)), null)] as const));
    const bytes = [...boxes.values()].reduce((sum, box) => sum + (box ? box.w * box.h * STAMP_REGION_TEXEL_BYTES : 0), 0);
    if (bytes > STAMP_REGION_BUDGET) throw new Error(`stamp paint: the painting's ${boxes.size} brushed masks need ${Math.round(bytes / 2 ** 20)} MB, over ${STAMP_REGION_BUDGET / 2 ** 20} MB; crop their marks`);

    const module = device.createShaderModule({ code: brushedCoverWgsl(stage) });
    const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module }, fragment: { module, entryPoint: 'brushedCover', targets: [{ format: STAMP_REGION_FORMAT, blend: maxBlend }] } });
    // Averaged onto the samples on the GPU: a sixteenth of the pixels to read back.
    const samplesModule = device.createShaderModule({ code: SAMPLE_COVER_WGSL });
    const samplesPipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: samplesModule }, fragment: { module: samplesModule, entryPoint: 'sampleCover', targets: [{ format: 'r32float' }] } });
    const tooth = paper.grain;
    slots = 0;
    const encoder = device.createCommandEncoder();
    const textures = new Map<CompiledStampBrushedMask, RegionTexture | null>(), reads: { mask: CompiledStampBrushedMask; texture: GPUTexture; grid: Omit<StampCoverageSamples, 'values'>; offset: number; rowBytes: number }[] = [];
    let readBytes = 0;
    for (const mask of brushed.masks) {
      const box = boxes.get(mask)!;
      textures.set(mask, null);
      if (!box) continue;
      const texture = device.createTexture({ size: [box.w, box.h], format: STAMP_REGION_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      const view = texture.createView();
      // Drawn on the stage's texels, kept as a region is, in painting points.
      const region = { x: box.x - margin, y: box.y - margin, w: box.w, h: box.h };
      textures.set(mask, { view, box: region });
      clear(encoder, view);
      for (const mark of mask.marks) {
        const marks = loaded.get(mark)!, reach = markBox(mark);
        if (!reach) continue;
        drawStamps(encoder, marks, mark, reach, null);
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }] });
        pass.setScissorRect(reach.x - box.x, reach.y - box.y, reach.w, reach.h);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup(pipeline, [
          slot((views) => {
            const put = writeCoverage(views, marks, mark.grainOffset, stampResolveOrderIndex(STAMP_RESOLVE_PLANS[stampResolvePlan(marks.brush.dual)]), false);
            put('flags', coverageFlags(marks).reduce((all, flag) => all | DEPOSIT_FLAGS[flag], 0));
          }),
          targets.mask.view, targets.cap.view,
          marks.active.main.canvasGrain?.image.view ?? targets.blank.view, marks.active.dual?.canvasGrain?.image.view ?? targets.blank.view,
          tooth ? image(tooth.image).view : targets.blank.view, tile, mirrorTile,
          slot((views) => {
            const put = gpuUniformWriter(BRUSHED_COVER, views);
            put('origin', [box.x, box.y]);
            put('resist', mask.resist?.amount ?? 0);
          }),
        ]));
        pass.draw(3);
        pass.end();
      }
      const grid = stampCoverageSampleGrid(region);
      const samples = device.createTexture({ size: [grid.columns, grid.rows], format: 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: samples.createView(), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(samplesPipeline);
      pass.setBindGroup(0, bindGroup(samplesPipeline, [view, slot((views) => {
        const put = gpuUniformWriter(SAMPLE_COVER, views);
        put('origin', [region.x, region.y]);
        put('first', [grid.a0, grid.b0]);
      })]));
      pass.draw(3);
      pass.end();
      const rowBytes = Math.ceil((grid.columns * 4) / 256) * 256;
      reads.push({ mask, texture: samples, grid, offset: readBytes, rowBytes });
      readBytes += rowBytes * grid.rows;
    }
    const read = device.createBuffer({ size: Math.max(4, readBytes), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    for (const { texture, grid, offset, rowBytes } of reads) encoder.copyTextureToBuffer({ texture }, { buffer: read, offset, bytesPerRow: rowBytes }, [grid.columns, grid.rows]);
    device.queue.writeBuffer(uniforms, 0, staging, 0, slots * SLOT);
    device.queue.submit([encoder.finish()]);
    const measured = read.mapAsync(GPUMapMode.READ).then(() => {
      const floats = new Float32Array(read.getMappedRange());
      // A mask off the painting covers no samples.
      const coverage = new Map(brushed.masks.map((mask): [CompiledStampBrushedMask, StampCoverageSamples] => [mask, { a0: 0, b0: 0, columns: 0, rows: 0, values: new Float32Array(0) }]));
      for (const { mask, grid, offset, rowBytes } of reads) {
        const values = new Float32Array(grid.columns * grid.rows);
        for (let y = 0; y < grid.rows; y++) values.set(floats.subarray((offset + y * rowBytes) / 4, (offset + y * rowBytes) / 4 + grid.columns), y * grid.columns);
        coverage.set(mask, { ...grid, values });
      }
      read.destroy();
      return coverage;
    });
    return { textures, measured };
  }

  done = span('stamp paint brushed masks load');
  const brushedMasks = loadBrushedMasks();
  done();
  if (backingLight) measureBackings(backingLight);

  // A painting whose inputs change in the same commit as its time is disposed before its last draw is asked for.
  let disposed = false;
  // A frame's own read-back buffers are the owner's, made and destroyed by the frame.
  const { queue } = owner.device;
  const finish = (coverage: StampBrushedCoverage): StampPaintRenderer => {
    let loading = span('stamp paint wetness load');
    const wetness = wetnessOf?.(painting, coverage) ?? null;
    const wetReport = wetness && stampWetReport(painting, wetness);
    const strictFailures = wetReport ? stampWetReportStrictFailures(wetReport) : [];
    if (strictFailures.length) throw new Error(`stamp paint: ${strictFailures.length} strict failure(s):\n${strictFailures.join('\n')}`);
    const wetWarnings = wetReport ? stampWetReportWarnings(wetReport) : [];
    loading();
    loading = span('stamp paint bank load');
    writtenBank = loadBank(painting.groups, { kind: 'written', wetness });
    loading();
    return {
      stage,
      wetness,
      wetWarnings,
      draw: async (paintFrame) => {
        if (disposed) return;
        const moved = await renderSources(paintFrame);
        await owner.checked(`drawing the painting at ${paintFrame.t} s`, () => queue.submit([draw(paintFrame, { moved }).finish()]));
      },
      trace: async (paintFrame, requests) => {
        if (disposed) throw new Error('stamp paint: a disposed renderer traces nothing');
        const traced: FrameTrace['deposits'] = new Map();
        let floats = 0;
        for (const request of requests) {
          const { deposit, crop } = request;
          if (!writtenBank.deposits.has(deposit)) throw new Error(`stamp paint: can't trace ${deposit.id}, which isn't in the painting`);
          if (traced.has(deposit)) throw new Error(`stamp paint: ${deposit.id} is traced twice in one paintFrame`);
          if (!(crop.w > 0 && crop.h > 0)) throw new Error(`stamp paint: ${deposit.id}'s trace crop is ${crop.w} × ${crop.h}, and a crop needs pixels`);
          traced.set(deposit, { request, order: request.order ? stampResolveOrderIndex(request.order) : writtenBank.deposits.get(deposit)!.resolveOrder, offset: floats });
          floats += crop.w * crop.h * TRACE_SLOTS;
        }
        const bytes = Math.max(4, floats * 4);
        const traceBuffer = owner.device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        const read = owner.device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        try {
          const moved = await renderSources(paintFrame);
          await owner.checked(`tracing the painting at ${paintFrame.t} s`, () => {
            const encoder = draw(paintFrame, { frameTrace: { deposits: traced, buffer: traceBuffer }, moved });
            encoder.copyBufferToBuffer(traceBuffer, 0, read, 0, bytes);
            queue.submit([encoder.finish()]);
          });
          await read.mapAsync(GPUMapMode.READ);
          const all = new Float32Array(read.getMappedRange().slice(0));
          read.unmap();
          return requests.map(({ deposit, crop }) => {
            const { order, offset } = traced.get(deposit)!, plane = crop.w * crop.h;
            const at = (index: number) => all.slice(offset + index * plane, offset + (index + 1) * plane);
            return { crop, built: at(0), stages: STAMP_RESOLVE_ORDERS[order].map((resolveStage, k) => ({ stage: resolveStage, coverage: at(k + 1) })), coverage: at(TRACE_SLOTS - 1) };
          });
        } finally {
          traceBuffer.destroy();
          read.destroy();
        }
      },
      readLayer: async (paintFrame) => {
        if (disposed) throw new Error('stamp paint: a disposed renderer reads back nothing');
        const layers = targets.layer.layers.length, rowBytes = Math.ceil((width * 8) / 256) * 256;
        const read = owner.device.createBuffer({ size: rowBytes * height * layers, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        try {
          const moved = await renderSources(paintFrame);
          await owner.checked(`reading back the layer at ${paintFrame.t} s`, () => {
            const encoder = draw(paintFrame, { whole: true, moved });
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
        // Destroyed once submitted work is done with them; the owner and its targets stay for the next painting.
        for (const { bank } of banks.values()) bank.destroy();
        films.dispose();
        pictures.dispose();
        blurredPictures.dispose();
        lensGpu.dispose();
        scope.destroy();
      },
    };
  };
  return { measured: brushedMasks.measured, finish };
}


/** `texture` viewed as an array, as a gaussian pass binds a plain target and an array one alike. */
const arrayView = (texture: GPUTexture) => texture.createView({ dimension: '2d-array' });
/** What `plane`'s picture shows this frame: each of its groups' film, lay, warp, visibility, glow and motion. */
const pictureKey = (plane: { id: string; groups: readonly number[] }, { groups, motion }: StampPlaneDraw) => JSON.stringify([plane.id, plane.groups.map((index) => {
  const { paintKey, lay, warp, visibility, glow } = groups[index];
  return visibility ? [paintKey, lay, warp && [warp.key, warp.cell], visibility, glow, motion?.travels[index]?.key] : null;
}), motion?.span ?? null]);
/** A source's render's layers: laid over by its alpha, as a paper picture is, with no emission. */
const SOURCE_LAYERS: LensPictureLayers = { taken: null, emission: null, motion: null };
const SOURCE_MOVING_LAYERS: LensPictureLayers = { ...SOURCE_LAYERS, motion: 1 };
/** Rest: a plane where it's painted, sharp. */
const REST_LOOK: StampPlaneLook = { view: { ma: 1, mb: 0, kx: 0, ky: 0 }, defocus: 0, distance: 1, shutter: null };
const isRest = ({ view, defocus, shutter }: StampPlaneLook) => view.ma === 1 && view.mb === 0 && view.kx === 0 && view.ky === 0 && !defocus && !shutter;
const clear = (encoder: GPUCommandEncoder, view: GPUTextureView) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }).end();
const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
const rgb = (hex: string): [number, number, number] => [channel(hex, 1), channel(hex, 3), channel(hex, 5)];
/** The mip level a grain `texture` tiled `tileW` pixels across reads: texels per pixel, as a fragment's derivatives would say. */
const grainLod = (texture: StampPaintImage, tileW: number) => Math.max(0, Math.log2(texture.width / tileW));

/** Writes a Grain at word `at`: its tile in pixels, its offset in tiles, its mip level and how it reads. */
function writeGrain(views: GpuUniformViews, at: number, grain: StampBrushGrain<StampPaintImage>, tile: readonly [number, number], offset: readonly [number, number], lod: number) {
  const put = gpuUniformWriter(GRAIN, views, at);
  put('place', [tile[0], tile[1], offset[0], offset[1]]);
  put('shape', [grain.depth, lod, grain.brightness, grain.contrast]);
  put('blend', stampGrainModeIndex(grain.blend));
  put('layer', grain.blend.family === 'layer' ? 1 : 0);
  put('aboutMean', grain.contrastPivot === 'mean' ? 1 : 0);
  put('mirror', grain.tiling === 'mirror' ? 1 : 0);
}

/**
 * `staged`'s landing in `wetness` where the wash law of its group's medium lays `identity`, the deposit as written,
 * else null (LoadedDeposit's `landing`): a wash keeps a history, landing each deposit.
 */
function washLanding(identity: CompiledStampDeposit, staged: CompiledStampDeposit, wetness: StampWetness | null): StampWetLanding | null {
  const landing = wetness?.landings.get(staged) ?? null;
  return landing && stampDepositionLaw(identity, landing.medium, true) === 'wash' ? landing : null;
}

/** A box as a uniform's four words; an empty box for none, whose region reads 0 everywhere. */
const boxWords = (box: Box | undefined): [number, number, number, number] => (box ? [box.x, box.y, box.w, box.h] : [0, 0, 0, 0]);

/** `box` grown by `by` px each side, held to a `width` × `height` target. */
function stampGrownBox(box: Box, by: number, width: number, height: number): Box {
  const x = Math.max(0, box.x - by), y = Math.max(0, box.y - by);
  return { x, y, w: Math.min(width, box.x + box.w + by) - x, h: Math.min(height, box.y + box.h + by) - y };
}

const unionOf = (a: Box | null, b: Box | null) => (a && b ? union(a, b) : a ?? b);

/** A wet stage as loaded, by when it runs. */
type LoadedWetStage =
  | { after: 'deposit'; running: StampLoadedWetStage<StampWetDepositMoment> }
  | { after: 'drying'; running: StampLoadedWetStage<StampWetDryingMoment> };

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

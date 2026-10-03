// stamp-paint-renderer.ts: draws a compiled stamp painting through WebGPU on a surface (stamp-paint-surface.ts), whose
// device's owner holds what outlasts it; a painting loads its own stamps, regions and wet stages, and keeps its groups'
// films and its planes' pictures (stamp-plane.ts), laid where each frame's lens puts them (stamp-paint-plane-passes.ts).
//
// A bank loads a set of groups' deposits (stamp-deposit-bank.ts), and what doesn't change with time into cropped
// textures (stamp-region-textures.ts); the deposit drawing (stamp-deposit-drawing.ts) lays each onto its group's
// layer, and starts each wash and closes each drying on the same targets.
//
// Formulas and stage orders come from the models' WGSL registries; the GPU gate (lib/paint/gate) holds them.

import { STAMP_RESOLVE_ORDERS, stampResolveOrderIndex, type StampResolveStage } from '../models/stamp-deposit-stages.ts';
import {
  stampBoilSeed, stampMixedPainting, stampPassDeposits, type CompiledStampDeposit, type CompiledStampGroup, type CompiledStampMask, type CompiledStampPaint,
  type CompiledStampPass,
} from '../models/stamp-paint-recipe-compile.ts';
import { stampDepositWalled, type StampPaintMedia, type StampWashDrying, type StampWetLanding, type StampWetness } from '../models/stamp-wetness.ts';
import { compileStampWetness } from '../models/stamp-wash-waits.ts';
import { stampPaintingBrushedMasks, type CompiledStampBrushedMask } from '../models/stamp-brushed-mask.ts';
import { stampWetReport, stampWetReportStrictFailures, stampWetReportWarnings } from '../models/stamp-wet-report.ts';
import { stampDepositWashLaw } from '../models/stamp-wet-landing.ts';
import { paintPigmentSeed } from '#lib/paint/materials/models/paint-paper.ts';
import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampTipsOf } from '../models/stamp-tip-support.ts';
import { stampPaintTargetWgsl, type StampPaintCompositor, type StampPaintTarget, type StampWashLayer } from './stamp-paint-compositor.ts';
import { stampPaintCompositorFor } from './stamp-paint-compositor-for.ts';
import { clearStampTarget, copyStampTextureBox, dispatchStampCompute, STAMP_WORKGROUP, stampArrayView, stampBindGroup, stampPaintSamplers, type StampPaintDevice } from './stamp-paint-gpu.ts';
import { createStampUniformArena } from './stamp-uniform-arena.ts';
import type { StampPaintGpuScope } from './stamp-paint-gpu-owner.ts';
import type { StampPaintSurface } from './stamp-paint-surface.ts';
import { stampLensSourceExposureOf, type StampLensSource, type StampLensSourceExposure } from './stamp-lens-source.ts';
import { checkStampLensSources, createStampLensFrames, createStampLensSourceLayers, stampLensSourcesBlurExtent, type StampSourceRenders } from './stamp-lens-source-layers.ts';
import { gpuUniformLayout, gpuUniformStruct, gpuUniformWriter, type GpuUniformViews } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { STAMP_WET_STAGES } from './stamp-wet-stage-list.ts';
import {
  planStampWetStages, stampWetStageReach, type StampLoadedWetStages, type StampWetBank, type StampWetStage, type StampWetStagePlans, type StampWetWall,
} from './stamp-wet-stages.ts';
import { STAMP_WET_FIELD_FORMATS, stampWetField } from './stamp-wet-field.ts';
import {
  STAMP_GLOW_OCCLUSION, STAMP_GLOW_SOURCE, STAMP_PLANE_LIGHT, STAMP_PLANE_PICTURE, stampGlowOcclusionWgsl, stampGlowSourceWgsl,
  stampPlaneLightWgsl, stampPlanePictureLayerCount, stampPlanePictureLayers, stampPlanePictureLayersKey, stampPlanePictureWgsl,
  type StampPlanePictureLayers,
} from './stamp-paint-plane-passes.ts';
import { lensGaussianReach, lensSigmaStepped } from '#lib/picture/lens/models/lens-focus.ts';
import { createLensCompositor, type LensLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import type { FrameProfileStart } from '#lib/picture/profiling/studio/frame-profile.ts';
import { stampWarpCells, stampWarpTriangles, STAMP_WARP_MOST_CELLS } from '../models/stamp-group-warp.ts';
import {
  stampFramePlan, stampFramePlanExposed, stampFramePlanMotion, stampGroupSceneMap, type StampGroupFrame, type StampGroupTravel, type StampMotionSpan, type StampPosedMoment,
} from '../models/stamp-frame-plan.ts';
import type { StampGroupMarks, StampPaintFrameState } from '../models/stamp-paint-frame-state.ts';
import { STAMP_REST_LOOK, stampSinglePlane, type StampLaidPlanes, type StampLensFrame, type StampPlaneLook } from '../models/stamp-plane.ts';
import { stampBoxUnion, stampStage, stampStageTexelsGrown, stampStageTexelsWithin, stampStageWgsl, type StampStage } from '../models/stamp-stage.ts';
import { gpuHalfValue } from '#lib/platform/gpu/models/gpu-half-float.ts';
import { GPU_FULL_FRAME_WGSL, GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import { bindStampPaintBrushes, loadStampDepositBank, type StampDepositToLoad, type StampLoadedDeposit, type StampPaintBrushes } from './stamp-deposit-bank.ts';
import { createStampDepositDrawing, stampDepositUniformSlots, stampPaperTooth, type StampDepositDraw, type StampDepositTargets, type StampWashStart } from './stamp-deposit-drawing.ts';
import { STAMP_TRACE_ACCUMULATOR, STAMP_TRACE_SLOTS } from './stamp-deposit-resolve-wgsl.ts';
import { encodeStampRegionTextures, type StampRegionCoverage, type StampRegionTexture } from './stamp-region-textures.ts';
import { encodeStampBrushedMasks } from './stamp-brushed-mask-textures.ts';

/**
 * The uniform slots a plane takes besides its groups': its paper (white) and black, a light pass, its picture, its
 * defocus (two passes) and its composite. A renderer measuring its backings at load takes four, fewer than one plane's.
 */
const PLANE_SLOTS = 7;
/** The uniform slots a frame's bloom takes: a gaussian's two passes. */
const BLOOM_SLOTS = 2;

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
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn paper(@builtin(global_invocation_id) id: vec3u) {
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
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn group(@builtin(global_invocation_id) id: vec3u) {
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
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn group(@builtin(global_invocation_id) id: vec3u) {
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

type Box = StampPixelBox;

/**
 * What a bank's deposits are drawn with beyond their stamps: their regions (LoadedRegions), their washes' landings,
 * the wet stages planned for those, and each wash drying by the deposit it ends after.
 */
type BankHome = {
  regions: LoadedRegions;
  landings: ReadonlyMap<CompiledStampDeposit, StampWetLanding>;
  stages: StampWetStagePlans;
  dryingsByLast: ReadonlyMap<CompiledStampDeposit, StampWashDrying>;
};

/** A bank with no wash: no stage planned. */
const NO_WET_STAGES: StampWetStagePlans = { deposit: [], drying: [] };

/** A set of deposits on the GPU (loadBank), what they're drawn with (`home`), and how to free them. */
type DepositBank = { deposits: ReadonlyMap<CompiledStampDeposit, StampLoadedDeposit>; home: BankHome; destroy: () => void };

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
export type StampDepositTrace = {
  crop: StampPixelBox; built: Float32Array; stages: { stage: StampResolveStage; coverage: Float32Array }[]; coverage: Float32Array;
  /** The main layer's accumulator before it resolves: its build (the mask) and densest stamp (the cap's). */
  accumulator: { built: Float32Array; densest: Float32Array };
};

/** A frame's traces: each traced deposit's request and where its slots start in `buffer`, in floats. */
type FrameTrace = { deposits: Map<CompiledStampDeposit, { request: StampDepositTraceRequest; order: number; offset: number }>; buffer: GPUBuffer };

/**
 * A bank's regions: each flood's barrier by its deposit (CompiledStampFlood's, within the deposit's `within`), each
 * state of the fluid a deposit or a wash's preparation lands under, each deposit's `within`, and each wash's
 * preparation (within its pass's `within`).
 */
type LoadedRegions = {
  barriers: ReadonlyMap<CompiledStampDeposit, StampRegionTexture | null>;
  fluids: ReadonlyMap<CompiledStampMask, StampRegionTexture | null>;
  withins: ReadonlyMap<CompiledStampDeposit, StampRegionTexture | null>;
  preparations: ReadonlyMap<CompiledStampPass, StampRegionTexture | null>;
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

/**
 * The painting frame to frame for paper's transport (vid-151): its groups posed `from` one moment `to` another, paint
 * as at `t` in `state`, which is what's laid.
 */
export type StampTransportRequest = { readonly t: number; readonly state?: StampPaintFrameState; readonly from: StampPosedMoment; readonly to: StampPosedMoment };

/**
 * Each painted plane's transport layer by plane id: stage-sized rgba16float, the motion layer's (lens-passes.ts) shape,
 * written over each travelling group's whole region, a later group over an earlier: its travel, painting px; 0; cover.
 * TEXTURE_BINDING and COPY_SRC. A still group writes none: paper under it stays.
 */
export type StampTransportLayers = ReadonlyMap<string, GPUTexture>;

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
  /**
   * Each painted plane's transport over `request`: how far its paint is carried from one moment to the other, apart
   * from any lens or shutter. Resolves once the GPU has it; the layers are the renderer's, rewritten by the next call.
   */
  transport: (request: StampTransportRequest) => Promise<StampTransportLayers>;
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
  const { paper } = painting;
  const { owner } = surface;
  const span = profile ?? (() => () => {});
  const stage = given ?? stampStage({ width: surface.width, height: surface.height });
  if (stage.frame.width !== surface.width || stage.frame.height !== surface.height) {
    throw new Error(`stamp paint: the stage's frame is ${stage.frame.width} × ${stage.frame.height}, and its surface ${surface.width} × ${surface.height}`);
  }
  checkStampLensSources(planes, sources, stage);
  let done = span('stamp paint compositor load');
  const choice = stampPaintCompositorFor(stampMixedPainting(painting)), { compositorOn, media } = choice;
  // A set of groups' washes land as their waits schedule them, each deposit's reach as far as its wet stages read.
  const wetReach = (deposit: CompiledStampDeposit, medium: PaintMedium, water: number) => stampWetStageReach(wetStages, deposit, medium, water);
  const wetnessOf = choice.wet ? (groups: CompiledStampPaint, tips: StampTipsOf) => compileStampWetness(groups, choice.media, tips, wetReach) : null;
  done();

  done = span('stamp paint images load');
  // Brushed masks' marks are drawn too, though they lay no paint.
  const brushedMasks = stampPaintingBrushedMasks(painting);
  const deposits = painting.groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass)));
  const brushes = await bindStampPaintBrushes(owner, { deposits, marks: brushedMasks.flatMap(({ marks }) => marks), paper });
  done();

  const scope = owner.scope();
  try {
    const loading = owner.checked('loading the painting onto the GPU', () => rendererOnSurface({
      surface, stage, scope, compositorOn, wetnessOf: wetnessOf && ((groups) => wetnessOf(groups, brushes.tipsOf)), media, painting, brushes, brushedMasks,
      wetStages, wetReach, planes, sources, span,
    }));
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
 * What rendererOnSurface loads a painting from: the surface, stage and scope, the mixing's binding, the bound brushes
 * and brushed masks' marks, the wet stages and how far past a deposit they reach, and the planes and their sources.
 */
type StampRendererLoad = {
  surface: StampPaintSurface; stage: StampStage; scope: StampPaintGpuScope; compositorOn: (device: StampPaintDevice) => StampPaintCompositor;
  wetnessOf: ((groups: CompiledStampPaint) => StampWetness) | null; media: StampPaintMedia; painting: CompiledStampPaint;
  brushes: StampPaintBrushes; brushedMasks: readonly CompiledStampBrushedMask[];
  wetStages: readonly StampWetStage[]; wetReach: (deposit: CompiledStampDeposit, medium: PaintMedium, water: number) => number;
  planes: StampLaidPlanes; sources: ReadonlyMap<string, StampLensSource>; span: FrameProfileStart;
};

/**
 * The renderer for `painting`, made in `scope`, its targets `stage`-sized. Runs within one of the surface's checks, so
 * it never awaits. A Box is in stage texels (a painting point plus the margin), a region's in painting points.
 */
function rendererOnSurface({
  surface, stage, scope, compositorOn, wetnessOf, media, painting, brushes, brushedMasks, wetStages, wetReach, planes, sources, span,
}: StampRendererLoad): StampPaintRenderer {
  const { paper } = painting;
  const { width, height, frame, margin } = stage, { format, owner } = surface, { device } = scope;
  const { image, tipFootprint } = brushes;
  let done = span('stamp paint compositor gpu load');
  const compositor = compositorOn(device);
  done();

  // A frame's uniform slots: each pass's, a wash's start and its deposits'. A boil's epoch has its group's deposits.
  const passSlots = (pass: CompiledStampPass) => stampDepositUniformSlots(compositor, { wash: pass.kind === 'wash', deposits: stampPassDeposits(pass).length });
  // Each group's lays (on paper or white and, on a clear plane, on black), glow occlusion and source; each plane's and
  // the bloom's.
  const frameSlots = (1 + planes.nearer.length) * PLANE_SLOTS + BLOOM_SLOTS + painting.groups.reduce((sum, group) => sum + 4 + group.passes.reduce((n, pass) => n + passSlots(pass), 0), 0);
  // Drawing the brushed masks at load takes the same slots, four a mark: its stamps and dual's, its cover's two.
  const slotsPerFrame = Math.max(frameSlots, 4 * brushedMasks.reduce((sum, { marks }) => sum + marks.length, 0));
  const asWritten = new Map(painting.groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass).map((deposit) => [deposit.id, deposit] as const))));
  const paperTooth = stampPaperTooth(paper, image, frame);

  /**
   * `groups`' deposits on the GPU, and what they're drawn with, their washes landing as `wetness` says: the painting
   * as written, a boil's epoch (epochOf) or a group's live marks (liveOf), each wet by its own marks, its regions and
   * wet stages its own. `scoped`: made in a scope of its own, destroyed as it's given up or the painting disposed.
   */
  function loadBank(groups: readonly CompiledStampGroup[], wetness: StampWetness | null, scoped: boolean): DepositBank {
    const bankScope = scoped ? owner.scope() : null, on = bankScope?.device ?? device;
    const entries = groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass).map((deposit): StampDepositToLoad => {
      // An epoch or live marks place their marks afresh, but their brush and paint are the deposit's as written.
      const identity = asWritten.get(deposit.id)!, medium = media.mediumOf(group);
      return { deposit, identity, brush: brushes.deposits.get(identity)!, medium, wash: stampDepositWashLaw(identity, medium, pass.kind === 'wash', media) };
    })));
    const deposits = loadStampDepositBank(on, { stage, tipFootprint, compositor, wetReach }, entries);
    // Each wash deposit's whole box, every stamp shown: the most a frame's box for it is, which its stages plan for.
    const home = loadHome(groups, wetness, on, (deposit) => {
      const loaded = deposits.get(deposit);
      return loaded?.wash ? loaded.box : null;
    });
    return { deposits, home, destroy: () => bankScope?.destroy() };
  }
  /** What `groups`' deposits are drawn with, made through `on`: their regions, and wet stages planned for `wetness`, each wash deposit's whole box `boxOf`. */
  function loadHome(groups: readonly CompiledStampGroup[], wetness: StampWetness | null, on: StampPaintDevice, boxOf: StampWetBank['boxOf']): BankHome {
    let loaded = span('stamp paint regions load');
    const regions = loadRegions(groups, on);
    loaded();
    loaded = span('stamp paint wet stages load');
    let stages = NO_WET_STAGES;
    if (wetness?.landings.size) {
      const bank: StampWetBank = {
        device: on, landings: wetness.landings, dryings: [...wetness.washes.values()].flatMap((record) => record.dryings), boxOf,
        wallOf: (deposit) => stampDepositWall(regions, deposit, margin),
      };
      stages = planStampWetStages(loadedWetStages(), bank);
    }
    loaded();
    const dryingsByLast = new Map([...wetness?.washes.values() ?? []].flatMap((record) => record.dryings).map((drying) => [drying.deposits.at(-1)!, drying]));
    return { regions, landings: wetness?.landings ?? new Map(), stages, dryingsByLast };
  }
  // Every deposit of a wash lands (StampWetness's landings), which only its wetness, worked out in `finish`, says how.
  const washes = painting.groups.some((group) => group.passes.some((pass) => pass.kind === 'wash' && stampPassDeposits(pass).length));
  done = span('stamp paint pipelines load');

  // Each frame's uniforms, and each of the load's own submits'.
  const uniforms = createStampUniformArena(device, slotsPerFrame), { slot } = uniforms;

  // Each frame's lattice triangles, uploaded with its uniforms, in room grown for the most a frame has laid through
  // one (latticeRoom).
  let latticeStaging = new Float32Array(0), latticeVertices: GPUBuffer | null = null, latticeUsed = 0;

  const { linearClamp, mirrorTile } = stampPaintSamplers(device);

  const computePipeline = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });
  const pipelines = { group: computePipeline(groupWgsl(compositor, false, stage)), paper: computePipeline(paperWgsl(compositor, stage)) };
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
  const laysOf = painting.groups.map((_, index) => (planes.nearer.some((plane) => plane.kind === 'painted' && plane.groups.includes(index)) ? 2 : 1));
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
  const dithered = format.endsWith('8unorm');
  const outputPipeline = (() => {
    const module = device.createShaderModule({ code: outputWgsl(compositor, dithered, stage) });
    return device.createRenderPipeline({ layout: 'auto', vertex: { module }, fragment: { module, targets: [{ format }] } });
  })();

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
    touch: washes ? target('touch', width, height, RENDER, 'r16float') : null,
    fresh: washes ? layered('fresh', compositor.targets.layer, STORAGE) : null,
    // And keeps its wet history (stamp-wet-field.ts), and each deposit's landing.
    wetPaper: washes ? target('wetPaper', width, height, STORAGE, STAMP_WET_FIELD_FORMATS.paper) : null,
    wetRim: washes ? target('wetRim', width, height, STORAGE | RENDER, STAMP_WET_FIELD_FORMATS.rim) : null,
    wetLanding: washes ? target('wetLanding', width, height, STORAGE, STAMP_WET_FIELD_FORMATS.landing) : null,
    wetScale: washes ? target('wetScale', width, height, STORAGE, STAMP_WET_FIELD_FORMATS.scale) : null,
  };
  const wetField = targets.wetPaper && stampWetField(device, stage, { paper: targets.wetPaper, rim: targets.wetRim!, landing: targets.wetLanding!, scale: targets.wetScale! }, targets.blank.view);

  const depositTargets: StampDepositTargets = {
    layer: targets.layer, mask: targets.mask, cap: targets.cap, blurA: targets.blurA, blurB: targets.blurB, clip: targets.clip, blank: targets.blank,
    tints: targets.tintA && targets.tintB && { a: targets.tintA.view, b: targets.tintB.view },
    press: compositor.reads.press ? target('press', width, height, RENDER, 'r16float').view : null,
    before: compositor.reads.before ? layered('before', compositor.targets.layer, GPUTextureUsage.COPY_DST) : null,
    wet: wetField && { field: wetField, touch: targets.touch!.view, footprint: targets.footprint!, fresh: targets.fresh! },
  };
  const depositDrawing = createStampDepositDrawing(device, { stage, compositor, targets: depositTargets, arena: uniforms, tipFootprint });

  const bindGroup = (pipeline: GPURenderPipeline | GPUComputePipeline, resources: (GPUBindingResource | null)[]) => stampBindGroup(device, pipeline, resources);
  /** `pipeline` over `w` x `h`. */
  const dispatch = (encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, resources: (GPUBindingResource | null)[], w: number, h: number) =>
    dispatchStampCompute(device, encoder, pipeline, resources, w, h);

  // A wet stage asks the compositor about the deposits it knows; an epoch's or live marks' own are painted as the
  // deposit as written.
  const stageWash: StampWashLayer | undefined = compositor.wash && {
    ...compositor.wash,
    layersOf: (deposit) => compositor.wash!.layersOf(asWritten.get(deposit.id)!),
    movedWgsl: (deposit) => compositor.wash!.movedWgsl(asWritten.get(deposit.id)!),
    holdWgsl: (deposit) => compositor.wash!.holdWgsl(asWritten.get(deposit.id)!),
  };
  let wetStagesLoaded: StampLoadedWetStages | null = null;
  /** The wet stages, loaded once the first bank with washes plans them: every bank shares their pipelines and scratch. */
  const loadedWetStages = () => (wetStagesLoaded ??= depositDrawing.wash!.loadStages(wetStages, stageWash!));
  done();
  // The painting's deposits as written, loaded once the brushed masks its regions read are drawn.
  let writtenBank: DepositBank;

  /**
   * Works out, once a bank, what of `groups` doesn't change with time (stamp-region-textures.ts): each flood's barrier,
   * each state of the fluid a deposit or a wash's preparation lands under, each deposit's `within` and each wash's
   * preparation, made through `on`.
   */
  function loadRegions(groups: readonly CompiledStampGroup[], on: StampPaintDevice): LoadedRegions {
    const passes = groups.flatMap((group) => group.passes);
    const coverages: StampRegionCoverage[] = [];
    /** Each region's index among `coverages`, by what it bounds. */
    const coverageOf = <K,>(entries: readonly (readonly [K, StampRegionCoverage])[]) => entries.map(([key, coverage]) => [key, coverages.push(coverage) - 1] as const);
    const barriers = coverageOf(passes.flatMap((pass) => stampPassDeposits(pass).flatMap((deposit) => (deposit.kind === 'flood' ? [[deposit, { area: deposit.flood.barrier, clips: withinAreas(pass, deposit) }] as const] : []))));
    // A deposit's `within` is its pass's area, clipped to each of its applications'.
    const withins = coverageOf(passes.flatMap((pass) => stampPassDeposits(pass).flatMap((deposit) => {
      const [area, ...clips] = withinAreas(pass, deposit);
      return area ? [[deposit, { area, clips }] as const] : [];
    })));
    const preparations = coverageOf(passes.flatMap((pass) => (pass.kind === 'wash' && pass.wash.preparation ? [[pass, { area: { polygon: pass.wash.preparation.polygon, seed: 0 }, clips: pass.within ? [pass.within] : [] }] as const] : [])));
    const fluids = [
      ...passes.flatMap((pass) => stampPassDeposits(pass)).flatMap((deposit) => (deposit.mask ? [deposit.mask] : [])),
      ...passes.flatMap((pass) => (pass.kind === 'wash' && pass.wash.preparation?.held ? [pass.wash.preparation.held] : [])),
    ];
    const encoder = device.createCommandEncoder();
    const made = encodeStampRegionTextures(on, encoder, { stage, blank: targets.blank.view }, { coverages, fluids, brushed: brushedMaskTextures });
    device.queue.submit([encoder.finish()]);
    const texturesOf = <K,>(indices: readonly (readonly [K, number])[]) => new Map(indices.map(([key, index]) => [key, made.coverages[index]]));
    return { barriers: texturesOf(barriers), fluids: made.fluids, withins: texturesOf(withins), preparations: texturesOf(preparations) };
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
      if (map) box = stampStageTexelsWithin(stage, x0, y0, x1, y1);
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
      const texture = owner.target(name, { size: [w, h, layers], format: 'rgba16float', usage: STORAGE | RENDER | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
      planeTargets.set(key, { texture, view: texture.createView({ dimension: layers > 1 ? '2d-array' : '2d' }), array: stampArrayView(texture) });
    }
    return planeTargets.get(key)!;
  };
  const stageBox: Box = { x: 0, y: 0, w: width, h: height };
  // The frame's lens: composites the planes' pictures, blooms what glows and writes the frame (lens-compositor.ts).
  const lensGpu = createLensCompositor(owner.webgpu, { ...frame, blurExtent: stampLensSourcesBlurExtent(stage, sources) });
  const sourceLayers = createStampLensSourceLayers(owner, { stage, lens: lensGpu, sources });

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
    dispatch(encoder, planePipeline('light', () => stampPlaneLightWgsl(compositor, STAMP_WORKGROUP)), [slot((views) => {
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
  const backingLight = planes.nearer.some((plane) => plane.kind === 'painted')
    ? device.createTexture({ size: [1, 1, 2], format: 'rgba16float', usage: STORAGE | GPUTextureUsage.TEXTURE_BINDING })
    : null;
  /** Measures backingLight, submitted on its own so no frame can be drawn before it. */
  function measureBackings(light: GPUTexture) {
    uniforms.reset();
    const encoder = device.createCommandEncoder(), corner: Box = { x: 0, y: 0, w: 1, h: 1 };
    for (const [layer, backing] of (['white', 'black'] as const).entries()) {
      drawPaper(encoder, backing, 1, 1);
      measureLight(encoder, corner, stampArrayView(light), layer);
    }
    uniforms.flush();
    device.queue.submit([encoder.finish()]);
  }
  /**
   * Adds group `groupFrame`'s glow over `laid` (its box, and its rest map for a moved group) to the plane's emission:
   * its light past the glow's threshold, as much as it covers.
   */
  function addGlow(encoder: GPUCommandEncoder, { group, glow, visibility }: StampGroupFrame, laid: { box: Box; rest: GPUTextureView | null }) {
    const cover = laid.rest ? 'moved group' : 'group';
    const pipeline = planePipeline(`glow|${cover}`, () => stampGlowSourceWgsl(compositor, cover, stage, STAMP_NO_REST, STAMP_WORKGROUP));
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
    const pipeline = planePipeline(`glow occlusion|${cover}`, () => stampGlowOcclusionWgsl(compositor, cover, stage, STAMP_NO_REST, STAMP_WORKGROUP));
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
    if (layers.emission !== null) clearStampTarget(encoder, emissionTarget().view);
    if (travelling) clearStampTarget(encoder, motionTarget().view);
    const motion = travelling && planeMotion ? { into: motionTarget().view, travels: planeMotion.travels, cover: stampMotionCover(planeMotion.span) } : undefined;
    const laidBox = layPlaneGroups(encoder, planeGroups, groups, { whole, frameTrace, backing: first, motion });
    const box = layers.kind === 'film' ? laidBox : stageBox;
    if (!box) return null;
    const note: StampPictureNote = { ...layers, box };
    const [texture] = pictures.make(key, encoder, [{ width: box.w, height: box.h, layers: stampPlanePictureLayerCount(layers), format: 'rgba16float', usage: STORAGE | GPUTextureUsage.TEXTURE_BINDING }], note).textures;
    if (layers.kind === 'film') {
      // Between the lays the picture's colour layer holds the light on white over its box; the picture pass replaces it.
      measureLight(encoder, box, stampArrayView(texture), 0);
      drawPaper(encoder, 'black');
      layPlaneGroups(encoder, planeGroups, groups, { whole, backing: 'black' });
    }
    const pipeline = planePipeline(`picture|${stampPlanePictureLayersKey(layers)}`, () => stampPlanePictureWgsl(compositor, layers, STAMP_WORKGROUP));
    dispatch(encoder, pipeline, [slot((views) => {
      const put = gpuUniformWriter(STAMP_PLANE_PICTURE, views);
      put('origin', [box.x, box.y]);
      put('extent', [box.w, box.h]);
    }), targets.painting.view, layers.emission !== null ? emissionTarget().view : null, stampArrayView(texture), layers.kind === 'film' ? stampArrayView(backingLight!) : null, layers.motion !== null ? motionTarget().view : null], box.w, box.h);
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
      // Paint hides what moves under it, so a still group writes its stillness; a region carries only what travels.
      const traces = motion && !again && (motion.cover === 'paint' || motion.travels[index]);
      const laid = layGroup(encoder, index, groupFrame, painted, backing, traces ? { into: motion.into, travel: motion.travels[index], cover: motion.cover } : null);
      if (!laid) continue;
      // Before the next group: the layer and the lattice's rest map are this group's until the next one is laid. A
      // glaze leaves the glow under it: dimming it by its tint would take its spectral transmittance.
      if (!again && glowed && groupFrame.group.composite === 'opaque') occludeGlow(encoder, groupFrame, laid);
      if (groupFrame.glow && !again) {
        addGlow(encoder, groupFrame, laid);
        glowed = true;
      }
      laidBox = stampBoxUnion(laidBox, laid.box);
    }
    return laidBox;
  }
  /** `picture` (under `key`) defocused by `sigma`, plane px: kept under its key and the stepped sigma. */
  function blurredPicture(encoder: GPUCommandEncoder, picture: StampPlanePicture, key: string, sigma: number): StampPlanePicture {
    const stepped = lensSigmaStepped(sigma), blurredKey = `${key}|${stepped}`;
    const found = blurredPictures.find(blurredKey, encoder);
    if (found) return { ...found.note, texture: found.textures[0] };
    const { texture: sharp, box: sharpBox, ...layers } = picture;
    const box = stampStageTexelsGrown(stage, sharpBox, lensGaussianReach(stepped)), count = sharp.depthOrArrayLayers;
    const note: StampPictureNote = { ...layers, box };
    const [texture] = blurredPictures.make(blurredKey, encoder, [{ width: box.w, height: box.h, layers: count, format: 'rgba16float', usage: STORAGE | GPUTextureUsage.TEXTURE_BINDING }], note).textures;
    lensGpu.gaussian(encoder, { source: stampArrayView(sharp), into: stampArrayView(texture), layers: count, sigma: stepped, read: sharpBox, sourceAt: sharpBox, box });
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
  // Each group's film, kept on the device so a frame laying it elsewhere copies it back rather than painting it again
  // (stamp-paint-gpu-cache.ts). A film starts clear and reads nothing laid before it, so it's a function of its plan's
  // paintKey: equal keys, equal texels. It holds the painted box grown by the lay's read reach.
  const films = owner.cache.store<{ painted: Box | null }>('film');
  const filmLayers = targets.layer.texture.depthOrArrayLayers;
  /** The box the lay reads round `painted`, held to the stage. */
  const filmBox = (painted: Box) => stampStageTexelsGrown(stage, painted, LAY_READ_REACH);
  /**
   * Group `index`'s film under `paintKey` copied back into the layer target, cleared first when `clean`: its painted
   * box (null for none), or undefined for no film.
   */
  function restoreFilm(encoder: GPUCommandEncoder, key: string, clean: boolean): Box | null | undefined {
    const found = films.find(key, encoder);
    if (!found) return undefined;
    const restored = span('stamp paint film restore');
    const [texture] = found.textures, { painted } = found.note;
    if (clean) for (const view of targets.layer.layers) clearStampTarget(encoder, view);
    if (texture && painted) {
      const held = filmBox(painted);
      copyStampTextureBox(encoder, { texture, x: 0, y: 0 }, { texture: targets.layer.texture, x: held.x, y: held.y }, held);
    }
    restored();
    return painted;
  }
  /** Keeps the layer target, as it'll stand at this point in `encoder`, as the film under `key`, its paint over `painted`. */
  function keepFilm(encoder: GPUCommandEncoder, key: string, painted: Box | null) {
    const held = painted && filmBox(painted);
    const textures = held ? [{ width: held.w, height: held.h, layers: filmLayers, format: targets.layer.texture.format, usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST }] : [];
    const [texture] = films.make(key, encoder, textures, { painted }).textures;
    if (texture && held) copyStampTextureBox(encoder, { texture: targets.layer.texture, x: held.x, y: held.y }, { texture, x: 0, y: 0 }, held);
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
        const bank = loadBank([drawing.marks], wetnessOf?.({ ...painting, groups: [drawing.marks] }) ?? null, true);
        loaded();
        return { marks: drawing.marks, bank };
      });
    }
    if (!drawing.epoch) return { marks: group, bank: writtenBank };
    return bankOf(index, `epoch|${index}|${drawing.epoch}`, STAMP_BOIL_EPOCHS_KEPT, () => {
      const marks = group.boil!.reseeded(drawing.epoch);
      // Wet as its own marks land, its stamps elsewhere than the written ones: what each finds under it is its own.
      return { marks, bank: loadBank([marks], wetnessOf?.({ ...painting, groups: [marks] }) ?? null, true) };
    });
  }

  /**
   * How a deposit of `pass`, loaded as `loaded`, is drawn by its bank's `home`: its regions, and for a wash's its
   * landing and deposit stages, whose randomness a boil's epoch seeds.
   */
  function depositDraw(deposit: CompiledStampDeposit, loaded: StampLoadedDeposit, pass: CompiledStampPass, home: BankHome, { paintAt, epoch }: { paintAt: number; epoch: number }, frameTrace?: FrameTrace): StampDepositDraw {
    const { regions, stages } = home, traced = frameTrace?.deposits.get(loaded.identity);
    // A deposit within a region wholly off the painting lands nowhere: its `within` is an empty texture, read as none.
    // A flood is within its barrier, its region in the deposit's.
    const isWithin = deposit.kind === 'flood' || !!pass.within || !!deposit.within;
    const bounds = { fluid: deposit.mask ? regions.fluids.get(deposit.mask) ?? null : null, within: isWithin ? { region: barrierOf(regions, deposit) } : null, clipped: !!pass.clipTo };
    const wet = loaded.wash && { landing: home.landings.get(deposit)!, plans: stages, seed: paintPigmentSeed(stampBoilSeed(loaded.identity.id, epoch)) };
    const trace = traced ? { buffer: frameTrace!.buffer, offset: traced.offset, crop: traced.request.crop, order: traced.order } : null;
    return { paintAt, tooth: paperTooth, bounds, wet, trace };
  }

  /** Paints group `groupFrame`'s film into the layer target from clear, returning its painted box. */
  function paintFilm(encoder: GPUCommandEncoder, { group, marks: drawing, paintAt }: StampGroupFrame, index: number, frameTrace?: FrameTrace): Box | null {
    const epoch = drawing.kind === 'written' ? drawing.epoch : 0;
    const { marks, bank } = marksOf(index, group, drawing);
    // Unkeyed paint reads the same at any time; a recipe's keyed paint always gives its paintAt.
    const at = { paintAt: paintAt ?? 0, epoch };
    for (const view of targets.layer.layers) clearStampTarget(encoder, view);
    let painted: Box | null = null;
    const { wash } = depositDrawing, { home } = bank;
    for (const pass of marks.passes) {
      // A bank's regions and stages know its own marks' passes.
      if (!pass.clipTo) clearStampTarget(encoder, targets.clip.view);
      if (pass.kind === 'wash' && wash) wash.prepare(encoder, washStart(pass, home.regions));
      for (const deposit of stampPassDeposits(pass)) {
        const loaded = bank.deposits.get(deposit)!;
        painted = stampBoxUnion(painted, depositDrawing.drawDeposit(encoder, deposit, loaded, depositDraw(deposit, loaded, pass, home, at, frameTrace)));
        const drying = home.dryingsByLast.get(deposit);
        if (drying) painted = stampBoxUnion(painted, wash!.dry(encoder, drying, home.stages, paintPigmentSeed(stampBoilSeed(drying.id, epoch))));
      }
    }
    return painted;
  }

  const lensFrameOf = createStampLensFrames(lensGpu);

  /**
   * Encodes `paintFrame`. `whole` paints every group afresh, keeping only the films a clear plane lays again: for a
   * traced frame and a read-back layer. `renders`: what the source planes rendered for it. One painted plane at rest,
   * nothing glowing or moving, is output as painted; else each picture is laid where the lens puts it.
   */
  function draw(paintFrame: StampPaintFrame, renders: StampSourceRenders, { frameTrace, whole = frameTrace !== undefined }: { frameTrace?: FrameTrace; whole?: boolean } = {}) {
    owner.assertLive();
    const { t, state } = paintFrame, lensFrame = paintFrame.kind === 'once' ? null : paintFrame.lens;
    const groups = paintFrame.kind === 'exposure' ? stampFramePlanExposed(painting, { t, state }, { t: paintFrame.exposure.at, state: paintFrame.exposure.state }) : stampFramePlan(painting, t, state);
    uniforms.reset();
    latticeUsed = 0;
    latticeRoom(groups);
    const glows = groups.some(({ visibility, glow }) => visibility && glow);
    if (glows && !lensFrame) throw new Error(`stamp paint: a group glows at ${t} s, and only a lens blooms it: draw the paintFrame through a camera's lens (paint-camera.ts)`);
    const lookOf = (id: string) => lensFrame?.planes.get(id) ?? STAMP_REST_LOOK;
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
    const moving = paintFrame.kind === 'fast' && (!!planeMotion || renders.moved.size > 0 || [...paintFrame.lens.planes.values()].some(({ shutter }) => shutter));
    if (back.kind === 'painted' && paintFrame.kind !== 'exposure' && !nearer.length && !glows && isRest(lookOf(back.id)) && !planeMotion) {
      // The composite of one opaque plane at rest is its painting: shown as it is, not round linear light and back.
      drawPaper(encoder, 'paper');
      layPlaneGroups(encoder, back.groups, groups, { whole, frameTrace, backing: 'paper' });
      output(outputPipeline, [targets.painting.view]);
    } else {
      // Every picture first, as each plane is painted on the one painting target; then laid far to near.
      const planeDraw: StampPlaneDraw = { groups, motion: planeMotion, whole, frameTrace };
      const layerOf = (picture: StampPlanePicture | null, look: StampPlaneLook, clipped: boolean): LensLayer[] => (picture
        ? [{
          picture: stampArrayView(picture.texture), layers: picture, view: look.view, shutter: look.shutter,
          origin: { x: picture.box.x - margin, y: picture.box.y - margin }, size: picture.box, clipped, distance: look.distance, distances: 'layer',
        }]
        : []);
      const laying = (id: string, isBack: boolean) => ({ look: lookOf(id), focus: lensFrame?.focus ?? null, moving, back: isBack });
      const layers: LensLayer[] = [back, ...nearer].flatMap((plane, index): LensLayer[] => {
        const look = lookOf(plane.id);
        if (plane.kind !== 'painted') return sourceLayers.layer(encoder, plane, renders, laying(plane.id, index === 0));
        // The back's painting reaches the frame's edge on its paper: it isn't clipped.
        return layerOf(planePicture(encoder, plane, index === 0 ? 'paper' : 'film', look, planeDraw), look, index > 0);
      });
      const { frame: lensFrameExposures, last } = lensFrameOf(paintFrame.kind === 'exposure' ? paintFrame.exposure : undefined);
      lensFrameExposures.exposure(encoder, layers, { glowing: glows, moving });
      // One bloom, of all that glows as the frame shows it, once its exposures are in.
      if (last) {
        lensFrameExposures.develop(encoder, {
          bloom: lensFrame ? { sigma: lensFrame.bloom, strength: 1, glow: 'emission' } : null,
          into: surface.frameTexture().createView(), format, encoding: { kind: 'encoded', dithered },
        });
      }
    }
    uniforms.flush();
    if (latticeUsed) device.queue.writeBuffer(latticeVertices!, 0, latticeStaging, 0, latticeUsed);
    lensGpu.flush();
    return encoder;
  }

  /** Encodes `request`'s transport into each painted plane's layer: its groups laid, each that travels traced over its region. */
  function encodeTransport({ t, state, from, to }: StampTransportRequest): { encoder: GPUCommandEncoder; layers: StampTransportLayers } {
    owner.assertLive();
    const groups = stampFramePlan(painting, t, state), travels = stampFramePlanMotion(painting, { t, state }, { kind: 'transport', from, to });
    uniforms.reset();
    latticeUsed = 0;
    latticeRoom(groups);
    const encoder = device.createCommandEncoder(), layers = new Map<string, GPUTexture>();
    for (const plane of [planes.back, ...planes.nearer].flatMap((laid) => (laid.kind === 'painted' ? [laid] : []))) {
      const into = planeTarget(`transport ${plane.id}`, width, height, 1);
      clearStampTarget(encoder, into.view);
      if (plane.groups.some((index) => travels[index] && groups[index].visibility)) {
        drawPaper(encoder, 'paper');
        layPlaneGroups(encoder, plane.groups, groups, { whole: false, backing: 'paper', motion: { into: into.view, travels, cover: 'region' } });
      }
      layers.set(plane.id, into.texture);
    }
    uniforms.flush();
    if (latticeUsed) device.queue.writeBuffer(latticeVertices!, 0, latticeStaging, 0, latticeUsed);
    return { encoder, layers };
  }

  /** Renders each source plane for `paintFrame`, one after another. */
  const renderSources = (paintFrame: StampPaintFrame) => sourceLayers.render(paintFrame.t, stampLensSourceExposureOf(paintFrame.kind === 'exposure' ? paintFrame.exposure : undefined));

  done = span('stamp paint brushed masks load');
  // Drawn before any bank's regions, which read them.
  uniforms.reset();
  const brushedEncoder = device.createCommandEncoder();
  const brushedMaskTextures = encodeStampBrushedMasks(device, brushedEncoder, depositDrawing, brushedMasks, brushes.marks, paperTooth);
  uniforms.flush();
  device.queue.submit([brushedEncoder.finish()]);
  done();
  if (backingLight) measureBackings(backingLight);

  // A painting whose inputs change in the same commit as its time is disposed before its last draw is asked for.
  let disposed = false;
  // A frame's own read-back buffers are the owner's, made and destroyed by the frame.
  const { queue } = owner.device;
  let loading = span('stamp paint wetness load');
  const wetness = wetnessOf?.(painting) ?? null;
  const wetReport = wetness && stampWetReport(painting, wetness);
  const strictFailures = wetReport ? stampWetReportStrictFailures(wetReport) : [];
  if (strictFailures.length) throw new Error(`stamp paint: ${strictFailures.length} strict failure(s):\n${strictFailures.join('\n')}`);
  const wetWarnings = wetReport ? stampWetReportWarnings(wetReport) : [];
  loading();
  loading = span('stamp paint bank load');
  writtenBank = loadBank(painting.groups, wetness, false);
  loading();
  return {
    stage,
    wetness,
    wetWarnings,
    draw: async (paintFrame) => {
      if (disposed) return;
      const renders = await renderSources(paintFrame);
      await owner.checked(`drawing the painting at ${paintFrame.t} s`, () => queue.submit([draw(paintFrame, renders).finish()]));
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
        floats += crop.w * crop.h * STAMP_TRACE_SLOTS;
      }
      const bytes = Math.max(4, floats * 4);
      const traceBuffer = owner.device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const read = owner.device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      try {
        const renders = await renderSources(paintFrame);
        await owner.checked(`tracing the painting at ${paintFrame.t} s`, () => {
          const encoder = draw(paintFrame, renders, { frameTrace: { deposits: traced, buffer: traceBuffer } });
          encoder.copyBufferToBuffer(traceBuffer, 0, read, 0, bytes);
          queue.submit([encoder.finish()]);
        });
        await read.mapAsync(GPUMapMode.READ);
        const all = new Float32Array(read.getMappedRange().slice(0));
        read.unmap();
        return requests.map(({ deposit, crop }) => {
          const { order, offset } = traced.get(deposit)!, plane = crop.w * crop.h;
          const at = (index: number) => all.slice(offset + index * plane, offset + (index + 1) * plane);
          return {
            crop, built: at(0), stages: STAMP_RESOLVE_ORDERS[order].map((resolveStage, k) => ({ stage: resolveStage, coverage: at(k + 1) })), coverage: at(STAMP_TRACE_SLOTS - 1),
            accumulator: { built: at(STAMP_TRACE_ACCUMULATOR), densest: at(STAMP_TRACE_ACCUMULATOR + 1) },
          };
        });
      } finally {
        traceBuffer.destroy();
        read.destroy();
      }
    },
    transport: async (request) => {
      if (disposed) throw new Error('stamp paint: a disposed renderer carries nothing');
      const { encoder, layers } = encodeTransport(request);
      await owner.checked(`transport from ${request.from.at} s to ${request.to.at} s`, () => queue.submit([encoder.finish()]));
      return layers;
    },
    readLayer: async (paintFrame) => {
      if (disposed) throw new Error('stamp paint: a disposed renderer reads back nothing');
      const layers = targets.layer.layers.length, rowBytes = Math.ceil((width * 8) / 256) * 256;
      const read = owner.device.createBuffer({ size: rowBytes * height * layers, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      try {
        const renders = await renderSources(paintFrame);
        await owner.checked(`reading back the layer at ${paintFrame.t} s`, () => {
          const encoder = draw(paintFrame, renders, { whole: true });
          encoder.copyTextureToBuffer({ texture: targets.layer.texture }, { buffer: read, bytesPerRow: rowBytes, rowsPerImage: height }, [width, height, layers]);
          queue.submit([encoder.finish()]);
        });
        await read.mapAsync(GPUMapMode.READ);
        const halves = new Uint16Array(read.getMappedRange()), values = new Float32Array(width * height * 4 * layers);
        for (let l = 0; l < layers; l++) {
          for (let y = 0; y < height; y++) {
            const from = (l * height + y) * (rowBytes / 2), to = (l * height + y) * width * 4;
            for (let i = 0; i < width * 4; i++) values[to + i] = gpuHalfValue(halves[from + i]);
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
}

/** What `plane`'s picture shows this frame: each of its groups' film, lay, warp, visibility, glow and motion. */
const pictureKey = (plane: { id: string; groups: readonly number[] }, { groups, motion }: StampPlaneDraw) => JSON.stringify([plane.id, plane.groups.map((index) => {
  const { paintKey, lay, warp, visibility, glow } = groups[index];
  return visibility ? [paintKey, lay, warp && [warp.key, warp.cell], visibility, glow, motion?.travels[index]?.key] : null;
}), motion?.span ?? null]);
const isRest = ({ view, defocus, shutter }: StampPlaneLook) => view.ma === 1 && view.mb === 0 && view.kx === 0 && view.ky === 0 && !defocus && !shutter;
const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
const rgb = (hex: string): [number, number, number] => [channel(hex, 1), channel(hex, 3), channel(hex, 5)];
/** The barrier `deposit` of `pass` lands within, from `regions`: a flood's region, walled or lost, else its pass's `within`. */
const barrierOf = (regions: LoadedRegions, deposit: CompiledStampDeposit) =>
  (deposit.kind === 'flood' ? regions.barriers.get(deposit) : regions.withins.get(deposit)) ?? null;
const stageWalls = new WeakMap<StampRegionTexture, StampWetWall>();
/**
 * The wall `deposit` dries against (StampWetBank's wallOf), its box in stage texels, `margin` past its painting
 * point's: its barrier if walled (stampDepositWalled), else its `within`. One wall a region, so a drying's walls dedupe.
 */
function stampDepositWall(regions: LoadedRegions, deposit: CompiledStampDeposit, margin: number): StampWetWall | null {
  const region = stampDepositWalled(deposit) ? barrierOf(regions, deposit) : regions.withins.get(deposit) ?? null;
  if (!region) return null;
  if (!stageWalls.has(region)) stageWalls.set(region, { view: region.view, box: { ...region.box, x: region.box.x + margin, y: region.box.y + margin } });
  return stageWalls.get(region)!;
}

/** `pass`'s preparation as its wash starts on it (as its bank's `regions` know it), or null for dry paper. */
function washStart(pass: Extract<CompiledStampPass, { kind: 'wash' }>, regions: LoadedRegions): StampWashStart | null {
  const { preparation } = pass.wash;
  return preparation && {
    wetness: preparation.wetness, region: regions.preparations.get(pass) ?? null, fluid: preparation.held ? regions.fluids.get(preparation.held) ?? null : null,
  };
}

/** The areas `deposit` of `pass` lands within: its pass's and its own. */
const withinAreas = (pass: CompiledStampPass, deposit: CompiledStampDeposit) => [...(pass.within ? [pass.within] : []), ...(deposit.within ?? [])];

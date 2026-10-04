// stamp-deposit-drawing.ts: draws a deposit its bank loaded (stamp-deposit-bank.ts) onto its group's layer, for the
// renderer and any other driver alike. Within its box in Photoshop's order: a render pass stamps its coverage mask (a
// wash deposit's touch too, or a dry one's pressure), compute passes blur it, and a compute pass resolves it; a wash
// deposit's water lands in the wet field in that pass, and its deposit stages run after.
//
// What may change between draws is given with each: the landing and its planned stages, the paper's tooth, the
// bounding regions, the paint's time. Targets are given once, the caller's to share or own; a wash's start, stages
// and dryings use them too (`wash`).

import type { StampBrushAsset } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampDualModeIndex } from '#lib/paint/brush/models/coverage-formulas.ts';
import { PAINT_DRY_BURNISHED_PRESS } from '#lib/paint/materials/models/paint-paper.ts';
import { GPU_GAUSSIAN_PASS, gpuGaussianPassWgsl } from '#lib/platform/gpu/models/gpu-gaussian.ts';
import { gpuUniformWriter, type GpuUniformViews } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { stampBlurRegion, type StampPixelBox } from '../models/stamp-blur-region.ts';
import { STAMP_ACCUMULATIONS, stampAccumulationBuild, stampAccumulationIndex, type StampActiveLayer } from '../models/stamp-deposit-stages.ts';
import { STAMP_FLOATS, STAMP_ORDERED_TILE, TINT_FLOATS } from '../models/stamp-mark-load.ts';
import { stampPaintFieldEnds } from '../models/stamp-paint-field.ts';
import type { StampSeededPaintField } from '../models/stamp-paint-field.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe-compile.ts';
import type { StampPaintPaper } from '../models/stamp-paint-recipe-types.ts';
import { STAMP_WRAP_FROM_NONE, stampAxisWords, stampBoxUnion, stampRegionTexelWords, stampStageTexelsGrown, stampStageTile, type StampStage } from '../models/stamp-stage.ts';
import { STAMP_TIP_HULL_SIDES, type StampTipHull } from '../models/stamp-tip-hull.ts';
import type { StampTipFootprint } from '../models/stamp-tip-support.ts';
import { stampTipFullContact } from '../models/stamp-wet-contact.ts';
import type { StampWashDrying, StampWetLanding } from '../models/stamp-wetness.ts';
import type { StampBoundLayer, StampLoadedDeposit, StampLoadedMarks, StampLoadedPlan, StampPlacedMarks } from './stamp-deposit-bank.ts';
import {
  STAMP_DEPOSIT, STAMP_DEPOSIT_FLAGS, STAMP_DEPOSIT_KEEP, STAMP_DEPOSIT_WET_OP, STAMP_TRACE_CROP, STAMP_WET_ACTIONS, STAMP_WET_BODY_REACH, stampDepositResolveWgsl,
} from './stamp-deposit-resolve-wgsl.ts';
import { STAMP_DRAW, STAMP_ORDERED_DRAW, stampDrawWgsl, stampGrainLod, stampOrderedDrawWgsl, writeStampGrain } from './stamp-deposit-stamp-wgsl.ts';
import type { StampPaintCompositor, StampWashLayer } from './stamp-paint-compositor.ts';
import {
  copyStampTextureBox, dispatchStampCompute, STAMP_MAX_BLEND, STAMP_WORKGROUP, stampArrayView, stampBindGroup, stampPaintBuffer, stampPaintSamplers,
  type StampPaintDevice, type StampPaintImage,
} from './stamp-paint-gpu.ts';
import type { StampRegionTexture } from './stamp-region-textures.ts';
import { STAMP_UNIFORM_SLOT, type StampUniformArena } from './stamp-uniform-arena.ts';
import { putStampWetLand, putStampWetPrepare, stampDryingWords, type StampWetField } from './stamp-wet-field.ts';
import type { StampLoadedWetStages, StampWetStage, StampWetStageContext, StampWetStagePlans } from './stamp-wet-stages.ts';
import { STAMP_REST_IDENTITY } from '../models/stamp-rest-map.ts';

export type StampDepositTarget = { texture: GPUTexture; view: GPUTextureView };

/**
 * What a drawing writes and reads, each the stage's size: the group's `layer` (a view each of its layers); a deposit's
 * `mask` (rg16float), `cap`, the half-size `blurA` and `blurB`, and the pass's `clip`; a 1 × 1 `blank` bound for what
 * isn't read.
 */
export type StampDepositTargets = {
  layer: StampDepositTarget & { layers: readonly GPUTextureView[] };
  mask: StampDepositTarget; cap: StampDepositTarget; blurA: StampDepositTarget; blurB: StampDepositTarget; clip: StampDepositTarget; blank: StampDepositTarget;
  /** For a compositor laying stamp tints. */
  tints: { a: GPUTextureView; b: GPUTextureView } | null;
  /** For one reading pressure (r16float), and what lay before (shaped as the layer). */
  press: GPUTextureView | null;
  before: StampDepositTarget | null;
  /** For washes: the wet field, and each deposit's `touch` (r16float), `footprint` and `fresh` (shaped as the layer). */
  wet: { field: StampWetField; touch: GPUTextureView; footprint: StampDepositTarget; fresh: StampDepositTarget & { layers: readonly GPUTextureView[] } } | null;
};

/** What a drawing is made for: its stage, compositor and targets, the arena its passes' uniforms come from, and tips' footprints. */
export type StampDepositDrawingOptions = {
  stage: StampStage; compositor: StampPaintCompositor; targets: StampDepositTargets; arena: StampUniformArena;
  tipFootprint: (layer: StampBoundLayer) => StampTipFootprint;
};

/** The paper's tooth as paint lands on it: its grain `image`, tiled `tile` px and read at mip `lod`, taking paint `depth` deep. */
export type StampPaperTooth = { image: StampPaintImage; tile: readonly [number, number]; lod: number; depth: number };

/**
 * `paper`'s tooth on `stage` (null for none), its image by `image`: its size goes by the frame, so a margin leaves it as
 * it was, and its mirrored tiles fit a wrapping stage's wrap whole.
 */
export function stampPaperTooth(paper: StampPaintPaper, image: (asset: StampBrushAsset) => StampPaintImage, stage: StampStage): StampPaperTooth | null {
  if (!paper.grain) return null;
  const grain = image(paper.grain.image), size = paper.grain.scale * stage.frame.width;
  const tile = stampStageTile(stage, [size, size * (grain.height / grain.width)], true);
  return { image: grain, tile, lod: stampGrainLod(grain, tile[0]), depth: paper.grain.depth };
}

/**
 * Where a deposit may lay paint past its stamps: off a state of the masking `fluid` (null for none); `within` a region
 * (null for anywhere; its `region` null when that lies wholly off the stage, so nowhere); within the clip base when
 * `clipped`.
 */
export type StampDepositBounds = { fluid: StampRegionTexture | null; within: { region: StampRegionTexture | null } | null; clipped: boolean };

/**
 * A wash deposit's landing, the wash's stages planned for its bank (its deposit stages run after it), and their seed;
 * `rimmed`, whether a drying's rim draws its wet edge, so its brush's own wet edges stand down.
 */
export type StampDepositWet = { landing: StampWetLanding; plans: StampWetStagePlans; seed: number; rimmed: boolean };

/** A wash's preparation as it starts: its wetness, and its region and the fluid holding it off, null for none on the stage. */
export type StampWashStart = { wetness: StampSeededPaintField<number>; region: StampRegionTexture | null; fluid: StampRegionTexture | null };

/** A traced draw's slots in `buffer` from `offset` (floats) over `crop` (painting points), its stages run in `order`. */
export type StampDepositTraceAt = { buffer: GPUBuffer; offset: number; crop: StampPixelBox; order: number };

/**
 * One draw of a deposit: its paint read at scene time `paintAt`, on the paper's `tooth` (null for none), within
 * `bounds`; `wet` for one its bank laid by the wash law, else null; `trace` to record its resolve.
 */
export type StampDepositDraw = { paintAt: number; tooth: StampPaperTooth | null; bounds: StampDepositBounds; wet: StampDepositWet | null; trace: StampDepositTraceAt | null };

/**
 * The uniform slots drawing `deposits` together takes: a wash's start, then each deposit's stamps and dual's, two blur
 * passes, its resolve, where it's kept, its paint and its trace; and a wash deposit's touch, the paper it finds and
 * its landing, or a dry one's pressure for a compositor that reads it. A drying takes none.
 */
export function stampDepositUniformSlots(compositor: StampPaintCompositor, { wash, deposits }: { wash: boolean; deposits: number }) {
  if (wash) return 1 + deposits * 11;
  return deposits * (compositor.reads.press ? 9 : 8);
}

/** A flag of a deposit's resolve (STAMP_DEPOSIT_FLAGS). */
type StampCoverageFlag = keyof typeof STAMP_DEPOSIT_FLAGS;

/**
 * A layer's canvas grain's tile (a share of its stamps' diameter across, fitting a wrapping `stage`'s wrap whole),
 * offset and mip level, written as a Grain at `at`.
 */
function writeStampCanvasGrain(views: GpuUniformViews, at: number, stage: StampStage, layer: StampActiveLayer<StampPaintImage> | undefined, offset: readonly [number, number]) {
  const grain = layer?.canvasGrain;
  if (!grain) return;
  const size = grain.scale * layer.diameter, tile = stampStageTile(stage, [size, size * (grain.image.height / grain.image.width)], grain.tiling === 'mirror');
  writeStampGrain(views, at, grain, tile, offset, stampGrainLod(grain.image, tile[0]));
}

/** What of STAMP_DEPOSIT_FLAGS `marks`' own coverage resolves with on `tooth`: its grains, dual and pooling, and the paper. */
const stampMarksCoverageFlags = ({ brush, active }: StampLoadedMarks, tooth: StampPaperTooth | null): StampCoverageFlag[] => [
  ...(active.main.canvasGrain ? ['canvasGrain' as const] : []), ...(brush.dual ? ['dual' as const] : []), ...(active.dual?.canvasGrain ? ['dualCanvasGrain' as const] : []),
  ...(tooth ? ['paper' as const] : []),
  ...(active.main.pooling ? ['pooled' as const] : []), ...(active.dual?.pooling ? ['dualPooled' as const] : []),
  ...(brush.dual?.blend.family === 'layer' ? ['dualLayer' as const] : []),
];
const stampCoverageFlagWord = (flags: readonly StampCoverageFlag[]) => flags.reduce((all, flag) => all | STAMP_DEPOSIT_FLAGS[flag], 0);

/** A drawing on `device`, its pipelines made now so a painting that can't draw fails as it loads. */
export function createStampDepositDrawing(device: StampPaintDevice, { stage, compositor, targets, arena, tipFootprint }: StampDepositDrawingOptions) {
  const { width, height, margin } = stage, { slot } = arena, wetTargets = targets.wet;
  const paintBytes = compositor.deposit.layout.words * 4;
  if (paintBytes > STAMP_UNIFORM_SLOT) throw new Error(`stamp paint: a compositor's ${compositor.deposit.layout.name} takes ${paintBytes} bytes, over a uniform slot's ${STAMP_UNIFORM_SLOT}`);
  if (targets.wet && !compositor.deposit.wet) throw new Error('stamp paint: the painting has washes, and its compositor lays none');
  const { linearClamp, anisotropicClamp, tile, mirrorTile } = stampPaintSamplers(device);
  const buffer = (data: Float32Array | Uint16Array | Uint32Array, usage: number) => stampPaintBuffer(device, data, usage);
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
  const noTraceBuffer = buffer(new Float32Array(1), GPUBufferUsage.STORAGE), noTraceCrop = buffer(new Uint32Array(STAMP_UNIFORM_SLOT / 4), GPUBufferUsage.UNIFORM);
  // The fan's triangles, by corner: indexed, so each corner is shaded once a stamp, not once for each triangle it's in.
  const fanBuffer = buffer(new Uint16Array(Array.from({ length: STAMP_TIP_HULL_SIDES - 2 }, (_, i) => [0, i + 1, i + 2]).flat()), GPUBufferUsage.INDEX);
  const tilesX = Math.ceil(width / STAMP_ORDERED_TILE), halfW = Math.ceil(width / 2), halfH = Math.ceil(height / 2);

  // Each stamp moves its stroke toward full or its opacity by its paint: B ← lerp(B, O, t·f). A blend can't see B, so
  // it can't keep a buildToOpacity from lowering it; a layer whose opacity falls is laid in order instead
  // (stampAccumulationPlan), and this blend lays only those whose opacity holds or rises, where it never lowers B.
  const buildBlend: GPUBlendState = { color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  // Tints are laid premultiplied, each stamp over those before it.
  const overBlend: GPUBlendState = { color: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const stampModule = device.createShaderModule({ code: stampDrawWgsl(stage) });
  const stampVertex = (tintStride: number): GPUVertexState => ({
    module: stampModule,
    buffers: [
      { arrayStride: STAMP_FLOATS * 4, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }, { shaderLocation: 3, offset: 32, format: 'float32x4' }, { shaderLocation: 4, offset: 48, format: 'float32x2' }] },
      { arrayStride: tintStride, stepMode: 'instance', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x4' }] },
    ],
  });
  /**
   * A stamp pipeline: its accumulation's blend into the brush's channel or its dual's; in a tinted pass (a brush with
   * colour dynamics) with the two tint targets too, which only the brush's own stamps write.
   */
  const stampPipeline = (glaze: boolean, channel: 0 | 1, tinted: boolean) => {
    const capWrite = channel === 0 ? GPUColorWrite.RED | GPUColorWrite.BLUE : GPUColorWrite.GREEN | GPUColorWrite.ALPHA;
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: stampVertex(tinted && channel === 0 ? TINT_FLOATS * 4 : 0),
      fragment: {
        module: stampModule,
        entryPoint: tinted && channel === 0 ? 'coverTinted' : 'cover',
        targets: [
          { format: 'rg16float', blend: buildBlend, writeMask: channel === 0 ? GPUColorWrite.RED : GPUColorWrite.GREEN },
          { format: 'rgba16float', blend: STAMP_MAX_BLEND, writeMask: glaze ? capWrite : 0 },
          ...(tinted ? [0, 1].map(() => ({ format: 'rgba16float' as const, blend: overBlend, writeMask: channel === 0 ? GPUColorWrite.ALL : 0 })) : []),
        ],
      },
    });
  };
  const stampPipelinesOf = (glaze: boolean) => ({ plain: [stampPipeline(glaze, 0, false), stampPipeline(glaze, 1, false)], tinted: [stampPipeline(glaze, 0, true), stampPipeline(glaze, 1, true)] });
  const stampPipelines = { glaze: stampPipelinesOf(true), build: stampPipelinesOf(false) };
  const orderedModule = device.createShaderModule({ code: stampOrderedDrawWgsl(stage) });
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
  /** Touch and pressure: a dry deposit's main stamps', laid by max, order-free (touchOf, pressOf). */
  const maxStampPipeline = (entryPoint: 'touchOf' | 'pressOf') =>
    device.createRenderPipeline({ layout: 'auto', vertex: stampVertex(0), fragment: { module: stampModule, entryPoint, targets: [{ format: 'r16float', blend: STAMP_MAX_BLEND, writeMask: GPUColorWrite.RED }] } });
  const touchPipeline = targets.wet && maxStampPipeline('touchOf'), pressPipeline = compositor.reads.press ? maxStampPipeline('pressOf') : null;
  const depositModules = {
    dry: device.createShaderModule({ code: stampDepositResolveWgsl(compositor, false, stage) }),
    wet: compositor.deposit.wet ? device.createShaderModule({ code: stampDepositResolveWgsl(compositor, true, stage) }) : null,
  };
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
  depositPipeline(false, false);
  if (targets.wet) depositPipeline(false, true);
  const blurPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: gpuGaussianPassWgsl({ layers: 1, read: 'bilinear', workgroup: STAMP_WORKGROUP }) }) } });
  // The gaussian binds arrays; the mask's targets are plain.
  const maskArrays = { mask: stampArrayView(targets.mask.texture), blurA: stampArrayView(targets.blurA.texture), blurB: stampArrayView(targets.blurB.texture) };
  /** How far round a texel a compositor reading what lay before reads it on `tooth`, px: its grain's reach. */
  const beforeReachOf = (tooth: StampPaperTooth | null) => (targets.before && tooth ? (compositor.reads.before!.reach * tooth.tile[0]) / tooth.image.width : 0);
  const bindGroup = (pipeline: GPURenderPipeline | GPUComputePipeline, resources: (GPUBindingResource | null)[]) => stampBindGroup(device, pipeline, resources);

  /** What drawing `layer`'s stamps binds, the main brush's (`stampChannel` 0) or its dual's. */
  const stampInputs = (grainOffset: CompiledStampDeposit['grainOffset'], layer: StampBoundLayer, active: StampActiveLayer<StampPaintImage>, stampChannel: 0 | 1) => {
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
  /** The fixed path's bindings (STAMP_DRAW) for `layer`'s stamps, each laid toward full or its opacity. */
  const fixedStampResources = (grainOffset: CompiledStampDeposit['grainOffset'], layer: StampBoundLayer, active: StampActiveLayer<StampPaintImage>, hull: StampTipHull, stampChannel: 0 | 1, towardFull: boolean) => {
    const { rolling, diameter, offset, textures, center, contact, pressedWords } = stampInputs(grainOffset, layer, active, stampChannel);
    return [
      slot((views) => {
        const put = gpuUniformWriter(STAMP_DRAW, views);
        put('resolution', [width, height]);
        put('roundness', layer.tip.roundness * (layer.tip.image.height / layer.tip.image.width));
        put('rolling', rolling ? 1 : 0);
        if (rolling) {
          const size = rolling.scale * diameter;
          writeStampGrain(views, STAMP_DRAW.at.grain, rolling, [size, size * (rolling.image.height / rolling.image.width)], offset, 0);
          put('diameter', diameter);
          put('zoom', rolling.zoom);
          put('movement', rolling.movement);
        }
        // A hull has as many corners as stayed convex, up to the array's; the fan draws only those, and the rest are zeros.
        const hullWords = new Float32Array(STAMP_TIP_HULL_SIDES * 2);
        hullWords.set(hull);
        put('hull', hullWords);
        put('span', layer.tip.span ?? 1);
        put('towardFull', towardFull ? 1 : 0);
        put('center', center);
        put('noise', layer.tip.noise ?? 0);
        put('pressed', pressedWords);
        put('fullContact', stampTipFullContact(tipFootprint(layer).levels));
      }),
      ...textures, contact,
    ];
  };

  /**
   * Lays `deposit`'s main stamps in `box` into `view` by `pipeline`, laid by max: a wash deposit's touch (touchOf, its
   * water's contact, which reads no grain) or a dry one's pressure (pressOf).
   */
  function layMaxStamps(encoder: GPUCommandEncoder, pipeline: GPURenderPipeline, view: GPUTextureView, deposit: CompiledStampDeposit, loaded: StampLoadedDeposit, box: StampPixelBox, loadOp: GPULoadOp = 'clear') {
    const count = deposit.stamps.length;
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp, storeOp: 'store' }] });
    pass.setScissorRect(box.x, box.y, box.w, box.h);
    if (count) {
      pass.setIndexBuffer(fanBuffer, 'uint16');
      pass.setPipeline(pipeline);
      const resources = fixedStampResources(deposit.grainOffset, loaded.brush, loaded.active.main, loaded.mainHull, 0, true);
      // Touch reads no grain: its grain and tiling (bindings 2 and 4) aren't in its layout.
      pass.setBindGroup(0, bindGroup(pipeline, pipeline === touchPipeline ? resources.map((resource, binding) => (binding === 2 || binding === 4 ? null : resource)) : resources));
      pass.setVertexBuffer(0, loaded.stampBuffer, loaded.main * STAMP_FLOATS * 4);
      pass.setVertexBuffer(1, noTintBuffer);
      pass.drawIndexed((loaded.mainHull.length / 2 - 2) * 3, count);
    }
    pass.end();
  }

  /** Lays `placed`'s stamps and dual stamps, loaded as `marks`, into the mask and cap (and a tinted pass's tints) within `box`. */
  function drawStamps(encoder: GPUCommandEncoder, marks: StampLoadedMarks, placed: StampPlacedMarks, box: StampPixelBox) {
    const tinted = marks.tint !== null;
    const pass = encoder.beginRenderPass({
      colorAttachments: [targets.mask.view, targets.cap.view, ...(tinted ? [targets.tints!.a, targets.tints!.b] : [])].map((view) => ({ view, loadOp: 'clear' as const, storeOp: 'store' as const })),
    });
    pass.setScissorRect(box.x, box.y, box.w, box.h);
    pass.setIndexBuffer(fanBuffer, 'uint16');
    const stamp = (layer: StampBoundLayer, active: StampActiveLayer<StampPaintImage>, plan: StampLoadedPlan, first: number, n: number, hull: StampTipHull, stampChannel: 0 | 1) => {
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
            const put = gpuUniformWriter(STAMP_ORDERED_DRAW, views);
            put('roundness', layer.tip.roundness * (layer.tip.image.height / layer.tip.image.width));
            put('rolling', rolling ? 1 : 0);
            if (rolling) {
              const size = rolling.scale * diameter;
              writeStampGrain(views, STAMP_ORDERED_DRAW.at.grain, rolling, [size, size * (rolling.image.height / rolling.image.width)], offset, 0);
              put('diameter', diameter);
              put('zoom', rolling.zoom);
              put('movement', rolling.movement);
            }
            put('span', layer.tip.span ?? 1);
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
    pass.end();
  }

  function blurMask(encoder: GPUCommandEncoder, sigma: number, box: StampPixelBox) {
    const halfSigma = Math.max(0.5, sigma / 2);
    const half = stampBlurRegion(box, halfW, halfH);
    // Reached as the GPU would work it out in f32, so the taps match the mask-edge goldens'.
    const taps = Math.min(40, Math.ceil(Math.fround(Math.fround(halfSigma) * 2.5)));
    // The across pass also covers the rows the down pass reaches past the box: blurA outside them holds whatever an
    // earlier deposit or frame left, which would make a frame depend on what was drawn before it.
    const reach = taps + 1;
    const top = Math.max(0, half.y - reach);
    const across = { ...half, y: top, h: half.h + (half.y - top) + reach };
    const blur = (source: GPUTextureView, into: GPUTextureView, axis: 0 | 1, stride: number, region: StampPixelBox) => dispatchStampCompute(device, encoder, blurPipeline, [
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

  /**
   * Writes into a Deposit what `marks`' coverage resolves with, in `resolveOrder`: the view and paper's `tooth`, its
   * grains at `grainOffset`, its dual's blend, its accumulations and pooling (a pooled peak at its body's where
   * `washRims`). Returns the writer, for the rest.
   */
  const writeCoverage = (views: GpuUniformViews, marks: StampLoadedMarks, grainOffset: CompiledStampDeposit['grainOffset'], resolveOrder: number, washRims: boolean, tooth: StampPaperTooth | null) => {
    const { brush, active } = marks, put = gpuUniformWriter(STAMP_DEPOSIT, views);
    put('view', [width, height, tooth?.tile[0] ?? 1, tooth?.tile[1] ?? 1]);
    writeStampCanvasGrain(views, STAMP_DEPOSIT.at.grain, stage, active.main, grainOffset.main);
    writeStampCanvasGrain(views, STAMP_DEPOSIT.at.dualGrain, stage, active.dual, grainOffset.dual);
    put('paperDepth', tooth?.depth ?? 0);
    put('paperLod', tooth?.lod ?? 0);
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

  /** Resolves `deposit` over `box` by `draw`, its mask `blurred` or not; `after`: more work in the resolve's compute pass. */
  function resolveDeposit(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, loaded: StampLoadedDeposit, draw: StampDepositDraw, blurred: boolean, box: StampPixelBox, after?: (pass: GPUComputePassEncoder) => void) {
    const { trace, tooth, wet, bounds: { fluid, within, clipped } } = draw, { active } = loaded;
    // Where a stage rims the deposit's drying (the drying rim, stamp-wet-rim.ts), a brush's own wet edges would rim
    // each stroke again. Its Procreate rim goes, and Photoshop's pooling keeps its body, not its peak.
    const washRims = !!wet && wet.rimmed;
    const edgesOf = (layer?: StampActiveLayer<StampPaintImage>): [number, number, number, number] => (blurred && layer
      ? [washRims ? 0 : layer.rim?.rim ?? 0, layer.rim?.sharpness ?? 0, layer.burntEdge?.strength ?? 0, layer.burntEdge?.sharpness ?? 0] : [0, 0, 0, 0]);
    const mainGrain = active.main.canvasGrain, dualGrain = active.dual?.canvasGrain, tinted = loaded.tint !== null;
    const flags: StampCoverageFlag[] = [
      ...stampMarksCoverageFlags(loaded, tooth), ...(fluid ? ['masked' as const] : []), ...(within ? ['within' as const] : []),
      ...(deposit.kind === 'flood' ? ['flood' as const] : []),
      // Only paint makes a clip base: water and a lift leave where a pass holds paint as it was. A clipped pass's paint
      // makes one of its own beside the base it reads (the resolve's clip store).
      ...(clipped ? ['clipped' as const] : []), ...(deposit.action.kind === 'paint' ? ['clips' as const] : []),
    ];
    dispatchStampCompute(device, encoder, depositPipeline(!!trace, !!wet), [
      slot((views) => {
        const put = writeCoverage(views, loaded, deposit.grainOffset, trace?.order ?? loaded.resolveOrder, washRims, tooth);
        put('edges', edgesOf(active.main));
        put('dualEdges', edgesOf(active.dual));
        put('opacity', deposit.opacity);
        put('flags', stampCoverageFlagWord(flags));
        put('origin', [box.x, box.y]);
        put('extent', [box.w, box.h]);
        put('press', deposit.action.kind === 'paint' && deposit.action.burnish ? PAINT_DRY_BURNISHED_PRESS - 1 : 0);
        put('beforeReach', beforeReachOf(tooth));
      }),
      targets.mask.view, blurred ? targets.blurB.view : targets.mask.view,
      mainGrain ? mainGrain.image.view : targets.blank.view,
      dualGrain ? dualGrain.image.view : targets.blank.view,
      tooth ? tooth.image.view : targets.blank.view,
      fluid?.view ?? targets.blank.view, targets.clip.view, targets.layer.view, linearClamp, tile,
      { buffer: trace ? trace.buffer : noTraceBuffer },
      trace ? slot((views) => {
        const put = gpuUniformWriter(STAMP_TRACE_CROP, views);
        put('origin', [trace.crop.x + margin, trace.crop.y + margin]);
        put('extent', [trace.crop.w, trace.crop.h]);
        put('offset', trace.offset);
      }) : { buffer: noTraceCrop },
      targets.cap.view, mirrorTile,
      slot((views) => {
        const put = gpuUniformWriter(STAMP_DEPOSIT_KEEP, views);
        put('fluid', stampRegionTexelWords(fluid?.box, stage));
        put('within', stampRegionTexelWords(within?.region?.box, stage));
        put('bodyReach', STAMP_WET_BODY_REACH * deposit.diameter);
        put('rest', deposit.rest ?? STAMP_REST_IDENTITY);
        put('wrapFrom', stampAxisWords(deposit.wrapFrom ?? STAMP_WRAP_FROM_NONE));
        if (deposit.kind !== 'flood') return;
        const ends = stampPaintFieldEnds(deposit.flood.load);
        put('load', ends.geometry);
        put('loadEnds', [ends.first, ends.second]);
        put('loadKind', ends.kind);
      }),
      within?.region?.view ?? targets.blank.view,
      slot((views) => loaded.writePaint(views, draw.paintAt)),
      wet && targets.wet!.field.views.paper,
      wet && slot((views) => {
        const put = gpuUniformWriter(STAMP_DEPOSIT_WET_OP, views);
        const { action } = deposit;
        put('drying', stampDryingWords(wet.landing.drying));
        put('tau', wet.landing.tau);
        put('water', wet.landing.water);
        put('strength', action.kind === 'lift' ? action.strength : 0);
        put('action', STAMP_WET_ACTIONS[action.kind]);
      }),
      wet && targets.wet!.footprint.view, wet && targets.wet!.fresh.view, !wet ? targets.press : null, !wet ? targets.before?.view ?? null : null,
      ...compositor.deposit.resources({ tints: { a: tinted ? targets.tints!.a : targets.blank.view, b: tinted ? targets.tints!.b : targets.blank.view }, wet: !!wet }),
    ], box.w, box.h, after);
  }

  return {
    /**
     * Draws `deposit`, loaded as `loaded`, by `draw`, and runs the deposit stages after it: the stage texels it
     * changed, or null for none.
     */
    drawDeposit(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, loaded: StampLoadedDeposit, draw: StampDepositDraw): StampPixelBox | null {
      const { wet, tooth } = draw;
      if (!wet !== !loaded.wash) throw new Error(`stamp paint: ${deposit.id} ${loaded.wash ? 'is laid by the wash law, and is drawn without a landing' : 'is laid dry, and is drawn with a landing'}`);
      const { box } = loaded;
      if (!box) return null;
      // The rim is where the mask stands above a blur as wide as its edge.
      const sigma = loaded.active.edgeSigma, blurred = sigma > 0;
      drawStamps(encoder, loaded, deposit, box);
      if (!wet) {
        if (pressPipeline) layMaxStamps(encoder, pressPipeline, targets.press!, deposit, loaded, box);
        if (targets.before) {
          const read = stampStageTexelsGrown(stage, box, Math.ceil(beforeReachOf(tooth)));
          copyStampTextureBox(encoder, { texture: targets.layer.texture, x: read.x, y: read.y }, { texture: targets.before.texture, x: read.x, y: read.y }, read);
        }
      } else layMaxStamps(encoder, touchPipeline!, targets.wet!.touch, deposit, loaded, box);
      if (blurred) blurMask(encoder, sigma, box);
      if (!wet) {
        resolveDeposit(encoder, deposit, loaded, draw, blurred, box);
        return box;
      }
      const { landing, plans, seed } = wet, wash = loaded.wash!, field = targets.wet!;
      const reaches = plans.deposit.map((plan) => plan.landingReach?.(deposit) ?? null).filter((reach) => reach !== null);
      // Its water lands in its resolve's pass, which leaves the footprint it reads, its landing as far round its box
      // as its stages read.
      const reach = reaches.length ? Math.max(...reaches) : 0, found = stampStageTexelsGrown(stage, box, reach);
      const uniform = slot((views) => putStampWetLand(views, { deposit, landing, box, found, scale: wash.scale }));
      resolveDeposit(encoder, deposit, loaded, draw, blurred, box, (into) => field.field.land(into, uniform, wash.scales, field.touch, field.footprint.view, found, reaches.length > 0));
      let painted: StampPixelBox = box;
      for (const plan of plans.deposit) painted = stampBoxUnion(painted, plan.encode(encoder, { deposit, landing, box, seed, paperDepth: tooth?.depth ?? 0 }))!;
      return painted;
    },
    drawStamps,
    /**
     * Lays `deposit`'s touch over `box` into `into` (r16float, the stage's size), as its draw lays it: where its water
     * reaches before the paper hardens it, for a schedule reading its core. `into` is cleared first, unless `over` the
     * touch already there, the greater kept: a wash's core is its applications' touches together.
     */
    drawTouch(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, loaded: StampLoadedDeposit, box: StampPixelBox, into: GPUTextureView, over = false) {
      layMaxStamps(encoder, touchPipeline!, into, deposit, loaded, box, over ? 'load' : 'clear');
    },
    /** Writes into a Deposit at `views` what a brushed mask's mark's coverage resolves with on `tooth`, its flags too. */
    writeMarkCoverage(views: GpuUniformViews, marks: StampLoadedMarks, grainOffset: CompiledStampDeposit['grainOffset'], tooth: StampPaperTooth | null) {
      writeCoverage(views, marks, grainOffset, marks.resolveOrder, false, tooth)('flags', stampCoverageFlagWord(stampMarksCoverageFlags(marks, tooth)));
    },
    /** What it was made with, for work laying marks through it (encodeStampBrushedMasks). */
    stage, arena, tipFootprint, targets,
    /** A wash's moments besides its deposits', on the drawing's own layer and wet field; null with no wet targets. */
    wash: wetTargets && {
      /**
       * `stages` loaded on the drawing's layer, footprint, fresh and wet field, `layer` saying how a deposit's paint
       * lies in the layer: by when each runs. Plan them for each bank (planStampWetStages).
       */
      loadStages(stages: readonly StampWetStage[], layer: StampWashLayer): StampLoadedWetStages {
        const context: StampWetStageContext = { device, stage, layer: targets.layer, wash: layer, footprint: wetTargets.footprint, fresh: wetTargets.fresh, field: wetTargets.field.views };
        return {
          deposit: stages.flatMap((wetStage) => (wetStage.after === 'deposit' ? [wetStage.load(context)] : [])),
          drying: stages.flatMap((wetStage) => (wetStage.after === 'drying' ? [wetStage.load(context)] : [])),
        };
      },
      /** Starts a wash: the field over the whole stage on dry paper, or on `preparation`, and nothing seen since a drying. */
      prepare(encoder: GPUCommandEncoder, preparation: StampWashStart | null) {
        const words = preparation && { wetness: preparation.wetness, region: preparation.region?.box ?? null, fluid: preparation.fluid?.box ?? null };
        wetTargets.field.prepare(encoder, slot((views) => putStampWetPrepare(views, { stage, preparation: words })), preparation?.region?.view ?? null, preparation?.fluid?.view ?? null);
      },
      /**
       * Closes `drying` once its last deposit is drawn: its stages (`plans.drying`), seeded by `seed`, then the field
       * forgets what it saw, which they read. The stage texels they changed, or null for none.
       */
      dry(encoder: GPUCommandEncoder, drying: StampWashDrying, plans: StampWetStagePlans, seed: number): StampPixelBox | null {
        let painted: StampPixelBox | null = null;
        for (const plan of plans.drying) painted = stampBoxUnion(painted, plan.encode(encoder, { drying, seed }));
        wetTargets.field.dried(encoder);
        return painted;
      },
    },
  };
}

export type StampDepositDrawing = ReturnType<typeof createStampDepositDrawing>;

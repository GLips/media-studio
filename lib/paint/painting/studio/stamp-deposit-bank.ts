// stamp-deposit-bank.ts: marks on the GPU as a deposit's drawing lays them (stamp-deposit-drawing.ts), whenever they
// land: stamps, tints and an ordered layer's bins in buffers, each layer's plan and tip hull, the resolve order, and a
// deposit's box and wash. When a wash deposit lands is given each time it's drawn, so a bank loads once.
//
// Brushes are bound to their images first, once a painting (bindStampPaintBrushes).

import { bindStampBrushImages, stampBrushImages, type StampBrush, type StampBrushAsset, type StampBrushImageSource, type StampBrushLayer } from '#lib/paint/brush/models/stamp-brush.ts';
import type { FrozenStampMarks } from '#lib/paint/brush/models/stamp-placement.ts';
import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { GpuUniformViews } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { CompiledStampMarkPlacement } from '../models/stamp-brushed-mask.ts';
import { STAMP_RESOLVE_PLANS, stampActiveLayers, stampResolveOrderIndex, stampResolvePlan, type StampAccumulationPlan } from '../models/stamp-deposit-stages.ts';
import { STAMP_FLOATS, STAMP_ORDERED_TILE, stampBinsAppended, stampInstanceFloats, stampMarksOrderedBins, stampMarksPlan, stampTintFloats, TINT_FLOATS } from '../models/stamp-mark-load.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe-compile.ts';
import type { StampPaintPaper } from '../models/stamp-paint-recipe-types.ts';
import { stampGrainDepthSourceIn } from '../models/stamp-pigment-paint.ts';
import { stampStageTexelsWithin, type StampStage } from '../models/stamp-stage.ts';
import type { StampTipHull } from '../models/stamp-tip-hull.ts';
import { stampMarksSupport, stampMarksTipHull, stampTipFootprintOf, type StampTipFootprint, type StampTipsOf } from '../models/stamp-tip-support.ts';
import type { StampPaintCompositor } from './stamp-paint-compositor.ts';
import { stampPaintBuffer, type StampPaintDevice, type StampPaintImage } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner, StampPaintImageKind } from './stamp-paint-gpu-owner.ts';
import { stampWetScales, type StampWetScale } from './stamp-wet-field.ts';

/** A brush's layer with its images on the GPU. */
export type StampBoundLayer = StampBrushLayer<StampPaintImage>;

/** How a layer's stamps are laid (stampMarksPlan), an `ordered` one's bins' table in its marks' bin buffer. */
export type StampLoadedPlan = Exclude<StampAccumulationPlan, { kind: 'ordered' }> | { kind: 'ordered'; bins: number };

/** What a deposit or a brushed mask's mark places: its stamps, its dual's, its grains' offsets and its diameter. */
export type StampPlacedMarks = Pick<CompiledStampDeposit, 'stamps' | 'dualStamps' | 'grainOffset' | 'diameter'>;

/**
 * Marks as a drawing lays them, a deposit's or a brushed mask's mark's: its bound brush and which of its layers'
 * stages are active, where its layers' stamps start in `stampBuffer` and its tints in `tintBuffer` (null untinted),
 * how each layer is laid and within which hull, and its plan's resolve order (stampResolveOrderIndex).
 */
export type StampLoadedMarks = {
  brush: StampBrush<StampPaintImage>;
  active: ReturnType<typeof stampActiveLayers<StampPaintImage>>;
  main: number; dual: number; tint: number | null;
  mainHull: StampTipHull; dualHull: StampTipHull | null;
  mainPlan: StampLoadedPlan; dualPlan: StampLoadedPlan | null;
  resolveOrder: number;
  stampBuffer: GPUBuffer; tintBuffer: GPUBuffer; binBuffer: GPUBuffer;
};

/** Marks to load: what they place, their brush bound, the medium their grain's depth goes by (null for none), and whether they lay tints. */
export type StampMarksToLoad = { marks: StampPlacedMarks; brush: StampBrush<StampPaintImage>; medium: PaintMedium | null; tinted: boolean };

/** What marks load for: the stage their bins and boxes lie on, and a layer's tip's footprint (stampTipFootprintOf). */
export type StampMarksLoading = { stage: StampStage; tipFootprint: (layer: StampBoundLayer) => StampTipFootprint };

/** `entries`' marks in buffers made through `on`, each loaded in order. */
export function loadStampMarks(on: StampPaintDevice, { stage, tipFootprint }: StampMarksLoading, entries: readonly StampMarksToLoad[]): StampLoadedMarks[] {
  const tilesX = Math.ceil(stage.width / STAMP_ORDERED_TILE), tilesY = Math.ceil(stage.height / STAMP_ORDERED_TILE);
  const binData: number[] = [];
  const planOf = (layer: StampBoundLayer, stamps: FrozenStampMarks): StampLoadedPlan => {
    const plan = stampMarksPlan(stamps, layer.accumulation);
    return plan.kind === 'ordered' ? { kind: 'ordered', bins: stampBinsAppended(stampMarksOrderedBins(stamps, tipFootprint(layer), tilesX, tilesY, stage.margin), binData) } : plan;
  };
  let total = 0, tints = 0;
  const placed = entries.map(({ marks, brush, tinted }) => {
    const at = {
      main: total, dual: total + marks.stamps.length, tint: tinted ? tints : null,
      mainPlan: planOf(brush, marks.stamps), dualPlan: brush.dual ? planOf(brush.dual, marks.dualStamps) : null,
    };
    total += marks.stamps.length + marks.dualStamps.length;
    if (tinted) tints += marks.stamps.length;
    return at;
  });
  if (total * STAMP_FLOATS * 4 > on.limits.maxBufferSize) {
    throw new Error(`stamp paint: ${total.toLocaleString()} stamps need ${Math.round((total * STAMP_FLOATS * 4) / 2 ** 20)} MB, over this GPU's ${Math.round(on.limits.maxBufferSize / 2 ** 20)} MB buffer`);
  }
  const stampData = new Float32Array(Math.max(1, total) * STAMP_FLOATS), tintData = new Float32Array(Math.max(1, tints) * TINT_FLOATS);
  entries.forEach(({ marks, medium }, i) => {
    const { main, dual, tint } = placed[i], grainDepthSource = stampGrainDepthSourceIn(medium);
    stampData.set(stampInstanceFloats(marks.stamps, grainDepthSource), main * STAMP_FLOATS);
    stampData.set(stampInstanceFloats(marks.dualStamps, grainDepthSource), dual * STAMP_FLOATS);
    if (tint !== null) tintData.set(stampTintFloats(marks.stamps), tint * TINT_FLOATS);
  });
  // A layer laid in order reads its stamps and tints as storage.
  const stampBuffer = stampPaintBuffer(on, stampData, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE), tintBuffer = stampPaintBuffer(on, tintData, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE);
  const binBuffer = stampPaintBuffer(on, new Uint32Array(binData.length ? binData : [0]), GPUBufferUsage.STORAGE);
  return entries.map(({ marks, brush }, i) => ({
    ...placed[i], brush, active: stampActiveLayers(brush, marks.diameter),
    mainHull: stampMarksTipHull(tipFootprint(brush), marks.stamps), dualHull: brush.dual ? stampMarksTipHull(tipFootprint(brush.dual), marks.dualStamps) : null,
    resolveOrder: stampResolveOrderIndex(STAMP_RESOLVE_PLANS[stampResolvePlan(brush.dual)]),
    stampBuffer, tintBuffer, binBuffer,
  }));
}

/** The stage texels `placed`'s stamps and its dual's touch (stampMarksSupport), `pad` px past, or null for none. */
export function stampMarksBox({ stage, tipFootprint }: StampMarksLoading, placed: Pick<StampPlacedMarks, 'stamps' | 'dualStamps'>, brush: StampBrush<StampPaintImage>, pad: number): StampPixelBox | null {
  const reach = [Infinity, Infinity, -Infinity, -Infinity];
  stampMarksSupport(placed.stamps, tipFootprint(brush), reach);
  if (brush.dual) stampMarksSupport(placed.dualStamps, tipFootprint(brush.dual), reach);
  return stampStageTexelsWithin(stage, reach[0] - pad, reach[1] - pad, reach[2] + pad, reach[3] + pad);
}

/** A deposit the wash law lays: its group's `medium`, the `water` its brush carries, and its tool's local `scale` in `scales`. */
export type StampDepositWash = { medium: PaintMedium; water: number; scale: StampWetScale; scales: GPUBuffer };

/** A deposit as the GPU holds it: its marks, and what its fields say. */
export type StampLoadedDeposit = StampLoadedMarks & {
  /** The deposit as written it's painted as: itself, or the one a boil's epoch or live marks re-place. */
  identity: CompiledStampDeposit;
  /** Its compositor's paint at a scene time. */
  writePaint: (views: GpuUniformViews, t: number) => void;
  /** Null for one its medium's dry law lays, in a wash or not. */
  wash: StampDepositWash | null;
  /** The most stage texels it touches, its edges' blur and wet stages' reach included; null for none. */
  box: StampPixelBox | null;
};

/** A deposit to load: itself and its `identity`, the brush bound for that, its group's `medium` and, laid by the wash law, its water. */
export type StampDepositToLoad = {
  deposit: CompiledStampDeposit; identity: CompiledStampDeposit; brush: StampBrush<StampPaintImage>; medium: PaintMedium | null;
  wash: { medium: PaintMedium; water: number } | null;
};

export type StampDepositBankLoading = StampMarksLoading & {
  compositor: StampPaintCompositor;
  /** How far past a wash deposit's stamps its wet stages reach, px (stampWetStageReach). */
  wetReach: (deposit: CompiledStampDeposit, medium: PaintMedium, water: number) => number;
};

/** `entries`' deposits on the GPU, made through `on`, by deposit. */
export function loadStampDepositBank(on: StampPaintDevice, loading: StampDepositBankLoading, entries: readonly StampDepositToLoad[]): ReadonlyMap<CompiledStampDeposit, StampLoadedDeposit> {
  const { compositor, wetReach } = loading;
  const loaded = loadStampMarks(on, loading, entries.map(({ deposit, brush, medium }) => ({ marks: deposit, brush, medium, tinted: compositor.readsStampTints && !!deposit.brush.color })));
  const washed = entries.flatMap(({ deposit, wash }) => (wash ? [deposit] : []));
  const scales = washed.length ? stampWetScales(on, washed) : null;
  return new Map(entries.map(({ deposit, identity, wash }, i): [CompiledStampDeposit, StampLoadedDeposit] => {
    const marks = loaded[i], sigma = marks.active.edgeSigma;
    // Past its stamps' reach, its edges' blur, and for one the wash law lays, its stages' reach.
    const pad = (sigma > 0 ? sigma * 3 : 2) + (wash ? wetReach(identity, wash.medium, wash.water) : 0);
    return [deposit, {
      ...marks, identity, writePaint: compositor.deposit.writerFor(identity),
      wash: wash && scales && { ...wash, scale: scales.of(deposit), scales: scales.buffer }, box: stampMarksBox(loading, deposit, marks.brush, pad),
    }];
  }));
}

/**
 * A painting's brushes bound to their images on the GPU: each deposit's and brushed mask's mark's at its diameter, a
 * bristle tip drawn at it; any image by its source; a layer's tip footprint; and a deposit's tips by its ID, so an
 * epoch's or live marks' deposit has the brush its deposit as written was bound to.
 */
export type StampPaintBrushes = {
  image: (source: StampBrushImageSource) => StampPaintImage;
  deposits: ReadonlyMap<CompiledStampDeposit, StampBrush<StampPaintImage>>;
  marks: ReadonlyMap<CompiledStampMarkPlacement, StampBrush<StampPaintImage>>;
  tipFootprint: (layer: StampBoundLayer) => StampTipFootprint;
  tipsOf: StampTipsOf;
};

/** `deposits`' and brushed masks' `marks`' brushes bound on `owner`, with `paper`'s images loaded beside theirs. */
export async function bindStampPaintBrushes(
  owner: StampPaintGpuOwner, { deposits, marks, paper }: { deposits: readonly CompiledStampDeposit[]; marks: readonly CompiledStampMarkPlacement[]; paper: StampPaintPaper },
): Promise<StampPaintBrushes> {
  const assets = paintingImages([...deposits, ...marks].map(({ brush }) => brush), paper);
  const loaded = await owner.images(assets);
  const images = new Map(assets.map(({ asset }, i) => [assetKey(asset), loaded[i]]));
  // A bristle tip's images are drawn for each diameter it's painted at, once a surface.
  const image = (source: StampBrushImageSource) => ('draw' in source ? owner.drawnImage(source.key, source.draw) : images.get(assetKey(source))!);
  const bound = await owner.checked('drawing the brushes\' bristle tips', () => ({
    deposits: new Map(deposits.map((deposit) => [deposit, bindStampBrushImages(deposit.brush, deposit.diameter, image)] as const)),
    marks: new Map(marks.map((mark) => [mark, bindStampBrushImages(mark.brush, mark.diameter, image)] as const)),
  }));
  const byId = new Map([...bound.deposits].map(([deposit, brush]) => [deposit.id, brush]));
  const tipFootprint = (layer: StampBoundLayer) => stampTipFootprintOf(layer.tip, owner.tipLevels);
  const tipsOf: StampTipsOf = (deposit) => {
    const brush = byId.get(deposit.id)!;
    return { main: tipFootprint(brush), dual: brush.dual ? tipFootprint(brush.dual) : null };
  };
  return { image, ...bound, tipFootprint, tipsOf };
}

const assetKey = ({ style, pack, file }: StampBrushAsset) => `${style}/${pack}/${file}`;

/** Every image `brushes` and `paper` need, each once, with what it is: a grain tiles, a tip (or its contact) doesn't. */
function paintingImages(brushes: readonly StampBrush[], paper: StampPaintPaper): { asset: StampBrushAsset; kind: StampPaintImageKind }[] {
  const assets = brushes.flatMap((brush) => stampBrushImages(brush).map(({ image, wrap }): { asset: StampBrushAsset; kind: StampPaintImageKind } => ({ asset: image, kind: wrap === 'tile' ? 'grain' : 'tip' })));
  if (paper.image) assets.push({ asset: paper.image, kind: 'photograph' });
  if (paper.grain) assets.push({ asset: paper.grain.image, kind: 'grain' });
  return [...new Map(assets.map((entry) => [assetKey(entry.asset), entry])).values()];
}

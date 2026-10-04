// painting-deposit-compile.ts: one application of a checked document as the engine's deposit (CompiledStampDeposit),
// its marks planned at rest by its tip's seed: stroke, stamps or fill; its charge as an action; its clips as `within`
// areas; its reserves as masking fluid and its resists as wax over it; and what of those stays on the paper when its
// layer is posed. A prewet's reserves compile the same way.
//
// A fill of several outer rings floods (or shades) each, its seed suffixed by the ring after the first, and lands as
// one deposit within its ringed area, so holes stay bare.

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import type { CompiledStampArea } from '#lib/paint/painting/models/stamp-area.ts';
import { compileStampBrushedMask } from '#lib/paint/painting/models/stamp-brushed-mask.ts';
import { compileDeposit } from '#lib/paint/painting/models/stamp-deposit-compile.ts';
import { stampFillPartsJoined, type StampFillApplication } from '#lib/paint/painting/models/stamp-fill.ts';
import type { StampMark, StampMarkGeometry } from '#lib/paint/painting/models/stamp-marks.ts';
import { compilePaintAction, compileWashAction, mapStampPaintField, type CompiledStampAction, type StampRecipeWashAction } from '#lib/paint/painting/models/stamp-paint-action.ts';
import type { StampSeededPaintField } from '#lib/paint/painting/models/stamp-paint-field.ts';
import type { CompiledStampDeposit, CompiledStampMask } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampResolvedGeometry } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import type { StampSheetAnchors } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { compilePaintingArea, paintingOuterRings, paintingRegionRings } from './painting-area-compile.ts';
import type { AnyApplication, Amount, BrushRef, Charge, FillGeometry, Footprint, MarkFootprint, Mix, Resist, Subpath } from './painting-document.ts';
import { paintingMixture } from './painting-mix.ts';

/**
 * The brush a document's ref names, resolved from its style; throws for one it lacks. Compiles are kept by its
 * identity (compilePaintingSelection), and poses by the programs they make: hold one for an evaluation's life, or
 * every call compiles and poses anew.
 */
export type PaintingBrushOf = (ref: BrushRef) => StampBrush;

const paintingMixMaterial = (mix: Mix): PaintMaterial => ({ kind: 'mixture', ...paintingMixture(mix) });

/** A share, constant or a field, as a field. */
const paintingAmountField = (amount: Amount): StampSeededPaintField<number> => (typeof amount === 'number' ? { kind: 'constant', value: amount } : amount);

/** `charge` as the recipe action compileWashAction checks. */
function paintingAction(charge: Charge): StampRecipeWashAction {
  if (charge.kind === 'water') return { kind: 'water', water: charge.water };
  if (charge.kind === 'lift') return { kind: 'lift', strength: charge.strength };
  const material = 'parts' in charge.mix ? { kind: 'constant' as const, value: paintingMixMaterial(charge.mix) } : mapStampPaintField(charge.mix, paintingMixMaterial);
  return { kind: 'paint', material, ...(charge.water !== undefined && { water: charge.water }), ...(charge.burnish && { burnish: true }) };
}

/** A stroke's subpaths as one path, each after the first starting with a pen-up. */
const paintingStrokePath = (subpaths: readonly Subpath[]): StampStrokePoint[] =>
  subpaths.flatMap((subpath, i) => subpath.map((point, j) => (i > 0 && j === 0 ? { ...point, lift: true } : point)));

/** A mark's footprint (a reserve or a wax stroke) as a mark, placed from its seed. */
function paintingFootprintMark(footprint: MarkFootprint, brushOf: PaintingBrushOf): StampMark {
  const geometry: StampMarkGeometry = footprint.kind === 'stroke'
    ? { kind: 'stroke', path: paintingStrokePath(footprint.subpaths), ...(footprint.hand && { hand: footprint.hand }) }
    : { kind: 'stamps', at: footprint.placements };
  return { key: footprint.seed, brush: brushOf(footprint.brush), diameter: footprint.diameterPx, geometry };
}

/** What reserves and resists compile to: the fluid's latest op over those before it, and its ops that stay on the paper. */
export type PaintingFluid = { mask: CompiledStampMask | null; anchored: Set<CompiledStampMask> };

/** `reserves` as masking fluid, then `resists` as wax over it, each footprint an op of its own named `${id}/…`. */
export function compilePaintingFluid(id: string, reserves: readonly Footprint[], resists: readonly Resist[], brushOf: PaintingBrushOf): PaintingFluid {
  const anchored = new Set<CompiledStampMask>();
  let mask: CompiledStampMask | null = null;
  const lay = (op: CompiledStampMask, footprint: Footprint | MarkFootprint) => {
    if (footprint.anchor === 'paper') anchored.add(op);
    mask = op;
  };
  reserves.forEach((footprint, i) => {
    const opId = `${id}/reserves[${i}]`;
    lay(footprint.kind === 'region'
      ? { id: opId, under: mask, kind: 'mask', area: compilePaintingArea({ region: footprint.region, ...(footprint.edge && { edge: footprint.edge }) }, opId) }
      : { id: opId, under: mask, kind: 'brushed', brushed: compileStampBrushedMask(opId, [paintingFootprintMark(footprint, brushOf)], null) }, footprint);
  });
  resists.forEach(({ footprints, amount }, i) => footprints.forEach((footprint, j) => {
    const opId = `${id}/resists[${i}].footprints[${j}]`;
    // Wax of no amount keeps all the contact: nothing to lay.
    if (amount > 0) lay({ id: opId, under: mask, kind: 'brushed', brushed: compileStampBrushedMask(opId, [paintingFootprintMark(footprint, brushOf)], { amount }) }, footprint);
  }));
  return { mask, anchored };
}

/** What an application compiles to: its deposit at rest, and what of it stays on the paper when posed. */
export type PaintingCompiledDeposit = { deposit: CompiledStampDeposit; anchors: StampSheetAnchors };

/** Where an application compiles: its deposit's ID, whether its wash keeps a wet history, and how brushes resolve. */
export type PaintingDepositSetting = { id: string; wet: boolean; brushOf: PaintingBrushOf };

/**
 * `application` of a checked document compiled at rest, `owner` naming it in errors; throws on what compileDeposit
 * refuses. A lift compiles as a wash's does wherever it's laid, an eraser in a direct wash too: it acts on the paper.
 */
export function compilePaintingDeposit(application: AnyApplication, owner: string, { id, wet, brushOf }: PaintingDepositSetting): PaintingCompiledDeposit {
  const brush = brushOf(application.brush), action = paintingAction(application.charge);
  const tool = { brush, diameter: application.diameterPx, ...(application.charge.kind === 'paint' && application.charge.opacityCap !== undefined && { opacity: application.charge.opacityCap }) };
  const fluid = compilePaintingFluid(id, application.reserves ?? [], application.resists ?? [], brushOf);
  const clips = (application.clips ?? []).map((clip, i) => compilePaintingArea(clip, `${owner}.clips[${i}]`));
  const anchoredClips = new Set((application.clips ?? []).flatMap((clip, i) => (clip.anchor === 'paper' ? [i] : [])));
  const compiledAction = (draws: readonly number[]): CompiledStampAction => (wet || action.kind !== 'paint' ? compileWashAction(id, action, brush, draws) : compilePaintAction(id, action, brush, draws));
  const compile = (geometry: StampResolvedGeometry, seed: string, within: readonly CompiledStampArea[]) =>
    compileDeposit(id, { kind: 'deposit', name: { items: [], id, keys: [] }, provenance: [], geometry, tool, action, mask: null }, compiledAction, fluid.mask, seed, within.length ? within : undefined);
  const anchors = { within: anchoredClips, masks: fluid.anchored };
  if (application.kind === 'stroke') {
    const path = paintingStrokePath(application.subpaths);
    return { deposit: compile({ kind: 'stroke', path, ...(application.hand && { hand: application.hand }) }, application.seed, clips), anchors };
  }
  if (application.kind === 'stamps') return { deposit: compile({ kind: 'stamps', at: application.placements }, application.seed, clips), anchors };
  return { deposit: paintingFillDeposit(application, owner, brush, clips, compile), anchors };
}

/**
 * A fill: each outer ring laid by its own placement, joined into one deposit. A flood stops at the ringed area as its
 * barrier, walled unless its outline bleeds; strokes land within it.
 */
function paintingFillDeposit(
  fill: FillGeometry & { readonly seed: string }, owner: string, brush: StampBrush, clips: readonly CompiledStampArea[],
  compile: (geometry: StampResolvedGeometry, seed: string, within: readonly CompiledStampArea[]) => CompiledStampDeposit,
): CompiledStampDeposit {
  const area = compilePaintingArea(fill.area, `${owner}.area`), { edge } = fill.area;
  const laying = fill.laying ?? (brush.media === 'dry' ? undefined : { kind: 'flood' as const });
  const application: StampFillApplication | undefined = laying?.kind === 'flood'
    ? { kind: 'flood', edge: edge?.kind === 'bleed' ? { kind: 'lost', reach: edge.reachPx } : { kind: 'barrier' }, ...(laying.reach && { reach: laying.reach }) }
    : laying;
  const flooded = application?.kind === 'flood';
  const within = flooded ? clips : [...clips, area];
  const parts = paintingOuterRings(paintingRegionRings(fill.area.region)).map((ring, i) => compile({
    kind: 'fill', region: { kind: 'polygon', points: ring }, ...(application && { application }), ...(fill.direction !== undefined && { direction: fill.direction }),
    ...(fill.load !== undefined && { load: paintingAmountField(fill.load) }),
  }, i ? `${fill.seed}|ring${i}` : fill.seed, within));
  return stampFillPartsJoined(parts, area);
}

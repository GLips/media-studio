// painting-deposit-compile.ts: one application of a checked document as the engine's deposit (CompiledStampDeposit),
// its marks planned at rest by its tip's seed: stroke, stamps or fill; its charge as an action; its clips as `within`
// areas; its reserves as masking fluid and its resists as wax over it; and what of those stays on the paper when its
// layer is posed. A prewet's reserves compile the same way.
//
// A fill of several outer rings floods (or shades) each, its seed suffixed by the ring after the first, and lands as
// one deposit within its ringed area, so holes stay bare.

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampFrozenMarks, type StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';
import { paintColorPigmentId } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
import type { CompiledStampArea } from '#lib/paint/painting/models/stamp-area.ts';
import { compileStampBrushedMask } from '#lib/paint/painting/models/stamp-brushed-mask.ts';
import { compileDeposit } from '#lib/paint/painting/models/stamp-deposit-compile.ts';
import type { StampFillApplication } from '#lib/paint/painting/models/stamp-fill.ts';
import type { StampMark, StampMarkGeometry } from '#lib/paint/painting/models/stamp-marks.ts';
import { compilePaintAction, compileWashAction, mapStampPaintField, type CompiledStampAction, type StampRecipeWashAction } from '#lib/paint/painting/models/stamp-paint-action.ts';
import type { StampSeededPaintField } from '#lib/paint/painting/models/stamp-paint-field.ts';
import type { CompiledStampDeposit, CompiledStampFlood, CompiledStampMask } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampResolvedGeometry } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import { stampGridAt, type StampGrid } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampSheetAnchors } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { StampSheetRefusal } from '#lib/paint/painting/models/stamp-sheet-schedule.ts';
import { compilePaintingArea, paintingOuterRings, paintingRegionRings } from './painting-area-compile.ts';
import type { AnyApplication, Amount, BrushRef, Charge, FillGeometry, Footprint, Mix, MixPart, Resist, Subpath } from './painting-document.ts';

/** The brush a document's ref names, resolved from its style; throws for one it lacks. */
export type PaintingBrushOf = (ref: BrushRef) => StampBrush;

/** A hex part as a pigment of its own, fitted as its medium fits a colour. */
const paintingPigmentAppearance = (pigment: MixPart['pigment']): PaintPigmentAppearance => (typeof pigment === 'string'
  ? { id: paintColorPigmentId(pigment), name: pigment, overWhite: pigment, overBlack: pigment, fitted: 'color' }
  : pigment);

const paintingMixMaterial = ({ parts, strength }: Mix): PaintMaterial => ({
  kind: 'mixture', strength, parts: parts.map(({ pigment, amount }) => ({ pigment: paintingPigmentAppearance(pigment), amount })),
});

/** Every pigment `mix` names, as appearances. */
export function paintingMixAppearances(mix: Mix | StampSeededPaintField<Mix>): PaintPigmentAppearance[] {
  return paintingFieldMixes(mix).flatMap(({ parts }) => parts.map(({ pigment }) => paintingPigmentAppearance(pigment)));
}

/** The mixes a charge's mix, constant or a field, names. */
function paintingFieldMixes(mix: Mix | StampSeededPaintField<Mix>): readonly Mix[] {
  if ('parts' in mix) return [mix];
  switch (mix.kind) {
    case 'constant': return [mix.value];
    case 'linear': return [mix.from.value, mix.to.value];
    case 'radial': return [mix.inner, mix.outer];
    default: return [mix.a, mix.b];
  }
}

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
function paintingFootprintMark(footprint: Extract<Footprint, { readonly brush: BrushRef }>, brushOf: PaintingBrushOf): StampMark {
  const geometry: StampMarkGeometry = footprint.kind === 'stroke'
    ? { kind: 'stroke', path: paintingStrokePath(footprint.subpaths), ...(footprint.hand && { hand: footprint.hand }) }
    : { kind: 'stamps', at: footprint.placements };
  return { key: footprint.seed, brush: brushOf(footprint.brush), diameter: footprint.diameterPx, geometry };
}

/** What reserves and resists compile to: the fluid's latest op over those before it, and its ops that stay on the paper. */
export type PaintingFluid = { mask: CompiledStampMask | null; anchored: Set<CompiledStampMask> };

/**
 * `reserves` as masking fluid, then `resists` as wax over it, each footprint an op of its own named `${id}/…`. Throws on
 * a region resist: wax is caught on the peaks by a brush's marks, which a region has none of.
 */
export function compilePaintingFluid(id: string, reserves: readonly Footprint[], resists: readonly Resist[], brushOf: PaintingBrushOf): PaintingFluid {
  const anchored = new Set<CompiledStampMask>();
  let mask: CompiledStampMask | null = null;
  const lay = (op: CompiledStampMask, footprint: Footprint) => {
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
    if (footprint.kind === 'region') throw new StampSheetRefusal(`painting: ${opId} is a region, and wax is laid by a brush's marks: give it a stroke or stamps`);
    // Wax of no amount keeps all the contact: nothing to lay.
    if (amount > 0) lay({ id: opId, under: mask, kind: 'brushed', brushed: compileStampBrushedMask(opId, [paintingFootprintMark(footprint, brushOf)], { amount }) }, footprint);
  }));
  return { mask, anchored };
}

/** The union of `grids` at the finest's cell: each point the least any grid holding it gives, 1 where none does. */
function paintingUnionGrid(grids: readonly StampGrid[]): StampGrid {
  if (grids.length === 1) return grids[0];
  const cell = Math.min(...grids.map((grid) => grid.cell));
  const x0 = Math.min(...grids.map((grid) => grid.x0)), y0 = Math.min(...grids.map((grid) => grid.y0));
  const x1 = Math.max(...grids.map((grid) => grid.x0 + (grid.columns - 1) * grid.cell)), y1 = Math.max(...grids.map((grid) => grid.y0 + (grid.rows - 1) * grid.cell));
  const columns = Math.ceil((x1 - x0) / cell) + 1, rows = Math.ceil((y1 - y0) / cell) + 1, values = new Float32Array(columns * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const x = x0 + i * cell, y = y0 + j * cell;
      const holding = grids.filter((grid) => x >= grid.x0 && y >= grid.y0 && x <= grid.x0 + (grid.columns - 1) * grid.cell && y <= grid.y0 + (grid.rows - 1) * grid.cell);
      values[j * columns + i] = holding.length ? Math.min(...holding.map((grid) => stampGridAt(grid, x, y))) : 1;
    }
  }
  return { x0, y0, cell, columns, rows, values };
}

/** What an application compiles to: its deposit at rest, and what of it stays on the paper when posed. */
export type PaintingCompiledDeposit = { deposit: CompiledStampDeposit; anchors: StampSheetAnchors };

/** Where an application compiles: its deposit's ID, whether its wash keeps a wet history, and how brushes resolve. */
export type PaintingDepositSetting = { id: string; wet: boolean; brushOf: PaintingBrushOf };

/**
 * `application` compiled at rest, `owner` naming it in errors. Throws on a lift in a direct wash, which has no water
 * to lift by, and on what compileDeposit refuses.
 */
export function compilePaintingDeposit(application: AnyApplication, owner: string, { id, wet, brushOf }: PaintingDepositSetting): PaintingCompiledDeposit {
  if (!wet && application.charge.kind !== 'paint') throw new StampSheetRefusal(`painting: ${owner} ${application.charge.kind === 'lift' ? 'lifts' : 'lays water'} in a wash without wet history; do it in a wet wash`);
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
  const [first] = parts;
  const joined = parts.length === 1 ? first : {
    ...first, stamps: stampFrozenMarks(parts.flatMap(({ stamps }) => stamps)), dualStamps: stampFrozenMarks(parts.flatMap(({ dualStamps }) => dualStamps)),
  };
  if (first.kind !== 'flood') return joined;
  const flood: CompiledStampFlood = { ...first.flood, barrier: area, scale: paintingUnionGrid(parts.flatMap((part) => (part.kind === 'flood' ? [part.flood.scale] : []))) };
  return { ...joined, kind: 'flood', flood };
}

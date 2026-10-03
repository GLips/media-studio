// stamp-deposit-compile.ts: a deposit as written (stamp-paint-recipe.ts) checked and its stamps placed
// (stamp-deposit-placement.ts), seeded by its ID so adding a stroke changes no other.

import type { StampBrushMedia } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampDepositDraws, stampGrainOffsets } from './stamp-marks.ts';
import { placeStampDeposit } from './stamp-deposit-placement.ts';
import type { StampFillApplication } from './stamp-fill.ts';
import { stampPaintFieldProblem, stampSeededPaintField } from './stamp-paint-field.ts';
import type { CompiledStampAction } from './stamp-paint-action.ts';
import { checkedStampPolygon, stampGrownPolygon, stampRegionPolygon } from './stamp-region.ts';
import type { CompiledStampDeposit, CompiledStampMask } from './stamp-paint-recipe-compile.ts';
import type { CompiledStampArea } from './stamp-area.ts';
import type { StampPaintRecipeDeposit } from './stamp-paint-recipe-types.ts';

/** How a fill of wet or dry media is laid unless it says: wet paint floods a shape; a crayon shades it in short strokes. */
const STAMP_MEDIA_FILLS: Record<StampBrushMedia, StampFillApplication> = { wet: { kind: 'flood' }, dry: { kind: 'strokes', pattern: { kind: 'shading' } } };

/**
 * A deposit checked and its stamps placed, `full` its ID, its action by `compiledAction` from its colour jitter, under the
 * fluid `mask` and `within` its applications' areas, its stamps and grains placed from `seed` (its mark's, for a
 * deposit built from one), its colour jitter drawn from `full`.
 */
export function compileDeposit<A extends CompiledStampAction>(
  full: string, { geometry, tool, action }: StampPaintRecipeDeposit, compiledAction: (colorDraws: readonly number[]) => A, mask: CompiledStampMask | null, seed: string,
  within: readonly CompiledStampArea[] | undefined,
): CompiledStampDeposit<A> {
  const { brush, opacity = 1, diameter } = tool;
  if (!(diameter > 0) || !Number.isFinite(diameter)) throw new Error(`stamp paint: ${full} has diameter ${diameter}, and a stamp needs a positive one`);
  if (geometry.kind !== 'fill' && !(geometry.kind === 'stroke' ? geometry.path : geometry.at).length) throw new Error(`stamp paint: ${full} has no points to stamp`);
  if (geometry.kind === 'fill') checkedStampPolygon(geometry.region, full);
  if (geometry.kind === 'stroke' && geometry.path.some(({ scale }) => scale !== undefined && !(scale > 0 && Number.isFinite(scale)))) {
    throw new Error(`stamp paint: ${full} has a point whose scale isn't a finite positive number`);
  }
  // Four draws place the grains, four jitter the colour. A boil's epoch draws only its grains afresh: colour is the
  // author's palette, which an epoch mustn't flicker; nor is it a mark's, so it's drawn from the deposit's own ID.
  const jitter = stampDepositDraws(full).slice(4);
  const blend = (action.kind === 'paint' && action.blend) || brush.blend;
  const common = {
    id: full, brush, action: compiledAction(jitter), grainOffset: stampGrainOffsets(brush, seed), diameter, blend, opacity, mask,
    ...(within && { within }),
  };
  if (geometry.kind !== 'fill') return { ...common, ...placeStampDeposit(geometry, brush, diameter, seed) };
  const load = stampSeededPaintField(geometry.load ?? { kind: 'constant' as const, value: 1 }, full);
  const problem = stampPaintFieldProblem(load, (value) => (value >= 0 && value <= 1 ? null : `a load of ${value}, outside 0..1`));
  if (problem) throw new Error(`stamp paint: ${full}'s load can't be painted: ${problem}`);
  const application = geometry.application ?? (brush.media && STAMP_MEDIA_FILLS[brush.media]);
  if (!application) throw new Error(`stamp paint: ${full} fills with ${JSON.stringify(brush.name)}, whose media no style declares, so it states its application`);
  const reach = application.kind === 'flood' ? application.reach : undefined;
  if (reach && reach !== 'inside' && !(reach.past >= 0 && Number.isFinite(reach.past))) throw new Error(`stamp paint: ${full} floods a finite 0 or more diameters past its outline, not ${reach.past}`);
  // A reaching flood is placed over its grown region, so its body and its edge stroke both lie past the outline.
  const region = reach && reach !== 'inside' && reach.past > 0 ? { kind: 'polygon' as const, points: stampGrownPolygon(stampRegionPolygon(geometry.region), reach.past * diameter) } : geometry.region;
  return { ...common, ...placeStampDeposit({ ...geometry, region, application, load }, brush, diameter, seed) };
}

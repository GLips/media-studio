// stamp-brushed-mask.ts: masking fluid and wax resist laid with a brush, by marks (StampMark). A brushed mask covers
// what its marks' brush tips cover, grain and dual included, never pigment: each mark is placed from its key by the
// one path paint built from it is (placeStampDeposit), so the same mark painted elsewhere lands the same stamps.
//
// Coverage is a GPU fact (tips are images): the renderer draws each brushed mask as it loads, and each wash's wet
// field reads it per pixel, so water lands only on paper a sparse brush left open.
//
// Resist is wax: laid on the paper's peaks as a dry stick catches them (paintDryContact), held through the rest of
// its group, never lifted.

import { stampGrainOffsets, type StampMark } from './stamp-marks.ts';
import { placeStampDeposit } from './stamp-deposit-placement.ts';
import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { FrozenStampMarks } from '#lib/paint/brush/models/stamp-placement.ts';
import type { CompiledStampMask, CompiledStampPaint } from './stamp-paint-recipe-compile.ts';

/** A mark as a brushed mask lays it: placed from its key, as paint built from it is. */
export type CompiledStampMarkPlacement = {
  key: string; brush: StampBrush; diameter: number; stamps: FrozenStampMarks; dualStamps: FrozenStampMarks;
  grainOffset: ReturnType<typeof stampGrainOffsets>;
};

/**
 * A brushed mask: its marks' coverage, joined by max. `resist`: wax, its coverage the share of `amount` its brush
 * leaves on the paper's peaks; null for masking fluid, all its brush covers.
 */
export type CompiledStampBrushedMask = { id: string; marks: readonly CompiledStampMarkPlacement[]; resist: { amount: number } | null };

/**
 * How high the paper must stand, as a share of its mean height, for wax dragged over it to catch: its mean, so about
 * half a sheet's tooth takes wax and the valleys between stay open to paint.
 */
export const STAMP_RESIST_TOOTH = 1;

/**
 * `marks` laid as brushed mask `id`, each placed from its key; `resist` its wax's amount, 0..1, or null for fluid.
 * Throws on no marks, a mark with no points or diameter, or an amount out of range.
 */
export function compileStampBrushedMask(id: string, marks: readonly StampMark[], resist: { amount: number } | null): CompiledStampBrushedMask {
  if (!marks.length) throw new Error(`stamp paint: ${id} is laid by no marks; a brushed mask needs at least one`);
  if (resist && !(resist.amount > 0 && resist.amount <= 1)) throw new Error(`stamp paint: ${id} resists ${resist.amount} of the paint, and a resist's amount is over 0, up to 1`);
  return {
    id, resist,
    marks: marks.map(({ key, brush, diameter, geometry }) => {
      if (!(diameter > 0) || !Number.isFinite(diameter)) throw new Error(`stamp paint: ${id}'s mark ${key} has diameter ${diameter}, and a stamp needs a positive one`);
      if (!(geometry.kind === 'stroke' ? geometry.path : geometry.at).length) throw new Error(`stamp paint: ${id}'s mark ${key} has no points to stamp`);
      // A boil's epoch never re-places a mask: the seed is the key as written, as paint's is at epoch 0.
      const { stamps, dualStamps } = placeStampDeposit(geometry, brush, diameter, key);
      return { key, brush, diameter, stamps, dualStamps, grainOffset: stampGrainOffsets(brush, key) };
    }),
  };
}

/** Every brushed mask under `mask`'s chain of fluid. */
function* brushedUnder(mask: CompiledStampMask | null | undefined): Generator<CompiledStampBrushedMask> {
  for (let op = mask; op; op = op.under) if (op.kind === 'brushed') yield op.brushed;
}

/** Every brushed mask under any of `fluids`' chains, each once. */
export function stampBrushedMasksUnder(fluids: Iterable<CompiledStampMask | null | undefined>): CompiledStampBrushedMask[] {
  const found = new Set<CompiledStampBrushedMask>();
  for (const fluid of fluids) for (const brushed of brushedUnder(fluid)) found.add(brushed);
  return [...found];
}

/** Every brushed mask any deposit or preparation of `painting` lands under, each once. */
export function stampPaintingBrushedMasks(painting: CompiledStampPaint): CompiledStampBrushedMask[] {
  return stampBrushedMasksUnder(painting.groups.flatMap((group) => group.passes).flatMap((pass) => {
    const deposits = pass.kind === 'dry' ? pass.deposits : pass.wash.schedule.flatMap((step) => (step.kind === 'deposit' ? [step.deposit] : []));
    const masks: (CompiledStampMask | null | undefined)[] = deposits.map((deposit) => deposit.mask);
    if (pass.kind === 'wash') masks.push(pass.wash.preparation?.held);
    return masks;
  }));
}

/**
 * The fluid a resisted deposit lands under: its own with each of `resists` (its group's, oldest first) masked over
 * it, so no unmask lifts them. Deposits under the same fluid and resists share the result, so the renderer works each
 * state out once.
 */
export function stampResistHolder(): (fluid: CompiledStampMask | null, resists: readonly CompiledStampBrushedMask[]) => CompiledStampMask | null {
  const held = new Map<CompiledStampMask | null, Map<CompiledStampBrushedMask, CompiledStampMask>>();
  return (fluid, resists) => resists.reduce<CompiledStampMask | null>((under, brushed) => {
    const known = held.get(under) ?? new Map<CompiledStampBrushedMask, CompiledStampMask>();
    held.set(under, known);
    if (!known.has(brushed)) known.set(brushed, { id: brushed.id, under, kind: 'brushed', brushed });
    return known.get(brushed)!;
  }, fluid);
}

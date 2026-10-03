// shot-instances.ts: an instanced plane's items among a frame's drawables. Items are finished variants laid as planes
// at their own depths, sorted with every plane far to near each frame (shot-plan.ts); consecutive items of one variant
// at one stepped defocus draw as one batch, and an item keyed alike at the shutter's two ends blurs along its own
// travel. Items aren't occurrences: no motion nodes, rigs, visibility keys or masks reach them.

import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { lensSigmaStepped } from '#lib/picture/lens/models/lens-focus.ts';
import type { ShotDrawable } from './shot-plan.ts';
import type { InstancedPlaneProps, PlaneInstance } from './shot-props.ts';
import { paintedSourceProblems } from './shot-selection.ts';

/** A run of a frame's drawing: a plane, or consecutive items of one plane and variant blurred alike, drawn at once. */
export type ShotDrawStep =
  | { readonly kind: 'plane'; readonly plane: string }
  | { readonly kind: 'items'; readonly plane: string; readonly variant: string; readonly sigma: number; readonly items: readonly PlaneInstance[] };

/**
 * `drawables` (shotDrawableOrder) as draws: consecutive items of one plane and variant whose defocus at their depths
 * (`defocusOf`, frame px of sigma) steps to one sigma batch together, a variant's picture blurred once per stepped
 * sigma. Any other drawable between two items splits them.
 */
export function shotDrawSteps(drawables: readonly ShotDrawable[], defocusOf: (depth: number) => number): ShotDrawStep[] {
  const steps: ShotDrawStep[] = [];
  let run: { plane: string; variant: string; sigma: number; items: PlaneInstance[] } | null = null;
  for (const drawable of drawables) {
    if (drawable.kind === 'plane') {
      run = null;
      steps.push({ kind: 'plane', plane: drawable.plane });
      continue;
    }
    const { plane, item } = drawable, sigma = lensSigmaStepped(defocusOf(item.depth));
    if (run && run.plane === plane && run.variant === item.variant && run.sigma === sigma) {
      run.items.push(item);
      continue;
    }
    run = { plane, variant: item.variant, sigma, items: [item] };
    steps.push({ kind: 'items', ...run });
  }
  return steps;
}

/** An item present at both of the shutter's ends by one key: where it lay as the shutter opened and as it closed. */
export type ShotInstanceTravel = { readonly open: PlaneInstance; readonly close: PlaneInstance };

/**
 * Each item key present in both `open` and `close` (the plane's items at the shutter's ends), with the item at
 * each: its travel between them is its motion. A key missing at either end draws without motion.
 */
export function shotInstanceTravel(open: readonly PlaneInstance[], close: readonly PlaneInstance[]): ReadonlyMap<string, ShotInstanceTravel> {
  const closing = new Map(close.map((item) => [item.key, item]));
  return new Map(open.flatMap((item) => {
    const closed = closing.get(item.key);
    return closed ? [[item.key, { open: item, close: closed }]] : [];
  }));
}

/**
 * What keeps instanced `plane` from drawing, as a shot loads: its depths (above 0, `near` ≤ `far`, nearer than the
 * back plane `back` at `backDepth`), a variant at least, and each variant's source.
 */
export function shotInstancedPlaneProblems(plane: InstancedPlaneProps, back: { readonly id: string; readonly depth: number }): PaintingProblem[] {
  const problems: PaintingProblem[] = [], { near, far } = plane.depths;
  if (!(near > 0 && Number.isFinite(near) && far >= near && Number.isFinite(far))) {
    problems.push(paintingProblem('error', plane.id, 'depths', `${near}..${far}; items lie between depths above 0, near first`));
  } else if (!(far < back.depth)) {
    problems.push(paintingProblem('error', plane.id, 'depths.far', `${far} isn't nearer than the back, ${back.id} at depth ${back.depth}`));
  }
  const variants = Object.entries(plane.variants);
  if (variants.length === 0) problems.push(paintingProblem('error', plane.id, 'variants', 'an instanced plane needs a variant to lay'));
  for (const [name, source] of variants) problems.push(...paintedSourceProblems(plane.id, source, `variants.${name}`));
  return problems;
}

/**
 * What keeps `items`, instanced `plane`'s at scene second `at`, from drawing: a key used twice, a variant the plane
 * doesn't have, a depth outside its `depths`, a visibility outside 0..1, or a lay that isn't finite or doesn't scale
 * by more than 0.
 */
export function shotInstanceProblems(plane: InstancedPlaneProps, items: readonly PlaneInstance[], at: number): PaintingProblem[] {
  const problems: PaintingProblem[] = [], seen = new Set<string>(), { near, far } = plane.depths;
  const error = (message: string) => problems.push(paintingProblem('error', plane.id, '', message));
  for (const { key, variant, depth, lay, visibility = 1 } of items) {
    if (seen.has(key)) error(`two items are called ${key} at ${at} s`);
    seen.add(key);
    if (!Object.hasOwn(plane.variants, variant)) error(`${key} at ${at} s lays ${variant}, which isn't one of ${plane.id}'s variants`);
    if (!(depth >= near && depth <= far)) error(`${key} at ${at} s lies at depth ${depth}, outside ${plane.id}'s depths ${near}..${far}`);
    if (!(visibility >= 0 && visibility <= 1)) error(`${key} at ${at} s is ${visibility} visible; visibility is within 0..1`);
    const { placement: { x, y, rotation, scale }, pivot } = lay;
    if (![x, y, rotation, pivot.x, pivot.y].every(Number.isFinite) || !(scale > 0 && Number.isFinite(scale))) {
      error(`${key} at ${at} s is laid by a placement that isn't finite or scales by ${scale}; a lay scales by more than 0`);
    }
  }
  return problems;
}

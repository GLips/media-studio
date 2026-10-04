// shot-masks.ts: a plane's presentation masks as a graph. An alphaOf mask reads another drawable's laid coverage, so
// the masks order the planes, and a mask must never read itself through any chain. Masks cut finished films in a
// plane's document px and never enter a solve: a reader's picture is keyed by what it read.

import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { shotDrawableNamer, shotOccurrencePlane } from './shot-occurrences.ts';
import type { InstancedPlaneProps, OccurrenceKey, PlaneProps } from './shot-props.ts';

/**
 * A shot's alphaOf reads resolved: `order`, every plane id, each after the planes its masks read; `read`, every
 * drawable an alphaOf mask names, whose coverage its plane's lay gathers step by step as it's laid.
 */
export type ShotMaskGraph = { readonly order: readonly string[]; readonly read: ReadonlySet<string> };

/** A shot's masks checked as it loads: every problem, and the graph, null while there are any. */
export type ShotMaskCheck = { readonly graph: ShotMaskGraph | null; readonly problems: readonly PaintingProblem[] };

/** An alphaOf edge: plane `from`'s mask `mask` reads `drawable`, which lies on plane `to`. */
type MaskRead = { readonly mask: number; readonly drawable: string; readonly to: string };

/**
 * A shot's `planes`' masks checked over `occurrences` (each painted plane's keys, from its first evaluation): each
 * alphaOf naming a plane or an occurrence, never an instanced plane's item. Masks cut
 * painted films, so a picture or three plane takes none. A chain of reads back to its own plane is refused, named.
 */
export function shotMaskCheck(planes: readonly (PlaneProps | InstancedPlaneProps)[], occurrences: ReadonlyMap<string, readonly OccurrenceKey[]>): ShotMaskCheck {
  const problems: PaintingProblem[] = [], read = new Set<string>(), reads = new Map<string, MaskRead[]>(), named = shotDrawableNamer(planes, occurrences);
  for (const plane of planes) {
    const edges: MaskRead[] = [];
    reads.set(plane.id, edges);
    if (plane.kind === 'instanced' || !plane.masks?.length) continue;
    const source = typeof plane.source === 'function' ? 'layers' : plane.source.kind;
    if (source === 'picture' || source === 'three') {
      problems.push(paintingProblem('error', plane.id, 'masks', `masks cut painted films, and a ${source} plane has none`));
      continue;
    }
    plane.masks.forEach((mask, i) => {
      const { drawable } = mask, on = shotOccurrencePlane(drawable), field = `masks[${i}].drawable`;
      switch (named(drawable)) {
        case 'plane':
        case 'occurrence':
          edges.push({ mask: i, drawable, to: on });
          read.add(drawable);
          return;
        case 'item':
          problems.push(paintingProblem('error', plane.id, field, `names ${drawable}, but ${on}'s items aren't occurrences: read ${on}`));
          return;
        case 'unknown':
          problems.push(paintingProblem('error', plane.id, field, `names ${drawable}, which is no plane or occurrence of this shot`));
      }
    });
  }
  // Depth first in written order: a plane joins the order once everything it reads has, and a read reaching a plane
  // still being visited closes a chain back to it.
  const order: string[] = [], state = new Map<string, 'visiting' | 'done'>(), stack: { plane: string; edge: MaskRead }[] = [];
  const visit = (plane: string) => {
    state.set(plane, 'visiting');
    for (const edge of reads.get(plane) ?? []) {
      const at = state.get(edge.to);
      if (at === 'done') continue;
      if (at === 'visiting') {
        const start = edge.to === plane ? stack.length : stack.findIndex((step) => step.plane === edge.to);
        problems.push(maskCycleProblem([...stack.slice(start), { plane, edge }]));
        continue;
      }
      stack.push({ plane, edge });
      visit(edge.to);
      stack.pop();
    }
    state.set(plane, 'done');
    order.push(plane);
  };
  for (const { id } of planes) if (!state.has(id)) visit(id);
  return { graph: problems.length ? null : { order, read }, problems };
}

/**
 * A painted plane at one moment as its presented keys read it: each selection it blends (one, unless it dissolves),
 * by its plan's key and weight; and what its alphaOf masks read, in mask order.
 */
export type ShotPresentedPlan = { readonly shares: readonly { readonly key: string; readonly weight: number }[]; readonly alphaOf: readonly OccurrenceKey[] };

/** A painted plane's presented keys: each selection's picture's, and the plane's as a reader names the pictures summed. */
export type ShotPresentedKeys = { readonly shares: readonly string[]; readonly plane: string };

/**
 * Each painted plane's presented keys, in the masks' `order`. A selection's picture is kept under its plan's key, a
 * reader's adding what each mask reads: a painted plane's key (presented first) or a source's render as `sourceKey`
 * names it. A dissolve's plane key adds its weights, a selection's never, so moving only the weights lays nothing anew.
 */
export function shotPresentedKeys(
  order: readonly string[], plans: ReadonlyMap<string, ShotPresentedPlan>, sourceKey: (plane: string, reader: string) => string,
): Map<string, ShotPresentedKeys> {
  const keys = new Map<string, ShotPresentedKeys>();
  for (const id of order) {
    const plan = plans.get(id);
    if (!plan) continue;
    const read = plan.alphaOf.map((drawable) => {
      const on = shotOccurrencePlane(drawable);
      return [drawable, plans.has(on) ? keys.get(on)!.plane : sourceKey(on, id)];
    });
    const shares = plan.shares.map(({ key }) => (read.length ? JSON.stringify([key, read]) : key)), [lone] = plan.shares;
    keys.set(id, { shares, plane: shares.length === 1 && lone.weight === 1 ? shares[0] : JSON.stringify(shares.map((key, i) => [key, plan.shares[i].weight])) });
  }
  return keys;
}

/** The problem a chain of alphaOf reads returning to its first plane is, at that plane's first read. */
function maskCycleProblem(chain: readonly { plane: string; edge: MaskRead }[]): PaintingProblem {
  const [{ plane, edge }] = chain;
  const message = chain.length === 1 && edge.to === plane
    ? `reads ${edge.drawable}, on ${plane} itself`
    : `reads ${chain.map((step) => step.edge.drawable).join(', whose mask reads ')}`;
  return paintingProblem('error', plane, `masks[${edge.mask}].drawable`, message);
}

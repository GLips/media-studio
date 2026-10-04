// shot-masks.ts: a plane's presentation masks as geometry and as a graph. A path mask shows its subpaths' first
// `revealPx` of inked length, as round-ended capsules a pass draws with max blending; an alphaOf mask reads another
// drawable's laid coverage, so the masks order the planes, and a mask must never read itself through any chain. Masks
// cut finished films in a plane's document px and never enter a solve: a reader's picture is keyed by what it read.

import { isPaintingFinitePoint, isPaintingList, paintingField, paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { shotDrawableNamer, shotOccurrencePlane } from './shot-occurrences.ts';
import type { InstancedPlaneProps, OccurrenceKey, PlaneMask, PlaneProps } from './shot-props.ts';

export type PathMask = Extract<PlaneMask, { readonly kind: 'path' }>;
export type AlphaOfMask = Extract<PlaneMask, { readonly kind: 'alphaOf' }>;

/** One revealed run of a path mask: its segment from `a` to `b` (a dot where they meet), drawn `widthPx` across with round ends. */
export type ShotMaskCapsule = { readonly a: StampPoint; readonly b: StampPoint };

const between = (a: StampPoint, b: StampPoint, share: number): StampPoint => ({ x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share });

/** The inked length of `subpaths`, px: their segments' lengths summed. A pen-up between two subpaths adds nothing. */
export function shotPathInkedLength(subpaths: readonly (readonly StampPoint[])[]): number {
  let length = 0;
  for (const subpath of subpaths) for (let i = 1; i < subpath.length; i++) length += Math.hypot(subpath[i].x - subpath[i - 1].x, subpath[i].y - subpath[i - 1].y);
  return length;
}

/**
 * The capsules showing the first `revealPx` of `subpaths`' inked length, in drawing order, the last cut where the
 * reveal ends: the band keeps its width there, round-capped, never tapered. A dot (a subpath with no length) shows
 * once the reveal reaches its place, so the whole inked length shows a closing full stop; 0 shows nothing.
 */
export function shotPathMaskCapsules(subpaths: readonly (readonly StampPoint[])[], revealPx: number): ShotMaskCapsule[] {
  const capsules: ShotMaskCapsule[] = [];
  if (!(revealPx > 0)) return capsules;
  let inked = 0;
  for (const subpath of subpaths) {
    if (shotPathInkedLength([subpath]) === 0) {
      if (inked > revealPx) break;
      capsules.push({ a: subpath[0], b: subpath[0] });
      continue;
    }
    for (let i = 1; i < subpath.length; i++) {
      const a = subpath[i - 1], b = subpath[i], length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length === 0) continue;
      // Ink the reveal hasn't reached hides everything after it, a dot included.
      if (inked >= revealPx) return capsules;
      capsules.push({ a, b: inked + length <= revealPx ? b : between(a, b, (revealPx - inked) / length) });
      inked += length;
    }
  }
  return capsules;
}

/**
 * The document box a path mask's band can reach, whole px: its subpaths' box grown by half its width, and a texel
 * more for a read's bilinear tap at its edge.
 */
export function shotPathMaskBox({ subpaths, widthPx }: Pick<PathMask, 'subpaths' | 'widthPx'>): StampBox {
  const reach = widthPx / 2 + 1, first: StampPoint = subpaths[0][0];
  const box = subpaths.flat().reduce((grown, { x, y }) => ({ x0: Math.min(grown.x0, x), y0: Math.min(grown.y0, y), x1: Math.max(grown.x1, x), y1: Math.max(grown.y1, y) }), { x0: first.x, y0: first.y, x1: first.x, y1: first.y });
  return { x0: Math.floor(box.x0 - reach), y0: Math.floor(box.y0 - reach), x1: Math.ceil(box.x1 + reach), y1: Math.ceil(box.y1 + reach) };
}

/**
 * How much a path mask's band shows a pixel `distance` px from the nearest revealed segment: wholly within
 * `widthPx` / 2 less `softPx`, fading to nothing at `widthPx` / 2, so the band is `widthPx` across in all however
 * soft. A pass draws each capsule with this and keeps the greatest.
 */
export function shotPathMaskCover(distance: number, widthPx: number, softPx = 0): number {
  const edge = widthPx / 2;
  if (softPx === 0) return distance <= edge ? 1 : 0;
  return Math.min(1, Math.max(0, (edge - distance) / softPx));
}

/**
 * Why a path mask's `revealPx` can't be shown (`masks[mask].revealPx` of `plane`), or null: a callback's value read
 * at scene second `at` each frame, a constant's (no `at`) as the shot loads.
 */
export function shotPathRevealProblem(plane: string, mask: number, revealPx: number, at?: number): PaintingProblem | null {
  if (revealPx >= 0) return null;
  return paintingProblem('error', plane, `masks[${mask}].revealPx`, `${revealPx}${at === undefined ? '' : ` at ${at} s`}; a reveal is 0 px or more`);
}

/** A path mask's problems that don't change by frame: its subpaths, width and softness, and a constant reveal. */
function pathMaskProblems(plane: string, mask: number, { subpaths, widthPx, softPx = 0, revealPx }: PathMask): PaintingProblem[] {
  const problems: PaintingProblem[] = [], error = (within: string, message: string) => problems.push(paintingProblem('error', plane, paintingField(`masks[${mask}]`, within), message));
  if (!isPaintingList(subpaths) || subpaths.length === 0) error('subpaths', 'a path mask needs a subpath');
  else {
    subpaths.forEach((subpath, i) => {
      if (!isPaintingList(subpath) || subpath.length === 0 || !subpath.every(isPaintingFinitePoint)) error(`subpaths[${i}]`, 'a subpath is one or more finite points');
    });
  }
  if (!(widthPx > 0 && Number.isFinite(widthPx))) error('widthPx', `${widthPx}; a band's width is above 0`);
  if (!(softPx >= 0 && Number.isFinite(softPx))) error('softPx', `${softPx}; a band softens by 0 px or more`);
  const reveal = typeof revealPx === 'number' ? shotPathRevealProblem(plane, mask, revealPx) : null;
  return reveal ? [...problems, reveal] : problems;
}

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
 * path mask's shape, and each alphaOf naming a plane or an occurrence, never an instanced plane's item. Masks cut
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
      if (mask.kind === 'path') {
        problems.push(...pathMaskProblems(plane.id, i, mask));
        return;
      }
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

// shot-masks.ts: a plane's presentation masks as geometry and as a graph. A path mask shows its subpaths' first
// `revealPx` of inked length, as round-ended capsules a pass draws with max blending; an alphaOf mask reads another
// drawable's laid coverage, so the masks order the planes, and a mask must never read itself through any chain. Masks
// cut finished films in a plane's document px and never enter a solve.

import { isPaintingFinitePoint, isPaintingList, paintingField, paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
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
 * The capsules showing the first `revealPx` of `subpaths`' inked length, in drawing order: each segment the reveal
 * passes whole, then the one it ends in cut where it ends. The band keeps its width to the end, round-capped there,
 * never tapered. A subpath with no length is a dot, shown once the reveal passes its place; 0 shows nothing.
 */
export function shotPathMaskCapsules(subpaths: readonly (readonly StampPoint[])[], revealPx: number): ShotMaskCapsule[] {
  const capsules: ShotMaskCapsule[] = [];
  let inked = 0;
  for (const subpath of subpaths) {
    if (inked >= revealPx) break;
    if (shotPathInkedLength([subpath]) === 0) {
      capsules.push({ a: subpath[0], b: subpath[0] });
      continue;
    }
    for (let i = 1; i < subpath.length && inked < revealPx; i++) {
      const a = subpath[i - 1], b = subpath[i], length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length === 0) continue;
      capsules.push({ a, b: inked + length <= revealPx ? b : between(a, b, (revealPx - inked) / length) });
      inked += length;
    }
  }
  return capsules;
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

/** Why a path mask's `revealPx` can't be shown (`masks[i].revealPx` of `plane`, read at scene second `at`), or null. */
export function shotPathRevealProblem(plane: string, mask: number, revealPx: number, at: number): PaintingProblem | null {
  return revealPx >= 0 ? null : paintingProblem('error', plane, `masks[${mask}].revealPx`, `${revealPx} at ${at} s; a reveal is 0 px or more`);
}

/** A path mask's problems that don't change by frame: its subpaths, width and softness, and a constant reveal. */
function pathMaskProblems(plane: string, field: string, { subpaths, widthPx, softPx = 0, revealPx }: PathMask): PaintingProblem[] {
  const problems: PaintingProblem[] = [], error = (within: string, message: string) => problems.push(paintingProblem('error', plane, paintingField(field, within), message));
  if (!isPaintingList(subpaths) || subpaths.length === 0) error('subpaths', 'a path mask needs a subpath');
  else {
    subpaths.forEach((subpath, i) => {
      if (!isPaintingList(subpath) || subpath.length === 0 || !subpath.every(isPaintingFinitePoint)) error(`subpaths[${i}]`, 'a subpath is one or more finite points');
    });
  }
  if (!(widthPx > 0 && Number.isFinite(widthPx))) error('widthPx', `${widthPx}; a band's width is above 0`);
  if (!(softPx >= 0 && Number.isFinite(softPx))) error('softPx', `${softPx}; a band softens by 0 px or more`);
  if (typeof revealPx === 'number' && !(revealPx >= 0)) error('revealPx', `${revealPx}; a reveal is 0 px or more`);
  return problems;
}

/**
 * A shot's masks resolved: `order`, every plane id, each after the planes its alphaOf masks read; `read`, every
 * drawable an alphaOf mask names (a group occurrence among them composites on its own, as a faded one does); and
 * every problem, which leave `order` meaningless.
 */
export type ShotMaskGraph = { readonly order: readonly string[]; readonly read: ReadonlySet<string>; readonly problems: readonly PaintingProblem[] };

/** An alphaOf edge: plane `from`'s mask `mask` reads `drawable`, which lies on plane `to`. */
type MaskRead = { readonly mask: number; readonly drawable: string; readonly to: string };

/**
 * A shot's `planes`' masks resolved over `occurrences` (each painted plane's keys, from its first evaluation). An
 * alphaOf names a plane or an occurrence; an instanced plane's items aren't occurrences. Masks cut painted films, so a
 * picture or three plane takes none. A chain of reads back to its own plane is refused, named.
 */
export function shotMaskGraph(planes: readonly (PlaneProps | InstancedPlaneProps)[], occurrences: ReadonlyMap<string, readonly OccurrenceKey[]>): ShotMaskGraph {
  const problems: PaintingProblem[] = [], read = new Set<string>(), reads = new Map<string, MaskRead[]>();
  const kinds = new Map(planes.map((plane) => [plane.id, plane.kind === 'instanced' ? 'instanced' : 'plane']));
  const occurring = new Set([...occurrences.values()].flat());
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
      const field = `masks[${i}]`;
      if (mask.kind === 'path') {
        problems.push(...pathMaskProblems(plane.id, field, mask));
        return;
      }
      const { drawable } = mask, on = drawable.split('/')[0];
      if (kinds.has(drawable) || occurring.has(drawable)) {
        edges.push({ mask: i, drawable, to: on });
        read.add(drawable);
      } else if (kinds.get(on) === 'instanced') {
        problems.push(paintingProblem('error', plane.id, `${field}.drawable`, `names ${drawable}, but ${on}'s items aren't occurrences: read ${on}`));
      } else {
        problems.push(paintingProblem('error', plane.id, `${field}.drawable`, `names ${drawable}, which is no plane or occurrence of this shot`));
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
  return { order, read, problems };
}

/** The problem a chain of alphaOf reads returning to its first plane is, at that plane's first read. */
function maskCycleProblem(chain: readonly { plane: string; edge: MaskRead }[]): PaintingProblem {
  const [{ plane, edge }] = chain;
  const message = chain.length === 1 && edge.to === plane
    ? `reads ${edge.drawable}, on ${plane} itself`
    : `reads ${chain.map((step) => step.edge.drawable).join(', whose mask reads ')}`;
  return paintingProblem('error', plane, `masks[${edge.mask}].drawable`, message);
}

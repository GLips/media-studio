// stamp-plane.ts: a painted scene as planes, each a depth and a source. A painted source is some of the painting's
// groups: one picture, independent of the camera. A three source is a three.js render
// handed in each frame. The renderer lays the pictures far to near, each where the camera puts it.
//
// The farthest plane is paper to the stage's edge, the back. Every nearer painted plane is clear film, measured by
// laying it on white and on black: over those two it shows as on one sheet, and between them it's a two-point
// linearisation (stamp-paint-plane-passes.ts says where that's close). A group's knockout, lift or glaze reads only
// its own plane's paint.

import type { CompiledStampPaint } from './stamp-paint-recipe-compile.ts';

/**
 * What a plane shows. `painted`: `groups` (ids of the painting's, laid in its order), on paper for the back and on
 * clear film nearer. `three`: a three.js render, premultiplied linear colour, handed in each frame.
 */
export type StampPlaneSource = { readonly kind: 'painted'; readonly groups: readonly string[] } | { readonly kind: 'three' };

/** A plane `depth` units from the camera at rest (above 0; a camera's pan is measured at 1). */
export type StampPlane = { readonly id: string; readonly depth: number; readonly source: StampPlaneSource };

/** The back checked: paper to the stage's edge, its groups' indices in the painting, in its order. */
export type CompiledStampBackPlane = { readonly id: string; readonly depth: number; readonly groups: readonly number[] };
/** A nearer painted plane checked: clear film, its groups' indices in the painting, in its order. */
export type CompiledStampClearPlane = { readonly id: string; readonly depth: number; readonly kind: 'clear'; readonly groups: readonly number[] };
export type CompiledStampThreePlane = { readonly id: string; readonly depth: number; readonly kind: 'three' };
export type CompiledStampNearerPlane = CompiledStampClearPlane | CompiledStampThreePlane;

/** A scene's planes checked: the back, then the nearer ones farthest first, the order they're laid in. */
export type CompiledStampPlanes = { readonly back: CompiledStampBackPlane; readonly nearer: readonly CompiledStampNearerPlane[] };

/** Every plane of `planes`, farthest first: for what reads only a plane's id and depth. */
export const stampPlanesFarthestFirst = ({ back, nearer }: CompiledStampPlanes): readonly { readonly id: string; readonly depth: number }[] => [back, ...nearer];

/** The one plane a painting shown without a camera is: every group, on paper, at depth 1. */
export const STAMP_SINGLE_PLANE_ID = 'painting';

export const stampSinglePlane = (painting: CompiledStampPaint): CompiledStampPlanes =>
  ({ back: { id: STAMP_SINGLE_PLANE_ID, depth: 1, groups: painting.groups.map((_, i) => i) }, nearer: [] });

/**
 * `planes` checked over `painting` into `problems`, ordered farthest first, ties as declared: unique ids, depths above
 * 0, every group on exactly one painted plane, and the farthest painted (a three source behind the back would never
 * show). Null when there's no back to build on; `problems` then says why.
 */
export function compileStampPlanes(painting: CompiledStampPaint, planes: readonly StampPlane[], problems: string[]): CompiledStampPlanes | null {
  const indexOf = new Map(painting.groups.map(({ id }, i) => [id, i])), onPlane = new Map<string, string>(), ids = new Set<string>();
  const compiled: (CompiledStampClearPlane | CompiledStampThreePlane)[] = [];
  for (const { id, depth, source } of planes) {
    if (ids.has(id)) problems.push(`two planes are called ${id}`);
    ids.add(id);
    if (!(depth > 0 && Number.isFinite(depth))) problems.push(`plane ${id} is at depth ${depth}; a plane's depth is above 0`);
    if (source.kind === 'three') {
      compiled.push({ id, depth, kind: 'three' });
      continue;
    }
    for (const group of source.groups) {
      if (!indexOf.has(group)) problems.push(`plane ${id} shows ${group}, which isn't a group of the painting`);
      else if (onPlane.has(group)) problems.push(`${group} is on plane ${onPlane.get(group)} and plane ${id}; a group is on one plane`);
      else onPlane.set(group, id);
    }
    const groups = source.groups.flatMap((group) => indexOf.get(group) ?? []).toSorted((a, b) => a - b);
    compiled.push({ id, depth, kind: 'clear', groups });
  }
  const missing = painting.groups.filter(({ id }) => !onPlane.has(id));
  if (missing.length) problems.push(`${missing.map(({ id }) => id).join(', ')} ${missing.length > 1 ? 'are' : 'is'} on no plane`);
  const [back, ...nearer] = compiled.toSorted((a, b) => b.depth - a.depth);
  if (!back) {
    problems.push('a scene needs a plane');
    return null;
  }
  if (back.kind !== 'clear') {
    problems.push(`the farthest plane, ${back.id}, must be painted, on paper to the stage's edge`);
    return null;
  }
  return { back: { id: back.id, depth: back.depth, groups: back.groups }, nearer };
}

/**
 * How a frame shows one plane: `view`, plane points to frame px (p ↦ (ma + i·mb)·p + (kx + i·ky)), and `defocus`,
 * a gaussian's sigma in frame px over its picture (0 sharp).
 */
export type StampPlaneLook = { readonly view: { readonly ma: number; readonly mb: number; readonly kx: number; readonly ky: number }; readonly defocus: number };

/** What a frame's lens does: each plane's look by id (a plane left out is at rest and sharp), and its bloom's sigma, frame px. */
export type StampLensFrame = { readonly planes: ReadonlyMap<string, StampPlaneLook>; readonly bloom: number };

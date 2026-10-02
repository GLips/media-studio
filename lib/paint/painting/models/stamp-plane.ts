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

/**
 * A plane as the renderer lays it: a `picture` (painted groups, on paper for the farthest and on clear film nearer) or
 * a `three` render. A camera's planes are these (paint-camera.ts), so the renderer reads the camera's own list.
 */
export type StampScenePlane = { readonly id: string; readonly kind: 'picture' | 'three' };

/** Which of the painting's groups each picture plane shows, by plane id: their indices, in the painting's order. */
export type StampPlaneGroups = ReadonlyMap<string, readonly number[]>;

/** A scene's planes farthest first, the order they're laid in, and what each picture plane shows. */
export type StampScenePlanes = { readonly planes: readonly StampScenePlane[]; readonly groups: StampPlaneGroups };

/** The one plane a painting shown without a camera is: every group, on paper, at depth 1. */
export const STAMP_SINGLE_PLANE_ID = 'painting';

export const stampSinglePlane = (painting: CompiledStampPaint): StampScenePlanes =>
  ({ planes: [{ id: STAMP_SINGLE_PLANE_ID, kind: 'picture' }], groups: new Map([[STAMP_SINGLE_PLANE_ID, painting.groups.map((_, i) => i)]]) });

/** `planes`' ids and depths checked into `problems`: unique ids, depths above 0. */
export function stampPlaneDepthProblems(planes: readonly { readonly id: string; readonly depth: number }[], problems: string[]): void {
  const ids = new Set<string>();
  for (const { id, depth } of planes) {
    if (ids.has(id)) problems.push(`two planes are called ${id}`);
    ids.add(id);
    if (!(depth > 0 && Number.isFinite(depth))) problems.push(`plane ${id} is at depth ${depth}; a plane's depth is above 0`);
  }
}

/** A written plane checked: where it lies, and what it is. */
export type StampDepthPlane = StampScenePlane & { readonly depth: number };

/**
 * `planes` checked over `painting` into `problems`, ordered farthest first, ties as declared: unique ids, depths above
 * 0, every group on exactly one picture plane, and the farthest a picture (a three source behind the paper would never
 * show). Null when there's no paper to build on; `problems` then says why.
 */
export function stampScenePlanes(painting: CompiledStampPaint, planes: readonly StampPlane[], problems: string[]): { readonly planes: readonly StampDepthPlane[]; readonly groups: StampPlaneGroups } | null {
  const indexOf = new Map(painting.groups.map(({ id }, i) => [id, i])), onPlane = new Map<string, string>(), groups = new Map<string, readonly number[]>();
  stampPlaneDepthProblems(planes, problems);
  for (const { id, source } of planes) {
    if (source.kind === 'three') continue;
    for (const group of source.groups) {
      if (!indexOf.has(group)) problems.push(`plane ${id} shows ${group}, which isn't a group of the painting`);
      else if (onPlane.has(group)) problems.push(`${group} is on plane ${onPlane.get(group)} and plane ${id}; a group is on one plane`);
      else onPlane.set(group, id);
    }
    groups.set(id, source.groups.flatMap((group) => indexOf.get(group) ?? []).toSorted((a, b) => a - b));
  }
  const missing = painting.groups.filter(({ id }) => !onPlane.has(id));
  if (missing.length) problems.push(`${missing.map(({ id }) => id).join(', ')} ${missing.length > 1 ? 'are' : 'is'} on no plane`);
  const ordered = planes.toSorted((a, b) => b.depth - a.depth).map(({ id, depth, source }): StampDepthPlane => ({ id, depth, kind: source.kind === 'three' ? 'three' : 'picture' }));
  const back = ordered[0];
  if (!back) {
    problems.push('a scene needs a plane');
    return null;
  }
  if (back.kind !== 'picture') {
    problems.push(`the farthest plane, ${back.id}, must be painted, on paper to the stage's edge`);
    return null;
  }
  return { planes: ordered, groups };
}

/**
 * How a frame shows one plane: `view`, plane points to frame px (p ↦ (ma + i·mb)·p + (kx + i·ky)), and `defocus`,
 * a gaussian's sigma in frame px over its picture (0 sharp).
 */
export type StampPlaneLook = { readonly view: { readonly ma: number; readonly mb: number; readonly kx: number; readonly ky: number }; readonly defocus: number };

/** What a frame's lens does: each plane's look by id (a plane left out is at rest and sharp), and its bloom's sigma, frame px. */
export type StampLensFrame = { readonly planes: ReadonlyMap<string, StampPlaneLook>; readonly bloom: number };

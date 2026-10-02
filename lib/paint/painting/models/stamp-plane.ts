// stamp-plane.ts: a painted scene as planes, each a depth and a source. A painted source is some of the painting's
// groups: one picture, independent of the camera. A three source is a three.js render
// handed in each frame. The renderer lays the pictures far to near, each where the camera puts it.
//
// The farthest plane is paper to the stage's edge, the back. Every nearer painted plane is clear film, measured by
// laying it on white and on black: over those two it shows as on one sheet, and between them it's a two-point
// linearisation (stamp-paint-plane-passes.ts says where that's close). A group's knockout, lift or glaze reads only
// its own plane's paint.

import type { LensFocus } from '#lib/picture/lens/models/lens-focus.ts';
import type { CompiledStampPaint } from './stamp-paint-recipe-compile.ts';

/**
 * What a plane shows. `painted`: `groups` (ids of the painting's, laid in its order), on paper for the back and on
 * clear film nearer. `three`: a three.js render, premultiplied linear colour, handed in each frame.
 */
export type StampPlaneSource = { readonly kind: 'painted'; readonly groups: readonly string[] } | { readonly kind: 'three' };

/** A plane `depth` units from the camera at rest (above 0; a camera's pan is measured at 1). */
export type StampPlane = { readonly id: string; readonly depth: number; readonly source: StampPlaneSource };

/** A picture plane as laid: the painting's `groups` it shows, their indices in the painting's order. */
export type StampLaidPicturePlane = { readonly id: string; readonly kind: 'picture'; readonly groups: readonly number[] };
/** A three plane as laid: its render is handed in each frame. */
export type StampLaidThreePlane = { readonly id: string; readonly kind: 'three' };

/**
 * A scene's planes as the renderer lays them, farthest first: the `back`, a picture on paper to the stage's edge,
 * then the `nearer`, pictures on clear film and three renders. `Extra` is what each plane carries besides (a depth).
 */
export type StampLaidPlanes<Extra = unknown> = {
  readonly back: StampLaidPicturePlane & Extra;
  readonly nearer: readonly ((StampLaidPicturePlane | StampLaidThreePlane) & Extra)[];
};

/** The one plane a painting shown without a camera is: every group, on paper. */
export const STAMP_SINGLE_PLANE_ID = 'painting';

export const stampSinglePlane = (painting: CompiledStampPaint): StampLaidPlanes =>
  ({ back: { id: STAMP_SINGLE_PLANE_ID, kind: 'picture', groups: painting.groups.map((_, i) => i) }, nearer: [] });

/** `planes`' ids and depths checked into `problems`: unique ids, depths above 0. */
export function stampPlaneDepthProblems(planes: readonly { readonly id: string; readonly depth: number }[], problems: string[]): void {
  const ids = new Set<string>();
  for (const { id, depth } of planes) {
    if (ids.has(id)) problems.push(`two planes are called ${id}`);
    ids.add(id);
    if (!(depth > 0 && Number.isFinite(depth))) problems.push(`plane ${id} is at depth ${depth}; a plane's depth is above 0`);
  }
}

/**
 * `planes` checked over `painting` into `problems` and laid, farthest first, ties as declared: unique ids, depths
 * above 0, every group on exactly one picture plane, and the farthest a picture (a three source behind the paper would
 * never show). Null when there's no paper to build on; `problems` then says why.
 */
export function stampScenePlanes(painting: CompiledStampPaint, planes: readonly StampPlane[], problems: string[]): StampLaidPlanes<{ readonly depth: number }> | null {
  const indexOf = new Map(painting.groups.map(({ id }, i) => [id, i])), onPlane = new Map<string, string>();
  stampPlaneDepthProblems(planes, problems);
  const laid = planes.toSorted((a, b) => b.depth - a.depth).map(({ id, depth, source }) => {
    if (source.kind === 'three') return { id, depth, kind: 'three' as const };
    for (const group of source.groups) {
      if (!indexOf.has(group)) problems.push(`plane ${id} shows ${group}, which isn't a group of the painting`);
      else if (onPlane.has(group)) problems.push(`${group} is on plane ${onPlane.get(group)} and plane ${id}; a group is on one plane`);
      else onPlane.set(group, id);
    }
    return { id, depth, kind: 'picture' as const, groups: source.groups.flatMap((group) => indexOf.get(group) ?? []).toSorted((a, b) => a - b) };
  });
  const missing = painting.groups.filter(({ id }) => !onPlane.has(id));
  if (missing.length) problems.push(`${missing.map(({ id }) => id).join(', ')} ${missing.length > 1 ? 'are' : 'is'} on no plane`);
  const [back, ...nearer] = laid;
  if (!back) {
    problems.push('a scene needs a plane');
    return null;
  }
  if (back.kind !== 'picture') {
    problems.push(`the farthest plane, ${back.id}, must be painted, on paper to the stage's edge`);
    return null;
  }
  return { back, nearer };
}

/** A similarity, plane points to frame px: p ↦ (ma + i·mb)·p + (kx + i·ky). */
export type StampPlaneView = { readonly ma: number; readonly mb: number; readonly kx: number; readonly ky: number };

/**
 * How a frame shows one plane: `view`; `defocus`, a gaussian's sigma in frame px over its picture (0 sharp);
 * `distance`, from the camera, depth units; `shutter`, its views as the shutter opens and closes in a frame gathered
 * along its motion, else null.
 */
export type StampPlaneLook = {
  readonly view: StampPlaneView;
  readonly defocus: number;
  readonly distance: number;
  readonly shutter: { readonly open: StampPlaneView; readonly close: StampPlaneView } | null;
};

/**
 * What a frame's lens does: each plane's look by id (a plane left out is at rest and sharp), and its bloom's sigma,
 * frame px. `focus`: what defocuses a three plane per pixel, its focus measured from the camera (null: sharp).
 * `moving`: the frame is gathered along its motion, a fast frame with its shutter open.
 */
export type StampLensFrame = { readonly planes: ReadonlyMap<string, StampPlaneLook>; readonly bloom: number; readonly focus: LensFocus | null; readonly moving: boolean };

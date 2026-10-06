// stamp-plane.ts: a scene as planes, each a depth and a source: some of the painting's groups (independent of the
// camera), a picture handed in at each moment in the stage's texels however it was made, or a three.js render handed
// in each frame through the camera. The renderer lays them far to near, each where the camera puts it.
//
// The back is opaque wherever the frame shows it: paper to the stage's edge, or a picture covering the frame. A nearer
// painted plane is clear film, measured on white and on black: a two-point linearisation between them
// (stamp-paint-plane-passes.ts says where that's close). A group's knockout, lift or glaze reads only its own plane.

import type { LensFocus } from '#lib/picture/lens/models/lens-focus.ts';
import type { CompiledStampPaint } from './stamp-paint-recipe-compile.ts';
import type { StampBox } from './stamp-region.ts';
import type { PaintMoment } from './stamp-paint-frame-state.ts';
import type { StampStageTexels } from './stamp-stage.ts';

/**
 * Where a picture plane can hold anything, which a camera keeps on the stage wherever it shows it: within `box`
 * (painting points), everywhere (it can't be bounded), or nowhere (empty). `unchecked`: the camera isn't told, and
 * holds nothing of it; `why` says who holds it instead.
 */
export type StampPlaneExtent =
  | { readonly kind: 'box'; readonly box: StampBox }
  | { readonly kind: 'everywhere' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'unchecked'; readonly why: string };

/**
 * What a plane shows. `painted`: `groups` (ids of the painting's, laid in its order), on paper for the back and on
 * clear film nearer. `picture`: a picture source's, premultiplied linear colour, held as far as its `extent`. `three`:
 * a three.js render, premultiplied linear colour.
 */
export type StampPlaneSource =
  | { readonly kind: 'painted'; readonly groups: readonly string[] }
  | { readonly kind: 'picture'; readonly extent: StampPlaneExtent }
  | { readonly kind: 'three' };

/**
 * A picture plane's picture: premultiplied linear RGBA, four floats a texel, row by row over `box`, whole texels
 * within the stage (stamp-stage.ts).
 */
export type StampPictureRgba = { readonly box: StampStageTexels; readonly rgba: Float32Array };

/**
 * A picture plane's source: its picture at `moment` (a frame's own, or a shutter moment within it), or null for
 * nothing. Warning: a picture handed back is never changed after; hand back the same one for a still plane, and it
 * uploads once. Negative space: no motion of its own; a fast frame blurs it only as its plane moves.
 */
export type StampPictureAt = (moment: PaintMoment) => Promise<StampPictureRgba | null>;

/** A plane `depth` units from the camera at rest (above 0; a camera's pan is measured at 1). */
export type StampPlane = { readonly id: string; readonly depth: number; readonly source: StampPlaneSource };

/** A painted plane as laid: the painting's `groups` it shows, their indices in the painting's order. */
export type StampLaidPaintedPlane = { readonly id: string; readonly kind: 'painted'; readonly groups: readonly number[] };
/** A picture plane as laid: its picture is handed in at each moment, held within its `extent`. */
export type StampLaidPicturePlane = { readonly id: string; readonly kind: 'picture'; readonly extent: StampPlaneExtent };
/** A three plane as laid: its render is handed in each frame. */
export type StampLaidThreePlane = { readonly id: string; readonly kind: 'three' };
/** A plane whose picture a source hands in rather than the painting painting it. */
export type StampLaidSourcePlane = StampLaidPicturePlane | StampLaidThreePlane;

/**
 * A scene's planes as the renderer lays them, farthest first: the `back`, opaque (painted on paper to the stage's
 * edge, or a picture), then the `nearer`, painted film, pictures and three renders. `Extra` is what each plane carries
 * besides (a depth).
 */
export type StampLaidPlanes<Extra = unknown> = {
  readonly back: (StampLaidPaintedPlane | StampLaidPicturePlane) & Extra;
  readonly nearer: readonly ((StampLaidPaintedPlane | StampLaidSourcePlane) & Extra)[];
};

/** The one plane a painting shown without a camera is: every group, on paper. */
export const STAMP_SINGLE_PLANE_ID = 'painting';

export const stampSinglePlane = (painting: CompiledStampPaint): StampLaidPlanes =>
  ({ back: { id: STAMP_SINGLE_PLANE_ID, kind: 'painted', groups: painting.groups.map((_, i) => i) }, nearer: [] });

/** `planes`' ids and depths checked into `problems`: unique ids, depths above 0 (null: a depth in time, checked where it's sampled). */
export function stampPlaneDepthProblems(planes: readonly { readonly id: string; readonly depth: number | null }[], problems: string[]): void {
  const ids = new Set<string>();
  for (const { id, depth } of planes) {
    if (ids.has(id)) problems.push(`two planes are called ${id}`);
    ids.add(id);
    if (depth !== null && !(depth > 0 && Number.isFinite(depth))) problems.push(`plane ${id} is at depth ${depth}; a plane's depth is above 0`);
  }
}

/**
 * `planes` checked over `painting` (null for a scene that paints nothing) into `problems` and laid, farthest first,
 * ties as declared: unique ids, depths above 0, every group on exactly one painted plane, and the farthest painted or
 * a picture (a three source behind it would never show). Null when there's no back to build on; `problems` then says why.
 */
export function stampScenePlanes(painting: CompiledStampPaint | null, planes: readonly StampPlane[], problems: string[]): StampLaidPlanes<{ readonly depth: number }> | null {
  const groups = painting?.groups ?? [];
  const indexOf = new Map(groups.map(({ id }, i) => [id, i])), onPlane = new Map<string, string>();
  stampPlaneDepthProblems(planes, problems);
  const laid = planes.toSorted((a, b) => b.depth - a.depth).map(({ id, depth, source }): (StampLaidPaintedPlane | StampLaidSourcePlane) & { readonly depth: number } => {
    if (source.kind === 'three') return { id, depth, kind: 'three' };
    if (source.kind === 'picture') return { id, depth, kind: 'picture', extent: source.extent };
    if (!painting) {
      problems.push(`plane ${id} is painted, and the scene has no painting`);
      return { id, depth, kind: 'painted', groups: [] };
    }
    for (const group of source.groups) {
      if (!indexOf.has(group)) problems.push(`plane ${id} shows ${group}, which isn't a group of the painting`);
      else if (onPlane.has(group)) problems.push(`${group} is on plane ${onPlane.get(group)} and plane ${id}; a group is on one plane`);
      else onPlane.set(group, id);
    }
    return { id, depth, kind: 'painted', groups: source.groups.flatMap((group) => indexOf.get(group) ?? []).toSorted((a, b) => a - b) };
  });
  const missing = groups.filter(({ id }) => !onPlane.has(id));
  if (missing.length) problems.push(`${missing.map(({ id }) => id).join(', ')} ${missing.length > 1 ? 'are' : 'is'} on no plane`);
  const [back, ...nearer] = laid;
  if (!back) {
    problems.push('a scene needs a plane');
    return null;
  }
  if (back.kind === 'three') {
    problems.push(`the farthest plane, ${back.id}, must be opaque to the frame's edge: painted, or a picture`);
    return null;
  }
  if (back.kind === 'picture' && back.extent.kind !== 'everywhere') problems.push(`the farthest plane, ${back.id}, is a picture held ${back.extent.kind === 'box' ? 'within a box' : back.extent.kind}; the back's extent is everywhere`);
  return { back, nearer };
}

/** A similarity, plane points to frame px: p ↦ (ma + i·mb)·p + (kx + i·ky). */
export type StampPlaneView = { readonly ma: number; readonly mb: number; readonly kx: number; readonly ky: number };

/**
 * How a frame shows one plane: `view`; `defocus`, a gaussian's sigma in frame px over its picture (0 sharp);
 * `distance`, from the camera, depth units; `shutter`, its views as the shutter opens and closes in a fast frame when
 * they differ, else null.
 */
export type StampPlaneLook = {
  readonly view: StampPlaneView;
  readonly defocus: number;
  readonly distance: number;
  readonly shutter: { readonly open: StampPlaneView; readonly close: StampPlaneView } | null;
};

/** Rest: a plane where it's painted, sharp. */
export const STAMP_REST_LOOK: StampPlaneLook = { view: { ma: 1, mb: 0, kx: 0, ky: 0 }, defocus: 0, distance: 1, shutter: null };

/**
 * What a frame's lens does: each plane's look by id (a plane left out is at rest and sharp), and its bloom's sigma,
 * frame px. `focus`: what defocuses a three plane per pixel by its texels' distances, its focus measured from the
 * camera (null: sharp); a painted or picture plane defocuses by its look's `defocus`.
 */
export type StampLensFrame = { readonly planes: ReadonlyMap<string, StampPlaneLook>; readonly bloom: number; readonly focus: LensFocus | null };

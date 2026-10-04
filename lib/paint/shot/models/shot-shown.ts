// shot-shown.ts: which of a shot's painted planes and instanced variants a frame solves (ENGINE 6.1 step 1): those
// showing at one of its exposures, read before anything is solved. A plane faded to nothing, or whose every layer is
// (by itself or a group holding it) on a transparent ground, lays nothing and covers nothing for a mask reading it, so
// it goes unsolved; the opaque back always shows. A variant shows as its instanced plane does (CompiledShotVariant's
// id), whatever its items do. A layer a marks rig hides by its pose still counts: a pose isn't read before a solve.

import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { lensExposures } from '#lib/picture/lens/models/lens-exposures.ts';
import { LENS_REFERENCE_EXPOSURES, type LensMode } from '#lib/picture/lens/models/lens-mode.ts';
import { shutterMomentAt } from '#lib/picture/lens/models/lens-shutter.ts';
import { shotPaintedSolvables, type CompiledPaintedShot, type CompiledShotPaintedPlane } from './shot-compile.ts';
import { shotPlaneClocks, shotVisibilityAt } from './shot-frame-plan.ts';
import type { OccurrenceKey } from './shot-props.ts';
import { shotWarmCombinations } from './shot-warm.ts';

/**
 * The moments frame `t`'s exposures lie at in lens mode `mode`, its shutter open `shutter` s: the frame's own when
 * fast; each reference exposure's, in order, where it samples the shutter.
 */
export function shotExposureMoments(shutter: number, t: number, mode: LensMode): PaintMoment[] {
  if (mode === 'fast') return [paintMoment(t)];
  return lensExposures(LENS_REFERENCE_EXPOSURES).map(({ shutter: share }) => paintMoment(shutterMomentAt(t, shutter, share), t));
}

/**
 * Whether `plane`, a painted plane or variant of `shot`, lays anything at `moment`: it isn't faded out, and its ground
 * is paper or one of its layers shows through every group holding it. A source shows the same occurrences at every
 * moment (shotPlaneSharesAt), so its first's tell.
 */
function shotPlaneShowsAt(shot: CompiledPaintedShot, plane: CompiledShotPaintedPlane, moment: PaintMoment): boolean {
  const shown = (key: OccurrenceKey) => shotVisibilityAt(shot, plane.id, key, moment) > 0;
  if (!shown(plane.id)) return false;
  return plane.paints.ground === 'paper' || plane.occurrences.some(({ kind, key, groups }) => kind === 'layer' && shown(key) && groups.every(shown));
}

/** Whether `plane`, a painted plane or variant of `shot`, shows at one of `moments`. */
export const shotPlaneShows = (shot: CompiledPaintedShot, plane: CompiledShotPaintedPlane, moments: readonly PaintMoment[]) =>
  plane.opaqueBack || moments.some((moment) => shotPlaneShowsAt(shot, plane, moment));

/** What of `shot` a frame whose exposures lie at `moments` solves (shotPaintedSolvables', in order), and how many it leaves hidden. */
export function shotSolvablesShown(shot: CompiledPaintedShot, moments: readonly PaintMoment[]): { shown: CompiledShotPaintedPlane[]; hidden: number } {
  const all = shotPaintedSolvables(shot), shown = all.filter((plane) => shotPlaneShows(shot, plane, moments));
  return { shown, hidden: all.length - shown.length };
}

/**
 * The frames of a warm's `frames` it solves `plane` at: shotWarmCombinations' over those it shows at in lens mode
 * `mode`; and how many more it would solve were it never hidden.
 */
export function shotWarmShown(shot: CompiledPaintedShot, plane: CompiledShotPaintedPlane, frames: readonly PaintMoment[], mode: LensMode): { frames: PaintMoment[]; hidden: number } {
  const clocks = shotPlaneClocks(shot.motion, plane), fps = shot.motion.animationFps, { shutter } = shot.camera.lens;
  const shows = frames.filter((frame) => shotPlaneShows(shot, plane, shotExposureMoments(shutter, frame.at, mode)));
  const solved = shotWarmCombinations(shows, clocks, fps);
  return { frames: solved, hidden: shows.length === frames.length ? 0 : shotWarmCombinations(frames, clocks, fps).length - solved.length };
}

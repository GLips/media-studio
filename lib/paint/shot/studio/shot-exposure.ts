// shot-exposure.ts: sample the same camera geometry for the displayed frame and every historical image it reads.

import { paintCameraDepthLooks, paintCameraLensFrame, type PaintCameraDepthLooks } from '#lib/paint/animation/models/paint-camera.ts';
import { paintViewAcross } from '#lib/paint/animation/models/paint-camera-depths.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { STAMP_REST_LOOK, type StampLensFrame } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampLensSourceExposure } from '#lib/paint/painting/studio/stamp-lens-source.ts';
import type { LensMode } from '#lib/picture/lens/models/lens-mode.ts';
import { shutterOpensAt } from '#lib/picture/lens/models/lens-shutter.ts';
import type { CompiledPaintedShot } from '../models/shot-compile.ts';
import type { ShotMaskAcross } from '../models/shot-masks.ts';
import type { ShotMomentAt } from '../models/shot-sheet-lays.ts';
import { shotExposureMoments } from '../models/shot-shown.ts';

/**
 * One exposure of a frame: its lens (the camera's looks at any depth, and its planes' looks), the moment its planes
 * lie at, its shutter's ends when it gathers motion, and the sources' exposure.
 */
export type ShotExposure = ShotMomentAt & {
  readonly looks: PaintCameraDepthLooks; readonly lens: StampLensFrame; readonly exposure: (StampLensSourceExposure & { readonly count: number }) | null;
};

type ApertureSample = Pick<NonNullable<ShotExposure['exposure']>, 'index' | 'count' | 'aperture'>;

/** Evaluate the mapped frame and shutter instant through the same point on the aperture as the reader. */
export function shotExposureAt(shot: CompiledPaintedShot, at: PaintMoment, sample: ApertureSample | null): ShotExposure {
  const { camera } = shot, { shutter } = camera.lens;
  if (sample || at.at !== at.frame) {
    const exposure = { index: 0, count: 1, aperture: [0, 0] as const, ...sample, at: at.at };
    const looks = paintCameraDepthLooks(camera, at.frame, exposure);
    return { looks, lens: paintCameraLensFrame(camera, looks), at, shutter: null, exposure };
  }
  const opens = shutterOpensAt(at.at, shutter), looks = paintCameraDepthLooks(camera, at.at);
  const moments = shutter > 0 ? { open: paintMoment(opens, at.frame), close: paintMoment(opens + shutter, at.frame) } : null;
  return { looks, lens: paintCameraLensFrame(camera, looks), at, shutter: moments, exposure: null };
}

export function shotExposures(shot: CompiledPaintedShot, t: number, mode: LensMode): ShotExposure[] {
  return shotExposureMoments(shot.camera.lens.shutter, t, mode).map(({ exposure, at }) => shotExposureAt(shot, at, exposure));
}

/** How `exposure`'s camera shows plane `id`, plane px to frame px. */
export const shotExposureView = (exposure: ShotExposure, id: string) => (exposure.lens.planes.get(id) ?? STAMP_REST_LOOK).view;

/** `exposure`'s map from a reader's plane px to a painted or picture plane's, where its camera shows both on one frame px. */
export const shotExposureAcross = (exposure: ShotExposure): ShotMaskAcross => (plane, reader) =>
  paintViewAcross(shotExposureView(exposure, reader), shotExposureView(exposure, plane));

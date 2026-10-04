// painted-three-camera.ts: the shot camera a three plane renders through at a moment: the paint camera posed then,
// its frame grown by the plane's defocus margin and, for a reference exposure, moved to its point on the aperture.

import { paintCameraShotAt, type PaintCameraWorld } from '#lib/paint/animation/models/paint-camera-world.ts';
import { paintCameraFocusAt, paintCameraPoseAt, type PaintCamera } from '#lib/paint/animation/models/paint-camera.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { LensExposure } from '#lib/picture/lens/models/lens-exposures.ts';
import { shotCameraExposed, shotLensOfFocus } from '#lib/picture/lens/models/lens-focus.ts';
import { shotCameraGrown, type ShotCamera } from '#lib/picture/shot-camera/models/shot-camera.ts';

/**
 * What `camera` (in `world`) sees at `moment`, its frame grown by `margin` px on every side. Seen from `aperture`'s
 * point on the lens (a reference exposure's) when given, moved over the aperture and its lens shifted so the focus
 * holds still; a camera without a focus is a pinhole, the same from every point. Null: from the lens's centre.
 */
export function paintedThreeShotCamera(camera: PaintCamera, world: PaintCameraWorld, margin: number, moment: PaintMoment, aperture: LensExposure['aperture'] | null): ShotCamera {
  const pose = paintCameraPoseAt(camera, moment), shot = shotCameraGrown(paintCameraShotAt(world, pose), margin);
  if (!aperture) return shot;
  // The aperture's opening (frame px of blur at infinity) as the shot camera's, in world units at the focus.
  const focus = paintCameraFocusAt(camera, moment), distance = focus && focus.focus - pose.dolly;
  const lens = focus && distance ? shotLensOfFocus(shot, { focus: distance, aperture: focus.aperture }, distance * world.depthUnit) : null;
  return shotCameraExposed(shot, lens, { aperture, pixel: [0, 0] });
}

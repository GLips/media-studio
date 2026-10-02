// lens-focus.ts: the lens's focus as the studio measures it, for painted planes and three.js alike. A thin lens with
// an apodised (gaussian) aperture blurs a point at distance d by a gaussian of sigma aperture·|1 − focus/d| frame px,
// `aperture` being the sigma a point at infinity gets. The lens's own factor f/(f − focal length), near 1, is left in
// the aperture.
//
// An exposure sees the scene from one point of the aperture: everything at distance d slides aperture·(1 − focus/d)
// px times that point, the focal plane holding still. Averaged over the aperture's samples (lens-exposures.ts), the
// slides make that gaussian; the fast path draws it directly.

import { Vector3 } from 'three';
import { shotCameraAxes, shotCameraFocalPx, type ShotCamera } from '#lib/picture/shot-camera/models/shot-camera.ts';
import type { LensExposure } from './lens-exposures.ts';

/** `focus`: the distance held sharp, in the units distances are given in; `aperture`: frame px of sigma at infinity. */
export type LensFocus = { readonly focus: number; readonly aperture: number };

/** A defocus below this sigma, frame px, is drawn sharp: no blur pass for a change nobody sees. */
export const LENS_DEFOCUS_LEAST = 0.1;

/** How far a point at `distance` blurs, frame px of sigma, signed: positive past the focus, negative before it. */
export const lensDefocusSigned = ({ focus, aperture }: LensFocus, distance: number) => aperture * (1 - focus / distance);

/** Where an exposure from aperture point `at` (lens-exposures.ts) slides a point at `distance`, frame px. */
export function lensApertureSlide(lens: LensFocus, distance: number, at: LensExposure['aperture']): { x: number; y: number } {
  const signed = lensDefocusSigned(lens, distance);
  return { x: at[0] * signed, y: at[1] * signed };
}

/** How many sigmas a gaussian's taps reach each side: past them a weight is under 1.2% of the centre's. */
export const LENS_GAUSSIAN_SIGMAS = 3;

/** How far a gaussian of `sigma` px reaches each side, whole px: 0 for none. */
export const lensGaussianReach = (sigma: number) => (sigma > 0 ? Math.ceil(LENS_GAUSSIAN_SIGMAS * sigma) : 0);

/**
 * A blur's sigma held to steps 2% apart, finer than an eye tells a blur's width by. A camera moving in rescales a plane
 * every frame, so its exact sigma is new each frame; held to a step, frames share one blurred picture.
 */
export const LENS_SIGMA_STEP = 1.02;
export const lensSigmaStepped = (sigma: number) => (sigma > 0 ? LENS_SIGMA_STEP ** Math.round(Math.log(sigma) / Math.log(LENS_SIGMA_STEP)) : 0);

/**
 * A shot camera's lens: `focus`, the distance held sharp along its view, and `aperture`, the opening's sigma, both in
 * world units. A frame px sigma at infinity is focal px · aperture / focus (lensFocusOfShot).
 */
export type ShotCameraLensFocus = { readonly focus: number; readonly aperture: number };

/** `lens` as frame px over `camera`'s frame: a point at infinity's sigma. */
export const lensFocusOfShot = (camera: ShotCamera, lens: ShotCameraLensFocus): LensFocus =>
  ({ focus: lens.focus, aperture: (shotCameraFocalPx(camera) * lens.aperture) / lens.focus });

/** `focus` (frame px at infinity) as a shot camera's opening in world units, its focus `focusDistance` away. */
export const shotLensOfFocus = (camera: ShotCamera, focus: LensFocus, focusDistance: number): ShotCameraLensFocus =>
  ({ focus: focusDistance, aperture: (focus.aperture * focusDistance) / shotCameraFocalPx(camera) });

/**
 * `camera` as exposure `exposure` sees: moved over its aperture to that point, its lens shifted so the focal plane
 * stays put (an off-axis thin lens: turning toward the focus would blur the frame's edges), and slid by the
 * exposure's sub-pixel offset. A point at distance d then lands lensApertureSlide px from where it did, plus `pixel`.
 */
export function shotCameraExposed(camera: ShotCamera, lens: ShotCameraLensFocus | null, { aperture, pixel }: Pick<LensExposure, 'aperture' | 'pixel'>): ShotCamera {
  const f = shotCameraFocalPx(camera);
  const ox = lens ? aperture[0] * lens.aperture : 0, oy = lens ? aperture[1] * lens.aperture : 0;
  const { right, up } = shotCameraAxes(camera);
  // Frame y runs down, the world's up: a point on the lens `oy` down the frame is `oy` along −up.
  const position = right.multiplyScalar(ox).addScaledVector(up, -oy).add(new Vector3(...camera.position));
  const hold = lens ? f / lens.focus : 0;
  return { ...camera, position: position.toArray(), shift: { x: camera.shift.x + ox * hold + pixel[0], y: camera.shift.y + oy * hold + pixel[1] } };
}

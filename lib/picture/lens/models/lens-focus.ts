// lens-focus.ts: the lens's focus as the studio measures it, for painted planes and three.js alike. A thin lens with
// an apodised (gaussian) aperture blurs a point at distance d by a gaussian of sigma aperture·|1 − focus/d| frame px,
// `aperture` being the sigma a point at infinity gets (the lens's own factor, near 1, left in it).
//
// An exposure sees the scene from one point of the aperture: everything at distance d slides aperture·(1 − focus/d)
// px times that point, the focal plane holding still. Averaged over the aperture's samples (lens-exposures.ts), the
// slides make that gaussian; the fast path draws it directly. A tilted focus leans the focal plane: the 1 becomes
// lean(p), affine in the frame, as is an exposure's slide.

import { Vector3 } from 'three';
import { shotCameraAxes, shotCameraFocalPx, type ShotCamera, type ShotCameraShear } from '#lib/picture/shot-camera/models/shot-camera.ts';
import type { LensExposure } from './lens-exposures.ts';

/** A point in the frame, px, y down. */
type LensFramePoint = { readonly x: number; readonly y: number };

/**
 * A tilt-shift lens's tilt. `angle`, radians within ±π/2: how far the plane of sharp focus turns from facing the
 * camera, about a line through the focus straight ahead; positive leans its top away, as a ground seen from above
 * recedes, so a band across it stays sharp. `axis`, radians y-down, turns that line from across the frame (0).
 */
export type LensFocusTilt = { readonly angle: number; readonly axis?: number };

/**
 * How a tilted focus leans across the frame: at frame px p, the focal plane lies focus / lean(p) along p's ray, its
 * depth along the view, where lean(p) = 1 + x·(p.x − centre.x) + y·(p.y − centre.y) and `centre` is the point straight
 * ahead.
 */
export type LensFocusLean = { readonly x: number; readonly y: number; readonly centre: LensFramePoint };

/**
 * `focus`: the distance held sharp, in the units distances are given in, straight ahead; `aperture`: frame px of
 * sigma at infinity straight ahead; `lean`: how a tilted focus leans across the frame, none facing the camera.
 */
export type LensFocus = { readonly focus: number; readonly aperture: number; readonly lean?: LensFocusLean };

/** A defocus below this sigma, frame px, is drawn sharp: no blur pass for a change nobody sees. */
export const LENS_DEFOCUS_LEAST = 0.1;

/** Why `tilt` can't lean a focal plane, or null: an angle off ±π/2's open range, or a part not finite. */
export const lensFocusTiltProblem = ({ angle, axis = 0 }: LensFocusTilt): string | null =>
  (Math.abs(angle) < Math.PI / 2 && Number.isFinite(axis) ? null : `a tilt turns the focal plane within ±π/2 about a finite axis, not ${angle} about ${axis}`);

/** The lean `tilt` gives a camera of `focalPx` (shot-camera.ts) about frame px `centre`, the point straight ahead. */
export function lensFocusLean(tilt: LensFocusTilt, centre: LensFramePoint, focalPx: number): LensFocusLean {
  const problem = lensFocusTiltProblem(tilt);
  if (problem) throw new Error(`lens: ${problem}`);
  const rise = Math.tan(tilt.angle) / focalPx, axis = tilt.axis ?? 0;
  // The focus recedes toward the frame's up turned by `axis`, (sin a, −cos a): lean falls that way.
  return { x: -Math.sin(axis) * rise, y: Math.cos(axis) * rise, centre };
}

/** `lens`'s lean at frame px `at`: 1 facing the camera, or straight ahead. */
export const lensFocusLeanAt = ({ lean }: LensFocus, at: LensFramePoint) => (lean ? 1 + lean.x * (at.x - lean.centre.x) + lean.y * (at.y - lean.centre.y) : 1);

/**
 * How far a point at `distance` blurs, frame px of sigma, signed: positive past the focus, negative before it. Seen
 * at frame px `at` under a tilted focus; straight ahead when left out.
 */
export const lensDefocusSigned = (lens: LensFocus, distance: number, at?: LensFramePoint) =>
  lens.aperture * ((at ? lensFocusLeanAt(lens, at) : 1) - lens.focus / distance);

/**
 * The widest sigma a per-pixel defocus by `lens` gives in frame `box`: twice the aperture straight ahead, so nearer
 * than a third of the focus blurs no wider (else a point by the lens would blur the whole picture), and as much more
 * as a tilted focus leans there.
 */
export const lensDefocusMost = (lens: LensFocus, { x0, y0, x1, y1 }: { x0: number; y0: number; x1: number; y1: number }) =>
  lens.aperture * (1 + Math.max(...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => lensFocusLeanAt(lens, { x, y }))));

/**
 * A plane's defocus across the frame at one distance, under a tilted focus: its signed sigma, frame px, is `signed`
 * at frame px `centre` and rises `x` and `y` a px.
 */
export type LensDefocusField = { readonly signed: number; readonly x: number; readonly y: number; readonly centre: LensFramePoint };

/** The defocus a plane at `distance` gets across the frame from `lens`, its lean `lean`. */
export const lensDefocusField = (lens: LensFocus, lean: LensFocusLean, distance: number): LensDefocusField =>
  ({ signed: lensDefocusSigned(lens, distance), x: lens.aperture * lean.x, y: lens.aperture * lean.y, centre: lean.centre });

/** `field`'s signed sigma at frame px `at`. */
export const lensDefocusFieldAt = ({ signed, x, y, centre }: LensDefocusField, at: LensFramePoint) => signed + x * (at.x - centre.x) + y * (at.y - centre.y);

/** The widest sigma `field` gives anywhere in `box` (frame px): at a corner, as it's affine. */
export const lensDefocusFieldWidest = (field: LensDefocusField, { x0, y0, x1, y1 }: { x0: number; y0: number; x1: number; y1: number }) =>
  Math.max(...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => Math.abs(lensDefocusFieldAt(field, { x, y }))));

/** An affine map of frame px: p ↦ (xx·p.x + xy·p.y + x, yx·p.x + yy·p.y + y). */
export type LensFrameAffine = { readonly xx: number; readonly xy: number; readonly yx: number; readonly yy: number; readonly x: number; readonly y: number };

/** Where `affine` takes frame px `p`. */
export const lensFrameAffineApply = ({ xx, xy, yx, yy, x, y }: LensFrameAffine, p: LensFramePoint) => ({ x: xx * p.x + xy * p.y + x, y: yx * p.x + yy * p.y + y });

/**
 * Where an exposure from aperture point `at` (lens-exposures.ts) slides what lies at `distance`, frame px: `shift`,
 * how far the point straight ahead moves; `shear`, under a tilted focus, the rest, fixing that point once shifted. A
 * point p slides κ·at·(lean(p) − focus/d), κ = aperture / (1 − aperture·lean'·at): the plane-induced map.
 */
export function lensApertureSlide(lens: LensFocus, distance: number, at: LensExposure['aperture']): { readonly shift: LensFramePoint; readonly shear: LensFrameAffine | null } {
  const { lean } = lens;
  const kappa = lean ? lens.aperture / (1 - lens.aperture * (lean.x * at[0] + lean.y * at[1])) : lens.aperture;
  const ahead = kappa * (1 - lens.focus / distance), shift = { x: at[0] * ahead, y: at[1] * ahead };
  if (!lean) return { shift, shear: null };
  const xx = 1 + kappa * at[0] * lean.x, xy = kappa * at[0] * lean.y, yx = kappa * at[1] * lean.x, yy = 1 + kappa * at[1] * lean.y;
  const cx = lean.centre.x + shift.x, cy = lean.centre.y + shift.y;
  return { shift, shear: { xx, xy, yx, yy, x: cx - xx * cx - xy * cy, y: cy - yx * cx - yy * cy } };
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
 * world units; `tilt`, how its focal plane leans (LensFocusTilt), none facing the camera. A frame px sigma at infinity
 * is focal px · aperture / focus.
 */
export type ShotCameraLensFocus = { readonly focus: number; readonly aperture: number; readonly tilt?: LensFocusTilt };

/** `focus` (frame px at infinity) as a shot camera's opening in world units, its focus `focusDistance` away, leaning by `tilt`. */
export const shotLensOfFocus = (camera: ShotCamera, focus: LensFocus, focusDistance: number, tilt?: LensFocusTilt): ShotCameraLensFocus =>
  ({ focus: focusDistance, aperture: (focus.aperture * focusDistance) / shotCameraFocalPx(camera), ...(tilt && { tilt }) });

/**
 * `camera` as exposure `exposure` sees: moved over its aperture to that point, its lens shifted (and sheared, under a
 * tilted focus) so the focal plane stays put, an off-axis thin lens, and slid by the sub-pixel offset. A point then
 * lands where lensApertureSlide says, plus `pixel`.
 */
export function shotCameraExposed(camera: ShotCamera, lens: ShotCameraLensFocus | null, { aperture, pixel }: Pick<LensExposure, 'aperture' | 'pixel'>): ShotCamera {
  const f = shotCameraFocalPx(camera);
  const ox = lens ? aperture[0] * lens.aperture : 0, oy = lens ? aperture[1] * lens.aperture : 0;
  const { right, up } = shotCameraAxes(camera);
  // Frame y runs down, the world's up: a point on the lens `oy` down the frame is `oy` along −up.
  const position = right.multiplyScalar(ox).addScaledVector(up, -oy).add(new Vector3(...camera.position));
  // The focal plane, in the camera's frame axes (x right, y down, z ahead), is n·P = focus with n = (f·lean', 1); the
  // camera moved by o sees it through x ↦ x + k·f·o·(1 + lean'·(x − principal)), k = 1/(focus − f·lean'·o).
  const lean = lens?.tilt ? lensFocusLean(lens.tilt, { x: 0, y: 0 }, f) : { x: 0, y: 0 };
  const k = lens ? 1 / (lens.focus - f * (lean.x * ox + lean.y * oy)) : 0;
  const sx = k * f * ox, sy = k * f * oy, s = camera.shear;
  const shear: ShotCameraShear = lean.x || lean.y
    ? { xx: (1 + sx * lean.x) * s.xx + sx * lean.y * s.yx, xy: (1 + sx * lean.x) * s.xy + sx * lean.y * s.yy, yx: sy * lean.x * s.xx + (1 + sy * lean.y) * s.yx, yy: sy * lean.x * s.xy + (1 + sy * lean.y) * s.yy }
    : s;
  return { ...camera, position: position.toArray(), shift: { x: camera.shift.x + sx + pixel[0], y: camera.shift.y + sy + pixel[1] }, shear };
}

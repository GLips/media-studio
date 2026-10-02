// shot-camera.ts: the studio's one camera description, a pinhole camera making a frame: where it stands, which way
// it faces, its field of view, its lens shift and its depth range. Every three.js scene renders through one, and
// the studio's projections into the frame are this file's.
//
// Authoring helpers produce it: a look-at (shotCameraLookingAt, previs and the needle), three axes (the column
// field's orbit) and the painted multiplane camera (paint-camera-world.ts). Its world is three's: y up, a camera at
// rest looks down −z. Frame px run x right and y down from the frame's top left.
//
// three's maths classes stand in for hand-written vectors; a camera holds plain tuples, so no vector is shared.

import { Matrix4, Quaternion, Vector3 } from 'three';
import type { QuaternionTuple, Vector3Tuple } from 'three';
import type { FrameSize } from '#lib/picture/frame/models/frame.ts';

/** A point in a 3D world, as a scene writes one: `[x, y, z]`. */
export type ShotPoint = Readonly<Vector3Tuple>;

/**
 * A camera making a `frame` of px. `quaternion` turns it from rest (looking down −z, y up). `fov` is vertical degrees
 * over the frame. `shift` (px, y down) slides the picture as a lens shift does: the point straight ahead lands that far
 * from the frame's centre. Things nearer than `near` or past `far` (world units) aren't drawn.
 */
export type ShotCamera = {
  readonly frame: FrameSize;
  readonly position: ShotPoint;
  readonly quaternion: Readonly<QuaternionTuple>;
  readonly fov: number;
  readonly shift: { readonly x: number; readonly y: number };
  readonly near: number;
  readonly far: number;
};

/** The settings every helper takes besides where the camera looks: what it makes and how deep it sees. */
export type ShotCameraLens = {
  readonly frame: FrameSize;
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  readonly shift?: { readonly x: number; readonly y: number };
};

const NO_SHIFT = { x: 0, y: 0 };
const rad = (deg: number) => (deg * Math.PI) / 180;

function shotCameraProblem({ frame, fov, near, far }: ShotCameraLens): string | null {
  if (!(frame.width > 0 && frame.height > 0)) return `a frame is wider and taller than 0, not ${frame.width} × ${frame.height}`;
  if (!(fov > 0 && fov < 180)) return `a field of view is between 0 and 180 degrees, not ${fov}`;
  return near > 0 && far > near && Number.isFinite(far) ? null : `a depth range runs from above 0 to further on, not ${near} to ${far}`;
}

function checkedShotCamera(lens: ShotCameraLens, position: Vector3, quaternion: Quaternion): ShotCamera {
  const problem = shotCameraProblem(lens);
  if (problem) throw new Error(`shot camera: ${problem}`);
  if (![...position.toArray(), ...quaternion.toArray()].every(Number.isFinite)) throw new Error('shot camera: its position and turn need finite numbers');
  const { frame, fov, near, far, shift = NO_SHIFT } = lens;
  return { frame, fov, near, far, shift, position: position.toArray(), quaternion: quaternion.toArray() };
}

/** A camera at `position` looking at `target`, its top toward `up` (y unless given). */
export function shotCameraLookingAt(lens: ShotCameraLens, { position, target, up = [0, 1, 0] }: { position: ShotPoint; target: ShotPoint; up?: ShotPoint }): ShotCamera {
  const eye = new Vector3(...position);
  // Matrix4.lookAt builds the basis of an object at eye whose +z points away from target, as a camera's does.
  const turn = new Matrix4().lookAt(eye, new Vector3(...target), new Vector3(...up));
  return checkedShotCamera(lens, eye, new Quaternion().setFromRotationMatrix(turn));
}

/** A camera at `position` facing `forward`, with `right` and `up` its picture's axes (unit length, square to each other). */
export function shotCameraFromAxes(lens: ShotCameraLens, { position, right, up, forward }: { position: ShotPoint; right: ShotPoint; up: ShotPoint; forward: ShotPoint }): ShotCamera {
  const basis = new Matrix4().makeBasis(new Vector3(...right), new Vector3(...up), new Vector3(...forward).negate());
  return checkedShotCamera(lens, new Vector3(...position), new Quaternion().setFromRotationMatrix(basis));
}

/** A camera at `position` turned `rollZ` radians about its view (three's rotation.z), otherwise at rest. */
export function shotCameraRolled(lens: ShotCameraLens, { position, rollZ }: { position: ShotPoint; rollZ: number }): ShotCamera {
  return checkedShotCamera(lens, new Vector3(...position), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rollZ));
}

/** The camera's picture axes in the world, each new: right, up, and forward (the way it looks). */
export function shotCameraAxes({ quaternion }: ShotCamera): { right: Vector3; up: Vector3; forward: Vector3 } {
  const turn = new Quaternion(...quaternion);
  return { right: new Vector3(1, 0, 0).applyQuaternion(turn), up: new Vector3(0, 1, 0).applyQuaternion(turn), forward: new Vector3(0, 0, -1).applyQuaternion(turn) };
}

/** The camera's focal length in frame px: how many px a unit across spans one unit ahead. */
export const shotCameraFocalPx = ({ frame, fov }: Pick<ShotCamera, 'frame' | 'fov'>) => frame.height / 2 / Math.tan(rad(fov) / 2);

/** Where the frame puts what's straight ahead: its centre, slid by the shift. */
const principalPoint = ({ frame, shift }: ShotCamera) => ({ x: frame.width / 2 + shift.x, y: frame.height / 2 + shift.y });

/**
 * Where `point` lands in the frame, px; `depth`, how far ahead of the camera it is, along its view; `scale`, frame px
 * per world unit there. Null at or behind the camera.
 */
export function shotCameraProject(camera: ShotCamera, point: ShotPoint | Vector3): { x: number; y: number; depth: number; scale: number } | null {
  const { right, up, forward } = shotCameraAxes(camera);
  const v = (point instanceof Vector3 ? point.clone() : new Vector3(...point)).sub(new Vector3(...camera.position));
  const depth = v.dot(forward);
  if (!(depth > 0)) return null;
  const scale = shotCameraFocalPx(camera) / depth, centre = principalPoint(camera);
  return { x: centre.x + v.dot(right) * scale, y: centre.y - v.dot(up) * scale, depth, scale };
}

/** The ray from the camera through frame px `at`: its origin, and its direction (unit length), both new. */
export function shotCameraRay(camera: ShotCamera, at: { x: number; y: number }): { origin: Vector3; direction: Vector3 } {
  const { right, up, forward } = shotCameraAxes(camera);
  const f = shotCameraFocalPx(camera), centre = principalPoint(camera);
  const direction = forward.addScaledVector(right, (at.x - centre.x) / f).addScaledVector(up, (centre.y - at.y) / f).normalize();
  return { origin: new Vector3(...camera.position), direction };
}

/**
 * The same camera making a frame `margin` px wider on every side, everything where it was: px stay px, and the
 * old frame's top left lands at (margin, margin). For a render that a blur will spread past the frame's edge.
 */
export function shotCameraGrown(camera: ShotCamera, margin: number): ShotCamera {
  if (!(margin >= 0 && Number.isFinite(margin))) throw new Error(`shot camera: a frame grows by 0 px or more, not ${margin}`);
  const frame = { width: camera.frame.width + 2 * margin, height: camera.frame.height + 2 * margin };
  return { ...camera, frame, fov: (2 * Math.atan(frame.height / 2 / shotCameraFocalPx(camera)) * 180) / Math.PI };
}

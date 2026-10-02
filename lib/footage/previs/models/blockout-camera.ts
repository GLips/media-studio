// blockout-camera.ts: camera moves for a 3D blockout (blockout.tsx). A move is a function of 0..1 progress returning
// a look-at, where the camera stands and what it looks at, so a scene drives it with `seg` like any other motion:
//
//   const lookAt = orbitMove({ target: [0, 0.6, 0], radius: 5, fromDeg: -40, toDeg: 40 })(seg(s.t, 0.5, 5.5))
//
// The blockout sees through the studio's one camera (shot-camera.ts), made from the look-at by blockoutShotCamera.
// World units are metres, y is up, and subjects stand on the ground at y = 0.

import { Vector3 } from 'three';
import type { FrameSize } from '#lib/picture/frame/models/frame.ts';
import { lerp } from '#lib/picture/motion/models/motion.ts';
import { shotCameraLookingAt, type ShotCamera, type ShotPoint } from '#lib/picture/shot-camera/models/shot-camera.ts';

/** Where the camera stands, the point it looks at, and its vertical field of view in degrees. */
export type BlockoutLookAt = { position: ShotPoint; target: ShotPoint; fov: number };
export type BlockoutMove = (k: number) => BlockoutLookAt;

/** Near enough for a camera at a phone on a counter, far enough for the whole ground. */
const BLOCKOUT_DEPTH = { near: 0.05, far: 400 };

/** The camera a blockout making `frame` sees through, upright. */
export function blockoutShotCamera({ position, target, fov }: BlockoutLookAt, frame: FrameSize): ShotCamera {
  return shotCameraLookingAt({ frame, fov, ...BLOCKOUT_DEPTH }, { position, target });
}

const rad = (deg: number) => (deg * Math.PI) / 180;

const lerpPoint = (from: ShotPoint, to: ShotPoint, k: number): ShotPoint => new Vector3().lerpVectors(new Vector3(...from), new Vector3(...to), k).toArray();

/**
 * Circles `target` at `radius`, `height` above the ground, from `fromDeg` to `toDeg` (0 looks from +z, toward -z;
 * positive turns counter-clockwise seen from above). `fov` defaults to 35, a normal lens.
 */
export function orbitMove({ target, radius, height = target[1] + 0.4, fromDeg, toDeg, fov = 35 }: {
  target: ShotPoint; radius: number; height?: number; fromDeg: number; toDeg: number; fov?: number;
}): BlockoutMove {
  return (k) => {
    const a = rad(lerp(fromDeg, toDeg, k));
    return { position: [target[0] + Math.sin(a) * radius, height, target[2] + Math.cos(a) * radius], target, fov };
  };
}

/**
 * The camera itself travelling from one look-at to another: a push-in or pull-out along the line to the subject, a
 * truck across it, a crane up. Field of view changes too if the two differ, but a zoom made that way reads as a zoom,
 * not a move; keep `fov` equal and move the camera.
 */
export function dollyMove(from: BlockoutLookAt, to: BlockoutLookAt): BlockoutMove {
  return (k) => ({ position: lerpPoint(from.position, to.position, k), target: lerpPoint(from.target, to.target, k), fov: lerp(from.fov, to.fov, k) });
}

/**
 * A push-in on `target` along the line from `position`, ending `toDistance` from it. The common case of dollyMove.
 */
export function pushInMove({ target, position, toDistance, fov = 35 }: { target: ShotPoint; position: ShotPoint; toDistance: number; fov?: number }): BlockoutMove {
  const d = new Vector3(...position).distanceTo(new Vector3(...target));
  return dollyMove({ position, target, fov }, { position: lerpPoint(target, position, toDistance / d), target, fov });
}

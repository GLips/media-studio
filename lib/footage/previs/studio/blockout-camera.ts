// blockout-camera.ts: camera moves for a 3D blockout (blockout.tsx), as pure math. A move is a function of 0..1
// progress returning where the camera is and what it looks at, so a scene drives it with `seg` like any other motion:
//
//   const pose = orbitMove({ target: [0, 0.6, 0], radius: 5, fromDeg: -40, toDeg: 40 })(seg(s.t, 0.5, 5.5))
//
// World units are metres, y is up, and subjects stand on the ground at y = 0.

import { lerp } from '#lib/picture/motion/models/motion.ts';
import { lengthVec3, lerpVec3, subVec3, type Vec3 } from '#lib/picture/camera/models/vec3.ts';

/** Where the camera is, the point it looks at, and its vertical field of view in degrees. */
export type BlockoutPose = { position: Vec3; target: Vec3; fov: number };
export type BlockoutMove = (k: number) => BlockoutPose;

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Circles `target` at `radius`, `height` above the ground, from `fromDeg` to `toDeg` (0 looks from +z, toward -z;
 * positive turns counter-clockwise seen from above). `fov` defaults to 35, a normal lens.
 */
export function orbitMove({ target, radius, height = target[1] + 0.4, fromDeg, toDeg, fov = 35 }: {
  target: Vec3; radius: number; height?: number; fromDeg: number; toDeg: number; fov?: number;
}): BlockoutMove {
  return (k) => {
    const a = rad(lerp(fromDeg, toDeg, k));
    return { position: [target[0] + Math.sin(a) * radius, height, target[2] + Math.cos(a) * radius], target, fov };
  };
}

/**
 * The camera itself travelling from one pose to another: a push-in or pull-out along the line to the subject, a truck
 * across it, a crane up. Field of view changes too if the poses differ, but a zoom made that way reads as a zoom, not a
 * move; keep `fov` equal and move the camera.
 */
export function dollyMove(from: BlockoutPose, to: BlockoutPose): BlockoutMove {
  return (k) => ({ position: lerpVec3(from.position, to.position, k), target: lerpVec3(from.target, to.target, k), fov: lerp(from.fov, to.fov, k) });
}

/**
 * A push-in on `target` along the line from `position`, ending `toDistance` from it. The common case of dollyMove.
 */
export function pushInMove({ target, position, toDistance, fov = 35 }: { target: Vec3; position: Vec3; toDistance: number; fov?: number }): BlockoutMove {
  const d = lengthVec3(subVec3(position, target));
  return dollyMove({ position, target, fov }, { position: lerpVec3(target, position, toDistance / d), target, fov });
}

// vec3.ts: 3-vectors as plain tuples, for geometry worked out by hand (a blockout camera's path, a card's axes, a
// needle's tip) rather than in three.js, so it runs anywhere, a frame at a time.

export type Vec3 = readonly [number, number, number];

export const addVec3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const subVec3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scaleVec3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dotVec3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const crossVec3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const lengthVec3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const unitVec3 = (a: Vec3) => scaleVec3(a, 1 / lengthVec3(a));
/** The point `k` of the way from `a` to `b`: `a` at 0, `b` at 1, past them outside 0..1. */
export const lerpVec3 = (a: Vec3, b: Vec3, k: number) => addVec3(a, scaleVec3(subVec3(b, a), k));

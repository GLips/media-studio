// needle-cartridge.ts: the tattoo cartridge's shape in mm, tip at the origin and running up +z: the seven needles of
// the grouping, the clear tip, the solder and the body, as profiles that reel/needle.tsx turns into meshes.

import { motionCurves } from '#lib/picture/motion/models/motion.ts';
import { hashRandom } from '#lib/picture/motion/models/random.ts';

const DEG = Math.PI / 180;

const NEEDLE_R = 0.175; // a #12 needle, 0.35 mm
const RING = 2 * NEEDLE_R; // the outer six sit touching the centre one
const TAPER = 4.4; // a long taper: point to full width
const CONVERGE = 0.2; // the outer points close in to this share of RING, so the grouping ends in one point
const SHAFT_TOP = 20; // hidden in the body past here
// The clear tip's mouth: the needle hangs this far out of it. A long hang, so the grouping reads from above.
export const NOSE = 3.4;
export const BODY_BACK = 40;

export type Profile = [r: number, z: number][];

const arcPoints = (cr: number, cz: number, radius: number, from: number, to: number, n: number): Profile =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (from + ((to - from) * i) / n) * DEG;
    return [cr + radius * Math.cos(a), cz + radius * Math.sin(a)];
  });

export const sampled = (n: number, f: (u: number) => [number, number]): Profile => Array.from({ length: n + 1 }, (_, i) => f(i / n));

/** One needle of the grouping: its centre line and radius at each height, and where its point is. */
export function needleLine(i: number) {
  const angle = ((i - 1) * 60 + 12) * DEG;
  const [bx, by] = i === 0 ? [0, 0] : [RING * Math.cos(angle), RING * Math.sin(angle)];
  // The outer points sit a hair behind the centre one, each its own amount, as a hand-soldered grouping does.
  const point = i === 0 ? 0 : 0.07 + 0.06 * hashRandom('needle-point', i);
  const top = point + TAPER;
  const along = (z: number) => Math.min(1, Math.max(0, (z - point) / TAPER));
  const centre = (z: number): [number, number] => {
    const k = CONVERGE + (1 - CONVERGE) * motionCurves.dissolve(along(z));
    return [bx * k, by * k];
  };
  // A ground point: sharp at the tip, rounding into the shaft.
  const radius = (z: number) => (z <= point ? 0 : NEEDLE_R * (1 - Math.pow(1 - along(z), 1.6)));
  const zs = [...Array.from({ length: 17 }, (_, k) => point + TAPER * (k / 16) ** 2), SHAFT_TOP];
  return { centre, radius, zs, point, top };
}

// The clear tip, a closed shell: rounded mouth, outer cone, collar into the body, back down the bore.
export const CLEAR_TIP: Profile[] = [
  arcPoints(1.0, NOSE + 0.34, 0.34, 180, 360, 10),
  sampled(12, (u) => [1.34 + (3.45 - 1.34) * u + 0.1 * Math.sin(Math.PI * u), NOSE + 0.34 + 8.56 * u]),
  [[3.45, NOSE + 8.9], [3.75, NOSE + 9.2]],
  [[3.75, NOSE + 9.2], [3.75, NOSE + 11.4]],
  [[3.75, NOSE + 11.4], [3.05, NOSE + 11.4]],
  [[3.05, NOSE + 11.4], [2.95, NOSE + 8.9]],
  sampled(10, (u) => [2.95 + (0.72 - 2.95) * u, NOSE + 8.9 - 8.1 * u]),
  [[0.72, NOSE + 0.8], [0.66, NOSE + 0.34]],
];

// The cartridge body: a flat front the tip plugs into, a neck, three grip grooves, a long barrel, a chamfered back.
export const BODY_START = NOSE + 10.6;
export const BODY_FRONT: Profile[] = [
  [[0.001, BODY_START], [3.98, BODY_START]],
  [[3.98, BODY_START], [3.98, BODY_START + 1.4]],
  [[3.98, BODY_START + 1.4], [4.75, BODY_START + 2.3]],
];
export const BODY_BARREL: Profile[] = [
  [[4.75, BODY_START + 2.3], [4.75, BODY_START + 4.8]],
  ...[4.8, 5.8, 6.8].map((d) => BODY_START + d).flatMap((z): Profile[] => [[[4.75, z], [4.45, z + 0.14]], [[4.45, z + 0.14], [4.45, z + 0.46]], [[4.45, z + 0.46], [4.75, z + 0.6]], [[4.75, z + 0.6], [4.75, z + 1.0]]]),
  [[4.75, BODY_START + 7.8], [4.75, BODY_BACK - 0.8]],
  [[4.75, BODY_BACK - 0.8], [4.3, BODY_BACK]],
  [[4.3, BODY_BACK], [1.6, BODY_BACK]],
  [[1.6, BODY_BACK], [1.6, BODY_BACK - 1]],
  [[1.6, BODY_BACK - 1], [0.001, BODY_BACK - 1]],
];

// The solder that holds the grouping, a slightly lumpy sleeve behind the taper, seen through the clear tip.
export const SOLDER: Profile[] = [sampled(14, (u) => [0.36 + 0.26 * Math.sin(Math.PI * Math.min(1, u * 1.4)) ** 0.5, NOSE + 3.2 + 2.6 * u])];


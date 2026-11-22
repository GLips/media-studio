// strain.ts: squash and stretch as one shared primitive that any shape, image or letter can wear. A strain is an
// area-keeping stretch along an axis, stored as ln(aspect) turned to twice the axis's angle, so shapes blend through
// round rather than spinning. It is applied about a pivot the caller names (the contact point on landing, the centre
// in flight, a glyph's baseline foot). Bulges and bent squash need a mesh warp; this is the affine part only.

import type { AffineMatrix, Point } from '#lib/picture/frame/models/geometry.ts';

/**
 * A squash or stretch as one vector: ln(aspect) turned to twice the major axis's angle. Shapes blend by mixing these,
 * so a tall stretch passes through round into a flat squash rather than spinning, and every blend keeps the area.
 */
export type Strain = { x: number; y: number };

/** No squash or stretch. */
export const STRAIN_ROUND: Strain = { x: 0, y: 0 };

/** Stretched `aspect` times longer than wide along the axis at `angle` radians (an aspect under 1 squashes it). */
export function strainAlong(aspect: number, angle: number): Strain {
  const l = Math.log(aspect);
  return { x: l * Math.cos(2 * angle), y: l * Math.sin(2 * angle) };
}

export const mixStrain = (a: Strain, b: Strain, k: number): Strain => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
export const scaleStrain = (a: Strain, k: number): Strain => ({ x: a.x * k, y: a.y * k });

/** The ellipse a circle becomes under the strain: its aspect (long over short, ≥ 1) and its long axis's angle in radians. */
export function strainEllipse(s: Strain) {
  const l = Math.hypot(s.x, s.y);
  return { aspect: Math.exp(l), angle: l > 1e-9 ? Math.atan2(s.y, s.x) / 2 : 0 };
}

/**
 * The strain as a symmetric 2×2 with determinant 1, rows first: [[a, b], [b, d]]. It is cosh(l/2)·I plus sinh(l/2)
 * times the reflection across the long axis, l the strain's length.
 */
export function strainMatrix(s: Strain): [[number, number], [number, number]] {
  const l = Math.hypot(s.x, s.y), c = Math.cosh(l / 2), k = l > 1e-9 ? Math.sinh(l / 2) / l : 0.5;
  return [[c + k * s.x, k * s.y], [k * s.y, c - k * s.x]];
}

/** The strain applied about `pivot`, as geometry's affine [a, b, c, d, e, f]: the pivot stays where it is. */
export function strainAffine(s: Strain, pivot: Point): AffineMatrix {
  const [[a, b], [, d]] = strainMatrix(s);
  return [a, b, b, d, pivot.x - a * pivot.x - b * pivot.y, pivot.y - b * pivot.x - d * pivot.y];
}

/** The strain about `pivot` as a point map, for code that warps points (a painted group's lattice). */
export function strainAbout(s: Strain, pivot: Point): (p: Point) => Point {
  const [a, b, c, d, e, f] = strainAffine(s, pivot);
  return (p) => ({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f });
}

/**
 * The strain about `pivot` as a CSS or SVG `matrix()` transform. Give the element `transform-origin: 0 0` (SVG's
 * default) and the pivot in its parent's coordinates.
 */
export function strainCssMatrix(s: Strain, pivot: Point): string {
  return `matrix(${strainAffine(s, pivot).join(', ')})`;
}

/** How far a circle of radius `r` under strain `s` reaches from its centre along the unit `direction`. */
export function strainExtent(r: number, s: Strain, direction: Point): number {
  const [[a, b], [, d]] = strainMatrix(s);
  return r * Math.hypot(a * direction.x + b * direction.y, b * direction.x + d * direction.y);
}

/**
 * A volume-keeping 3D stretch, e^logStretch along the unit `axis` and e^(−logStretch/2) across it, as a symmetric
 * 3×3 (so row or column order reads the same) for three.js's Matrix3.set.
 */
export function strainMatrix3(logStretch: number, axis: { x: number; y: number; z: number }) {
  const across = Math.exp(-logStretch / 2), k = Math.exp(logStretch) - across, { x, y, z } = axis;
  return [
    across + k * x * x, k * x * y, k * x * z,
    k * y * x, across + k * y * y, k * y * z,
    k * z * x, k * z * y, across + k * z * z,
  ] as const;
}

// ---------- drivers in time ----------

/** Stretched along `velocity` by 1 + speed × `perSpeed`: the bouncing ball's law, 1 + v/107 in px per 60 fps frame. */
export const strainAlongVelocity = (velocity: Point, perSpeed: number): Strain =>
  strainAlong(1 + perSpeed * Math.hypot(velocity.x, velocity.y), Math.atan2(velocity.y, velocity.x));

/** Stretched along the velocity of `position` at `t` seconds, found by central difference over `dt`. */
export function strainAlongPath(position: (t: number) => Point, t: number, perSpeed: number, dt = 1e-3): Strain {
  const before = position(t - dt), after = position(t + dt);
  return strainAlongVelocity({ x: (after.x - before.x) / (2 * dt), y: (after.y - before.y) / (2 * dt) }, perSpeed);
}

/** How sharply a landing squashes and recovers: the exponent of contactLoad's hump. */
export const CONTACT_SHARPNESS = 1.7;

/** How hard a contact presses at `u`, −1 at touch, 0 at its deepest, 1 at lift-off: 1 − |u|^sharpness, 0 outside. */
export const contactLoad = (u: number, sharpness = CONTACT_SHARPNESS) => (Math.abs(u) >= 1 ? 0 : 1 - Math.abs(u) ** sharpness);

/**
 * The squash of a contact at `u` (as contactLoad's): from the `arriving` stretch it touches down with into `squash` at
 * its deepest, then round by lift-off, every step through round rather than spinning.
 */
export const strainOfContact = (u: number, squash: Strain, arriving: Strain = STRAIN_ROUND): Strain =>
  mixStrain(u < 0 ? arriving : STRAIN_ROUND, squash, contactLoad(u));

/**
 * The spring as a shape leaves the ground, `since` seconds after lift-off: its `flight` strain sprung from round,
 * overshooting it (1.6 against 1.4 on the ball), dipping under and settling within 0.13 s.
 */
export function strainOfLift(flight: Strain, since: number): Strain {
  const share = 1 - Math.exp(-since / 0.008) + 0.7 * Math.exp(-since / 0.05) * Math.sin((2 * Math.PI * since) / 0.13);
  return scaleStrain(flight, share);
}

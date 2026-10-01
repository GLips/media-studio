// stamp-paint-field.ts: a quantity that varies across a painting, as a wash is graded: constant, or a linear or
// radial gradient, in the painting's pixels. Generic over what varies: a fill's load today, and (vid-83) a mixture,
// which interpolates by pigment amounts, never by rendered colour, so interpolation is the reader's.
//
// STAMP_PAINT_FIELD_SHARE says where a point sits between a gradient's two ends (0 at the first, 1 at the second,
// held outside); the renderer reads the same share in WGSL (paintFieldShare), twins held together by the GPU gate.

import type { StampPoint } from './stamp-region.ts';

export type StampPaintField<T> =
  | { kind: 'constant'; value: T }
  /** `from.value` at `from`, `to.value` at `to`, graded along the line between and held beyond its ends. */
  | { kind: 'linear'; from: StampPoint & { value: T }; to: StampPoint & { value: T } }
  /** `inner` at `center`, `outer` from `radius` px out, graded between. */
  | { kind: 'radial'; center: StampPoint; radius: number; inner: T; outer: T };

/** A field's ends as the share reads them: the first value, the second, and its geometry for paintFieldShare. */
export function stampPaintFieldEnds<T>(field: StampPaintField<T>): { first: T; second: T; kind: 0 | 1 | 2; geometry: [number, number, number, number] } {
  if (field.kind === 'constant') return { first: field.value, second: field.value, kind: 0, geometry: [0, 0, 0, 0] };
  if (field.kind === 'linear') return { first: field.from.value, second: field.to.value, kind: 1, geometry: [field.from.x, field.from.y, field.to.x, field.to.y] };
  return { first: field.inner, second: field.outer, kind: 2, geometry: [field.center.x, field.center.y, field.radius, 0] };
}

/**
 * Why `field` can't be painted, or null: a linear's ends apart, a radial's radius positive, all finite, and each value
 * as `valueProblem` asks. The share divides by those, so a field is checked before it's read.
 */
export function stampPaintFieldProblem<T>(field: StampPaintField<T>, valueProblem: (value: T) => string | null): string | null {
  const { first, second, kind, geometry } = stampPaintFieldEnds(field);
  if (!geometry.every(Number.isFinite)) return `its geometry isn't finite (${geometry.join(', ')})`;
  if (kind === 1 && geometry[0] === geometry[2] && geometry[1] === geometry[3]) return 'its linear ends are one point';
  if (kind === 2 && !(geometry[2] > 0)) return `its radius is ${geometry[2]}, and a radial field needs a positive one`;
  return valueProblem(first) ?? valueProblem(second);
}

/**
 * Where (x, y) sits between a field's ends, 0..1, by its kind (0 constant, 1 linear, 2 radial) and geometry: a
 * linear's from and to, or a radial's centre and radius, as stampPaintFieldProblem admits them.
 */
export const STAMP_PAINT_FIELD_SHARE = {
  cpu: (x: number, y: number, kind: number, [a, b, c, d]: readonly [number, number, number, number]) => {
    if (kind === 1) {
      const ex = c - a, ey = d - b;
      return Math.min(1, Math.max(0, ((x - a) * ex + (y - b) * ey) / (ex * ex + ey * ey)));
    }
    if (kind === 2) return Math.min(1, Math.max(0, Math.hypot(x - a, y - b) / c));
    return 0;
  },
  wgsl: /* wgsl */ `fn paintFieldShare(p: vec2f, kind: i32, g: vec4f) -> f32 {
  if (kind == 1) {
    let e = g.zw - g.xy;
    return clamp(dot(p - g.xy, e) / dot(e, e), 0.0, 1.0);
  }
  if (kind == 2) { return clamp(length(p - g.xy) / g.z, 0.0, 1.0); }
  return 0.0;
}`,
};

/** A number field's value at (x, y). */
export function stampPaintFieldAt(field: StampPaintField<number>, x: number, y: number): number {
  const { first, second, kind, geometry } = stampPaintFieldEnds(field);
  return first + (second - first) * STAMP_PAINT_FIELD_SHARE.cpu(x, y, kind, geometry);
}

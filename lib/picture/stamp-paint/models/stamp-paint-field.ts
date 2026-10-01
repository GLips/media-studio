// stamp-paint-field.ts: a quantity that varies across a painting, as a wash is graded or mottled: constant, a linear
// or radial gradient, or noise, in the painting's pixels. Generic over what varies: a fill's load, a preparation's
// wetness, and (vid-83) a mixture, which interpolates by pigment amounts, never by rendered colour, so interpolation
// is the reader's.
//
// STAMP_PAINT_FIELD_SHARE says where a point sits between a field's two ends (0 at the first, 1 at the second); the
// renderer reads the same share in WGSL (paintFieldShare), twins held together by the GPU gate.

import { paintPigmentSeed } from '#lib/picture/paint/models/paint-paper.ts';
import type { StampPoint } from './stamp-region.ts';

type StampPaintGradient<T> =
  | { kind: 'constant'; value: T }
  /** `from.value` at `from`, `to.value` at `to`, graded along the line between and held beyond its ends. */
  | { kind: 'linear'; from: StampPoint & { value: T }; to: StampPoint & { value: T } }
  /** `inner` at `center`, `outer` from `radius` px out, graded between. */
  | { kind: 'radial'; center: StampPoint; radius: number; inner: T; outer: T };

/**
 * Mottled between `a` and `b` by smooth value noise, its features about `scale` px across, reaching nearly both ends.
 * `seed` names a passage: deposits given one seed share one continuous pattern. Left out, the deposit's ID seeds it
 * (a preparation's, its pass's). Neither a boil's epoch nor a keyed material moves it.
 */
export type StampNoiseField<T> = { kind: 'noise'; scale: number; seed?: string; a: T; b: T };

export type StampPaintField<T> = StampPaintGradient<T> | StampNoiseField<T>;
/** A field as compiled: a noise field's seed settled (stampSeededPaintField), so it reads alike wherever it's read. */
export type StampSeededPaintField<T> = StampPaintGradient<T> | (StampNoiseField<T> & { seed: string });

/** `field` with a noise field's seed settled: its own, else `seed`, the ID of the deposit or pass that reads it. */
export function stampSeededPaintField<T>(field: StampPaintField<T>, seed: string): StampSeededPaintField<T> {
  return field.kind === 'noise' ? { ...field, seed: field.seed ?? seed } : field;
}

/** A field's ends as the share reads them: the first value, the second, and its geometry for paintFieldShare. */
export function stampPaintFieldEnds<T>(field: StampSeededPaintField<T>): { first: T; second: T; kind: 0 | 1 | 2 | 3; geometry: [number, number, number, number] } {
  if (field.kind === 'constant') return { first: field.value, second: field.value, kind: 0, geometry: [0, 0, 0, 0] };
  if (field.kind === 'linear') return { first: field.from.value, second: field.to.value, kind: 1, geometry: [field.from.x, field.from.y, field.to.x, field.to.y] };
  if (field.kind === 'radial') return { first: field.inner, second: field.outer, kind: 2, geometry: [field.center.x, field.center.y, field.radius, 0] };
  return { first: field.a, second: field.b, kind: 3, geometry: [field.scale, paintPigmentSeed(field.seed), 0, 0] };
}

/**
 * Why `field` can't be painted, or null: a linear's ends apart, a radial's radius and a noise's scale positive, all
 * finite, and each value as `valueProblem` asks. The share divides by those, so a field is checked before it's read.
 */
export function stampPaintFieldProblem<T>(field: StampPaintField<T>, valueProblem: (value: T) => string | null): string | null {
  // A seed only names the pattern, so any stands in while checking.
  const { first, second, kind, geometry } = stampPaintFieldEnds(stampSeededPaintField(field, ''));
  if (!geometry.every(Number.isFinite)) return `its geometry isn't finite (${geometry.join(', ')})`;
  if (kind === 1 && geometry[0] === geometry[2] && geometry[1] === geometry[3]) return 'its linear ends are one point';
  if (kind === 2 && !(geometry[2] > 0)) return `its radius is ${geometry[2]}, and a radial field needs a positive one`;
  if (kind === 3 && !(geometry[0] > 0)) return `its scale is ${geometry[0]}, and a noise field needs a positive one`;
  return valueProblem(first) ?? valueProblem(second);
}

/**
 * How far a noise field's share is stretched about a half. Two octaves of value noise, weighted 2:1, gather near
 * their mean; stretched this far a passage reaches both its ends, a few hundredths of it held at each.
 */
const NOISE_STRETCH = 1.6;

/**
 * Each octave's lattice turned and scaled against the painting's axes, [cos, sin] × its frequency, so neither lays
 * its grid along the painting's rows: a sky's horizon would show it.
 */
const NOISE_OCTAVES = [[0.825336, 0.564642], [-0.907233, 1.782415]] as const;

/** PCG's u32 hash, as WGSL's paintFieldHash runs it. */
function pcgHash(v: number): number {
  const s = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

/** One octave of value noise at (x, y) in lattice units, -1..1: a hashed value at each lattice point, eased between. */
function noiseOctave(x: number, y: number, seed: number): number {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  // Offset, so a negative lattice point hashes as WGSL's u32 of it does.
  const ci = (i + 32768) >>> 0, cj = (j + 32768) >>> 0, h = pcgHash(seed);
  const at = (di: number, dj: number) => (pcgHash(((ci + di) >>> 0) ^ pcgHash(((cj + dj) >>> 0) ^ h)) / 4294967296) * 2 - 1;
  const top = at(0, 0) + (at(1, 0) - at(0, 0)) * sx, bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * sx;
  return top + (bottom - top) * sy;
}

/**
 * Where (x, y) sits between a field's ends, 0..1, by its kind (0 constant, 1 linear, 2 radial, 3 noise) and geometry:
 * a linear's from and to, a radial's centre and radius, or a noise's scale and 24-bit seed, as stampPaintFieldProblem
 * admits them.
 */
export const STAMP_PAINT_FIELD_SHARE = {
  cpu: (x: number, y: number, kind: number, [a, b, c, d]: readonly [number, number, number, number]) => {
    if (kind === 1) {
      const ex = c - a, ey = d - b;
      return Math.min(1, Math.max(0, ((x - a) * ex + (y - b) * ey) / (ex * ex + ey * ey)));
    }
    if (kind === 2) return Math.min(1, Math.max(0, Math.hypot(x - a, y - b) / c));
    if (kind === 3) {
      const u = x / a, v = y / a, [[c1, s1], [c2, s2]] = NOISE_OCTAVES;
      const n = (2 * noiseOctave(c1 * u - s1 * v, s1 * u + c1 * v, b) + noiseOctave(c2 * u - s2 * v + 0.5, s2 * u + c2 * v + 0.5, b ^ 0x68bc21)) / 3;
      return Math.min(1, Math.max(0, 0.5 + 0.5 * NOISE_STRETCH * n));
    }
    return 0;
  },
  wgsl: /* wgsl */ `fn paintFieldHash(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn paintFieldCorner(x: u32, y: u32, h: u32) -> f32 { return f32(paintFieldHash(x ^ paintFieldHash(y ^ h))) / 4294967296.0 * 2.0 - 1.0; }
fn paintFieldOctave(p: vec2f, seed: u32) -> f32 {
  let i = floor(p);
  let f = p - i;
  let s = f * f * (3.0 - 2.0 * f);
  let c = vec2u(vec2i(i) + 32768);
  let h = paintFieldHash(seed);
  let top = mix(paintFieldCorner(c.x, c.y, h), paintFieldCorner(c.x + 1u, c.y, h), s.x);
  let bottom = mix(paintFieldCorner(c.x, c.y + 1u, h), paintFieldCorner(c.x + 1u, c.y + 1u, h), s.x);
  return mix(top, bottom, s.y);
}
fn paintFieldShare(p: vec2f, kind: i32, g: vec4f) -> f32 {
  if (kind == 1) {
    let e = g.zw - g.xy;
    return clamp(dot(p - g.xy, e) / dot(e, e), 0.0, 1.0);
  }
  if (kind == 2) { return clamp(length(p - g.xy) / g.z, 0.0, 1.0); }
  if (kind == 3) {
    let q = p / g.x;
    let seed = u32(g.y);
    let first = vec2f(${NOISE_OCTAVES[0][0]} * q.x - ${NOISE_OCTAVES[0][1]} * q.y, ${NOISE_OCTAVES[0][1]} * q.x + ${NOISE_OCTAVES[0][0]} * q.y);
    let second = vec2f(${NOISE_OCTAVES[1][0]} * q.x - ${NOISE_OCTAVES[1][1]} * q.y, ${NOISE_OCTAVES[1][1]} * q.x + ${NOISE_OCTAVES[1][0]} * q.y) + 0.5;
    let n = (2.0 * paintFieldOctave(first, seed) + paintFieldOctave(second, seed ^ 0x68bc21u)) / 3.0;
    return clamp(0.5 + ${(0.5 * NOISE_STRETCH).toFixed(3)} * n, 0.0, 1.0);
  }
  return 0.0;
}`,
};

/** A number field's value at (x, y). */
export function stampPaintFieldAt(field: StampSeededPaintField<number>, x: number, y: number): number {
  const { first, second, kind, geometry } = stampPaintFieldEnds(field);
  return first + (second - first) * STAMP_PAINT_FIELD_SHARE.cpu(x, y, kind, geometry);
}

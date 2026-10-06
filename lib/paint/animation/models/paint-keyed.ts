// paint-keyed.ts: a value built from keys, as a function of the moment: any tree of numbers (a point, a placement, a
// camera pose). Each number moves on its own, so a value's channels (its top-level fields) may take their own curves.
//
// Between keys a channel moves by its curve (paint-curves.ts), else by `between`: `linear`, or `smooth`, a monotone
// cubic through every key (PCHIP's tangents), never past a key, from rest at the first and to rest at the last. A
// hold keeps the key before's value until its time. `through` points are passed at speed, on a chordal Catmull-Rom
// path the key's curve paces. Outside the keys the value is the nearest key's.

import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { paintCurveProblem, paintCurveTiming, type PaintCurve, type PaintCurveTiming } from './paint-curves.ts';
import type { PaintKeyed } from './paint-value.ts';

/** A channel's curves by name, for a value with channels (its top-level fields). */
export type PaintKeyChannelCurves<T> = T extends number ? never : { readonly [K in keyof T]?: PaintCurve };
/** A point a key's move passes through: for a value with channels, the channels it routes, the rest moving straight. */
export type PaintKeyThrough<T> = T extends number ? number : { readonly [K in keyof T]?: T[K] };

/**
 * A key: `value` at second `at`, reached from the key before by `curve` (its `curves` naming a channel's own), by way
 * of `through`; or a hold, keeping the key before's value until `at`.
 */
export type PaintKey<T> =
  | { readonly at: number; readonly value: T; readonly curve?: PaintCurve; readonly curves?: PaintKeyChannelCurves<T>; readonly through?: readonly PaintKeyThrough<T>[] }
  | { readonly at: number; readonly hold: true };

/** How a channel moves between keys that give it no curve: evenly (the default), or `smooth` (see the file's head). */
export type PaintKeyedOptions = { readonly between?: 'linear' | 'smooth' };

// ---- layouts: a value as numbers, and back -------------------------------------------------------------------------

/** What a keyed value moves: a number, or an object or array of them, to any depth. */
export type PaintKeyedValue = number | readonly PaintKeyedValue[] | { readonly [field: string]: PaintKeyedValue | undefined };

/** Whether `value` is a keyed value's: finite numbers alone, in objects and arrays. */
function isPaintKeyedValue(value: unknown): value is PaintKeyedValue {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'object' && value !== null && Object.values(value).every(isPaintKeyedValue);
}

const isKeyedArray = (value: PaintKeyedValue): value is readonly PaintKeyedValue[] => Array.isArray(value);

/** An object's fields that hold something, by name. */
const keyedFields = (value: { readonly [field: string]: PaintKeyedValue | undefined }) =>
  Object.entries(value).flatMap(([name, field]) => (field === undefined ? [] : [[name, field] as const]));

/** Where a value's numbers lie: one number, an object's fields by name, or an array's items. */
type KeyedLayout = { readonly kind: 'number' } | { readonly kind: 'object'; readonly fields: readonly (readonly [string, KeyedLayout])[] } | { readonly kind: 'array'; readonly items: readonly KeyedLayout[] };

function keyedLayoutOf(value: PaintKeyedValue): KeyedLayout {
  if (typeof value === 'number') return { kind: 'number' };
  if (isKeyedArray(value)) return { kind: 'array', items: value.map(keyedLayoutOf) };
  // By name, so keys naming the same fields in another order share a layout.
  const fields = keyedFields(value).toSorted(([a], [b]) => Number(a > b) - Number(a < b));
  return { kind: 'object', fields: fields.map(([name, field]) => [name, keyedLayoutOf(field)] as const) };
}

/** `value`'s numbers in `layout`'s order, or null where it isn't laid out so. */
function keyedNumbersIn(value: PaintKeyedValue, layout: KeyedLayout): number[] | null {
  const numbers: number[] = [];
  const walk = (part: PaintKeyedValue | undefined, at: KeyedLayout): boolean => {
    if (at.kind === 'number') return typeof part === 'number' && numbers.push(part) > 0;
    if (part === undefined || typeof part === 'number') return false;
    if (at.kind === 'array') return isKeyedArray(part) && part.length === at.items.length && at.items.every((item, i) => walk(part[i], item));
    return !isKeyedArray(part) && keyedFields(part).length === at.fields.length && at.fields.every(([name, field]) => walk(part[name], field));
  };
  return walk(value, layout) ? numbers : null;
}

function keyedRebuilt(numbers: readonly number[], layout: KeyedLayout, at: { i: number }): PaintKeyedValue {
  if (layout.kind === 'number') return numbers[at.i++];
  if (layout.kind === 'array') return layout.items.map((item) => keyedRebuilt(numbers, item, at));
  return Object.fromEntries(layout.fields.map(([name, field]) => [name, keyedRebuilt(numbers, field, at)]));
}

function leafCount(layout: KeyedLayout): number {
  if (layout.kind === 'number') return 1;
  if (layout.kind === 'array') return layout.items.reduce((n, item) => n + leafCount(item), 0);
  return layout.fields.reduce((n, [, field]) => n + leafCount(field), 0);
}

/** Each top-level channel's name and the numbers it holds, [first, end): one unnamed channel for a number or an array. */
function channelsOf(layout: KeyedLayout): { readonly name: string; readonly from: number; readonly to: number }[] {
  if (layout.kind !== 'object') return [{ name: '', from: 0, to: leafCount(layout) }];
  let from = 0;
  return layout.fields.map(([name, field]) => {
    const to = from + leafCount(field), channel = { name, from, to };
    from = to;
    return channel;
  });
}

// ---- a stretch between two keys ----------------------------------------------------------------------------------

/** A path through points in the space of the numbers it routes, walked by the share of its length covered. */
type KeyedPath = { readonly at: (share: number) => number[] };

/** `v` scaled to length 1. */
function unitVector(v: readonly number[]): number[] {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

/** A chordal Catmull-Rom path through `points`, read by arc length (each piece sampled 32 times). */
function keyedPath(points: readonly (readonly number[])[], where: string): KeyedPath {
  const chord = (i: number) => Math.hypot(...points[i + 1].map((v, d) => v - points[i][d]));
  const knots = [0];
  for (let i = 0; i + 1 < points.length; i++) {
    if (!(chord(i) > 0)) throw new RangeError(`paintKeyed: ${where} passes point ${i + 1} at the point before it`);
    knots.push(knots[i] + chord(i));
  }
  const last = points.length - 1;
  const tangent = (i: number) => {
    const a = Math.max(0, i - 1), b = Math.min(last, i + 1);
    return points[b].map((v, d) => (v - points[a][d]) / (knots[b] - knots[a]));
  };
  const tangents = points.map((_, i) => tangent(i));
  const pieceAt = (i: number, u: number) => {
    const h = knots[i + 1] - knots[i], u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    return points[i].map((p0, d) => h00 * p0 + h10 * h * tangents[i][d] + h01 * points[i + 1][d] + h11 * h * tangents[i + 1][d]);
  };
  // Arc length along the path at 32 steps a piece: piece i's step j is entry 32i + j.
  const STEPS = 32, lengths = [0], places: { piece: number; u: number }[] = [{ piece: 0, u: 0 }];
  let previous = points[0];
  for (let i = 0; i < last; i++) {
    for (let j = 1; j <= STEPS; j++) {
      const here = pieceAt(i, j / STEPS);
      lengths.push(lengths.at(-1)! + Math.hypot(...here.map((v, d) => v - previous[d])));
      places.push({ piece: i, u: j / STEPS });
      previous = here;
    }
  }
  const total = lengths.at(-1)!, startDirection = unitVector(tangents[0]), endDirection = unitVector(tangents[last]);
  return {
    at: (share) => {
      // Past either end (an overshooting curve), straight on along the end's tangent.
      if (share <= 0) return points[0].map((v, d) => v + share * total * startDirection[d]);
      if (share >= 1) return points[last].map((v, d) => v + (share - 1) * total * endDirection[d]);
      const length = share * total;
      let lo = 0, hi = lengths.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (lengths[mid] <= length) lo = mid;
        else hi = mid;
      }
      const k = (length - lengths[lo]) / (lengths[hi] - lengths[lo]), a = places[lo], b = places[hi];
      return a.piece === b.piece ? pieceAt(a.piece, a.u + k * (b.u - a.u)) : pieceAt(b.piece, k * b.u);
    },
  };
}

/** How one number moves across a stretch: held, eased, sprung, a smooth cubic, or along its key's path. */
type NumberMove =
  | { readonly kind: 'hold' }
  | { readonly kind: 'ease'; readonly ease: (share: number) => number }
  | { readonly kind: 'spring'; readonly timing: Extract<PaintCurveTiming, { kind: 'spring' }> }
  | { readonly kind: 'smooth' }
  | { readonly kind: 'path'; readonly dimension: number };

type Stretch = {
  readonly t0: number; readonly t1: number;
  readonly a: readonly number[]; readonly b: readonly number[];
  readonly moves: readonly NumberMove[];
  /** The path its routed numbers take, and the curve they walk it by. */
  readonly path: { readonly path: KeyedPath; readonly progress: PaintCurveTiming | null } | null;
  /** When the springs into its key have all settled, or null for none. */
  readonly springSettles: number | null;
};

/** The share of the way a stretch's curve has covered at `t`; a spring's starts `arrival` before its key. */
function shareAt(timing: PaintCurveTiming | null, stretch: Pick<Stretch, 't0' | 't1'>, t: number): number {
  if (!timing) return (t - stretch.t0) / (stretch.t1 - stretch.t0);
  if (timing.kind === 'ease') return timing.ease(Math.min(1, Math.max(0, (t - stretch.t0) / (stretch.t1 - stretch.t0))));
  return timing.spring(t - (stretch.t1 - timing.spring.arrival));
}

// ---- keys checked and laid out -----------------------------------------------------------------------------------

/** A key resolved: its time and numbers (the key before's, for a hold), and how the value moves into it. */
type ResolvedKey = {
  readonly at: number; readonly numbers: readonly number[]; readonly hold: boolean;
  readonly curve: PaintCurve | undefined; readonly curves: ReadonlyMap<string, PaintCurve>; readonly through: readonly PaintKeyedValue[];
};

/**
 * `keys` as a value of the moment (see the file's head), read at its moment's `at`. Throws a RangeError naming the key
 * for keys out of order or of another layout, a value not finite, a hold or curve on key 0, a curve that can't fit its
 * stretch, or through points naming channels unevenly.
 */
export function paintKeyed<T extends PaintKeyedValue>(keys: readonly PaintKey<T>[], options: PaintKeyedOptions = {}): PaintKeyed<T> {
  const between = options.between ?? 'linear';
  if (!keys.length) throw new RangeError('paintKeyed: it has no keys');
  const first = keys[0];
  if ('hold' in first) throw new RangeError('paintKeyed: key 0 holds, but no key comes before it to hold');
  if (first.curve !== undefined || first.curves !== undefined || first.through !== undefined) throw new RangeError('paintKeyed: key 0 has a curve or through points, but no key comes before it to move from');
  if (!isPaintKeyedValue(first.value)) throw new RangeError('paintKeyed: key 0\'s value isn\'t finite numbers alone, in objects and arrays');
  const layout = keyedLayoutOf(first.value), channels = channelsOf(layout), size = leafCount(layout);
  const resolved: ResolvedKey[] = [];
  for (const [i, key] of keys.entries()) {
    if (!Number.isFinite(key.at)) throw new RangeError(`paintKeyed: key ${i} is at ${key.at} s, not a finite time`);
    if (i && !(key.at > keys[i - 1].at)) throw new RangeError(`paintKeyed: key ${i} is at ${key.at} s, not after key ${i - 1} at ${keys[i - 1].at} s`);
    if ('hold' in key) {
      resolved.push({ at: key.at, numbers: resolved[i - 1].numbers, hold: true, curve: undefined, curves: new Map(), through: [] });
      continue;
    }
    const numbers = isPaintKeyedValue(key.value) ? keyedNumbersIn(key.value, layout) : null;
    if (!numbers) throw new RangeError(`paintKeyed: key ${i}'s value isn't shaped as key 0's: every key names the same finite numbers`);
    const through = (key.through ?? []).map((point, p) => {
      if (!isPaintKeyedValue(point)) throw new RangeError(`paintKeyed: key ${i}'s through point ${p} isn't finite numbers alone`);
      return point;
    });
    // SAFETY: `curves` names channels by name, each a PaintCurve.
    const curves = (key.curves ?? {}) as Readonly<Record<string, PaintCurve | undefined>>;
    const named = Object.entries(curves).flatMap(([name, curve]) => (curve === undefined ? [] : [[name, curve] as const]));
    resolved.push({ at: key.at, numbers, hold: false, curve: key.curve, curves: new Map(named), through });
  }
  const stretches = resolved.slice(1).map((key, k) => stretchInto(resolved[k], key, k + 1, layout, channels, between));
  const smoothed = between === 'smooth' ? smoothTangents(resolved, stretches, size) : stretches.map(() => null);
  const settlesAt = Math.max(resolved.at(-1)!.at, ...stretches.map(({ springSettles }) => springSettles ?? -Infinity));
  const evaluate = (t: number): number[] => {
    if (t <= resolved[0].at || stretches.length === 0) return [...resolved[0].numbers];
    let index = stretches.findIndex((stretch) => t < stretch.t1);
    if (index < 0) index = stretches.length;
    const numbers = index < stretches.length ? stretchAt(stretches[index], t, smoothed[index]) : [...resolved.at(-1)!.numbers];
    // A spring settling past its key adds what it still lacks or overshoots to what follows.
    for (let s = 0; s < index; s++) {
      const stretch = stretches[s];
      if (stretch.springSettles === null || t >= stretch.springSettles) continue;
      const walked = stretch.path?.progress?.kind === 'spring' ? stretch.path.path.at(shareAt(stretch.path.progress, stretch, t)) : null;
      for (const [n, move] of stretch.moves.entries()) {
        if (move.kind === 'spring') numbers[n] += (stretch.b[n] - stretch.a[n]) * (move.timing.spring(t - (stretch.t1 - move.timing.spring.arrival)) - 1);
        else if (move.kind === 'path' && walked) numbers[n] += walked[move.dimension] - stretch.b[n];
      }
    }
    return numbers;
  };
  // SAFETY: rebuilt in key 0's layout, which every key's value has, so it is a T.
  return Object.assign((moment: PaintMoment) => keyedRebuilt(evaluate(moment.at), layout, { i: 0 }) as T, { settlesAt });
}

function stretchInto(from: ResolvedKey, to: ResolvedKey, index: number, layout: KeyedLayout, channels: ReturnType<typeof channelsOf>, between: 'linear' | 'smooth'): Stretch {
  const where = `key ${index}`, seconds = to.at - from.at, size = from.numbers.length;
  const base = { t0: from.at, t1: to.at, a: from.numbers, b: to.numbers };
  if (to.hold) return { ...base, moves: Array.from({ length: size }, () => ({ kind: 'hold' as const })), path: null, springSettles: null };
  const curveOf = (curve: PaintCurve | undefined, what: string) => {
    if (curve === undefined) return null;
    const problem = paintCurveProblem(curve, seconds);
    if (problem) throw new RangeError(`paintKeyed: ${where}${what}: ${problem}`);
    const made = paintCurveTiming(curve, seconds);
    if (made.kind === 'spring' && made.spring.arrival > seconds + 1e-9) {
      throw new RangeError(`paintKeyed: ${where}${what} springs in over ${made.spring.arrival.toFixed(3)} s to arrive on it, more than the ${seconds} s since key ${index - 1}`);
    }
    return made;
  };
  const whole = curveOf(to.curve, '');
  for (const name of to.curves.keys()) if (!channels.some((channel) => channel.name === name && name)) throw new RangeError(`paintKeyed: ${where} curves ${name}, which isn't a channel of its value`);
  const routed = new Set<string>(), points: number[][] = [];
  for (const [p, point] of to.through.entries()) {
    // A value with channels is routed by the channels its points name; any other, whole.
    if (layout.kind === 'object' && (typeof point === 'number' || isKeyedArray(point))) throw new RangeError(`paintKeyed: ${where}'s through point ${p} isn't an object naming the channels it routes`);
    const parts = new Map<string, PaintKeyedValue>(typeof point === 'number' || isKeyedArray(point) ? [['', point]] : keyedFields(point));
    const names = [...parts.keys()].toSorted();
    if (p && names.join() !== [...routed].toSorted().join()) throw new RangeError(`paintKeyed: ${where}'s through point ${p} routes ${names.join(', ')}, not the ${[...routed].join(', ')} its first does`);
    for (const name of names) {
      if (!channels.some((each) => each.name === name)) throw new RangeError(`paintKeyed: ${where}'s through point ${p} names ${name}, which isn't a channel of its value`);
      if (to.curves.has(name)) throw new RangeError(`paintKeyed: ${where} routes ${name} through points and curves it apart; a routed channel moves by the key's curve`);
      routed.add(name);
    }
    // In channel order, as routedNumbers reads them.
    const numbers: number[] = [];
    for (const channel of channels.filter(({ name }) => routed.has(name))) {
      const fieldLayout = layout.kind === 'object' ? layout.fields.find(([field]) => field === channel.name)![1] : layout;
      const part = keyedNumbersIn(parts.get(channel.name)!, fieldLayout);
      if (!part) throw new RangeError(`paintKeyed: ${where}'s through point ${p} isn't shaped as its value's ${channel.name || 'numbers'}`);
      numbers.push(...part);
    }
    points.push(numbers);
  }
  const routedNumbers = channels.filter(({ name }) => routed.has(name)).flatMap(({ from: a, to: b }) => Array.from({ length: b - a }, (_, k) => a + k));
  const path = points.length ? { path: keyedPath([routedNumbers.map((n) => from.numbers[n]), ...points, routedNumbers.map((n) => to.numbers[n])], where), progress: whole } : null;
  const moves: NumberMove[] = [];
  let springSettles = -Infinity;
  for (const channel of channels) {
    const timing = to.curves.has(channel.name) ? curveOf(to.curves.get(channel.name), `'s ${channel.name}`) : whole;
    for (let n = channel.from; n < channel.to; n++) {
      if (routed.has(channel.name)) {
        moves.push({ kind: 'path', dimension: routedNumbers.indexOf(n) });
        if (timing?.kind === 'spring') springSettles = Math.max(springSettles, to.at - timing.spring.arrival + timing.spring.settled);
      }
      else if (!timing) moves.push(between === 'smooth' ? { kind: 'smooth' } : { kind: 'ease', ease: (u) => u });
      else if (timing.kind === 'spring') {
        moves.push({ kind: 'spring', timing });
        springSettles = Math.max(springSettles, to.at - timing.spring.arrival + timing.spring.settled);
      } else moves.push({ kind: 'ease', ease: timing.ease });
    }
  }
  return { ...base, moves, path, springSettles: springSettles > -Infinity ? springSettles : null };
}

/** A smooth stretch's tangents at its two keys, number by number, in units a second (0 for a number not smooth). */
type SmoothTangents = { readonly m0: readonly number[]; readonly m1: readonly number[] };

/** Each number of `stretch` at `t`, inside it; `smooth` its tangents where it's a smooth stretch. */
function stretchAt(stretch: Stretch, t: number, smooth: SmoothTangents | null): number[] {
  const { t0, t1, a, b } = stretch, h = t1 - t0, u = (t - t0) / h;
  const walked = stretch.path && stretch.path.path.at(shareAt(stretch.path.progress, stretch, t));
  return stretch.moves.map((move, n) => {
    switch (move.kind) {
      case 'hold': return a[n];
      case 'ease': return a[n] + (b[n] - a[n]) * move.ease(u);
      case 'spring': return t < t1 - move.timing.spring.arrival ? a[n] : a[n] + (b[n] - a[n]) * move.timing.spring(t - (t1 - move.timing.spring.arrival));
      case 'path': return walked![move.dimension];
      case 'smooth': {
        const u2 = u * u, u3 = u2 * u;
        return (2 * u3 - 3 * u2 + 1) * a[n] + (u3 - 2 * u2 + u) * h * smooth!.m0[n] + (-2 * u3 + 3 * u2) * b[n] + (u3 - u2) * h * smooth!.m1[n];
      }
      default: return move satisfies never;
    }
  });
}

/** How fast number `n` of a stretch that isn't smooth moves at its key `end` (its start or its end), a second. */
function stretchSpeedAt(stretch: Stretch, n: number, end: 'start' | 'end'): number {
  const move = stretch.moves[n];
  // A spring's motion past its key is carried by the spring itself, so what follows leaves the key from rest.
  if (move.kind === 'hold' || move.kind === 'spring') return 0;
  const eps = (stretch.t1 - stretch.t0) * 1e-4, t = end === 'start' ? stretch.t0 : stretch.t1;
  const [p, q] = end === 'start' ? [t, t + eps] : [t - eps, t];
  // Its smooth numbers, if any, aren't read: zeros stand in for tangents not yet found.
  const zeros = { m0: stretch.a.map(() => 0), m1: stretch.a.map(() => 0) };
  return (stretchAt(stretch, q, zeros)[n] - stretchAt(stretch, p, zeros)[n]) / eps;
}

/** `speed` held to what keeps a smooth stretch of secant `d` from overshooting: within 3 times it, and none against it. */
const speedWithin = (speed: number, d: number) => (d === 0 || Math.sign(speed) !== Math.sign(d) ? 0 : Math.sign(d) * Math.min(Math.abs(speed), 3 * Math.abs(d)));

/**
 * Each smooth stretch's tangents, number by number: 0 at the first and last keys, PCHIP's weighted harmonic mean
 * between two smooth stretches, and beside a stretch that isn't smooth its speed at the key, held to what keeps the
 * smooth one from overshooting (no more than 3 times its secant, and none against it).
 */
function smoothTangents(keys: readonly ResolvedKey[], stretches: readonly Stretch[], size: number): (SmoothTangents | null)[] {
  const secant = (s: number, n: number) => (stretches[s].b[n] - stretches[s].a[n]) / (stretches[s].t1 - stretches[s].t0);
  const smooth = (s: number, n: number) => stretches[s]?.moves[n].kind === 'smooth';
  const at = (k: number, n: number, side: 'into' | 'out of'): number => {
    if (k === 0 || k === keys.length - 1) return 0;
    const left = k - 1, right = k;
    if (smooth(left, n) && smooth(right, n)) {
      const d0 = secant(left, n), d1 = secant(right, n);
      if (d0 * d1 <= 0) return 0;
      const h0 = keys[k].at - keys[k - 1].at, h1 = keys[k + 1].at - keys[k].at, w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
      return (w1 + w2) / (w1 / d0 + w2 / d1);
    }
    // One side isn't smooth: the smooth side, `side` of key k, meets its speed there.
    return side === 'into' ? speedWithin(stretchSpeedAt(stretches[right], n, 'start'), secant(left, n)) : speedWithin(stretchSpeedAt(stretches[left], n, 'end'), secant(right, n));
  };
  return stretches.map((stretch, s) => {
    if (!stretch.moves.some((move) => move.kind === 'smooth')) return null;
    const m0 = Array.from({ length: size }, (_, n) => (smooth(s, n) ? at(s, n, 'out of') : 0));
    const m1 = Array.from({ length: size }, (_, n) => (smooth(s, n) ? at(s + 1, n, 'into') : 0));
    return { m0, m1 };
  });
}

// ---- accents ------------------------------------------------------------------------------------------------------

/** `value` with every number 0: an added move's rest, which adds nothing. */
function zeroOf<T extends PaintKeyedValue>(value: T): T {
  const layout = keyedLayoutOf(value);
  // SAFETY: rebuilt in `value`'s own layout, so it is a T.
  return keyedRebuilt(Array.from({ length: leafCount(layout) }, () => 0), layout, { i: 0 }) as T;
}

/**
 * An accent: from rest (every number 0), up to `peak` over `attack` s, on it at second `at`, and back to rest over
 * `settle` s; each stretch `inOut` unless `curves` says. Its rest adds nothing, so it's for a play that adds, as a
 * camera kick on a move does (`blend: 'add'`), or a value added to by hand.
 */
export function paintKeyedAccent<T extends PaintKeyedValue>(o: {
  readonly at: number; readonly peak: T; readonly attack: number; readonly settle: number; readonly curves?: { readonly attack?: PaintCurve; readonly settle?: PaintCurve };
}): PaintKeyed<T> {
  const rest = zeroOf(o.peak);
  return paintKeyed<T>([
    { at: o.at - o.attack, value: rest },
    { at: o.at, value: o.peak, curve: o.curves?.attack ?? 'inOut' },
    { at: o.at + o.settle, value: rest, curve: o.curves?.settle ?? 'inOut' },
  ]);
}

/**
 * A hit: from rest, back to `anticipate.value` over its `lead` s (the wind-up), then into `peak` over `attack` s, on
 * it at second `at`, and back to rest over `settle` s; each stretch `inOut` unless `curves` says. Its rest adds
 * nothing (paintKeyedAccent).
 */
export function paintKeyedHit<T extends PaintKeyedValue>(o: {
  readonly at: number; readonly peak: T; readonly attack: number; readonly settle: number; readonly anticipate: { readonly value: T; readonly lead: number };
  readonly curves?: { readonly anticipate?: PaintCurve; readonly attack?: PaintCurve; readonly settle?: PaintCurve };
}): PaintKeyed<T> {
  const rest = zeroOf(o.peak);
  return paintKeyed<T>([
    { at: o.at - o.attack - o.anticipate.lead, value: rest },
    { at: o.at - o.attack, value: o.anticipate.value, curve: o.curves?.anticipate ?? 'inOut' },
    { at: o.at, value: o.peak, curve: o.curves?.attack ?? 'inOut' },
    { at: o.at + o.settle, value: rest, curve: o.curves?.settle ?? 'inOut' },
  ]);
}

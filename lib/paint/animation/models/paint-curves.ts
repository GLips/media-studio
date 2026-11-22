// paint-curves.ts: how a keyed value (paint-keyed.ts) moves into a key from the one before: lib/picture/motion's eases,
// said on keys. Most shape the share of the way covered across the stretch between the two keys; three are timed in
// seconds of their own: a spring, which arrives on its key (98% of the way, motion.ts's `arrival`) and settles after
// it; a latch, a paper flap rising soft and latching on its key into a quiver; and a move that accelerates, cruises
// and brakes.
//
// Only a spring, a latch and `back` overshoot their key; every other curve stays between its two keys' values.

import { backOutEase, latchCurve, perceptualSpring, powerOutEase, type SettlingCurve } from '#lib/picture/motion/models/motion.ts';

/**
 * `linear`: an even pace. `in`, `out`, `inOut`: quadratic from rest, to rest, or both; `{ in: p }` and the rest, at
 * power p. `{ back: o }`: overshooting by `o`. `{ spring }`: perceptualSpring; `{ latch }`:
 * latchCurve (size 0.4 left out); both arrive on the key. `{ accelerate, brake }`: seconds speeding up and
 * slowing down. Or an ease of the share, 0 to 1.
 */
export type PaintCurve =
  | 'linear' | 'in' | 'out' | 'inOut'
  | { readonly in: number } | { readonly out: number } | { readonly inOut: number }
  | { readonly back: number }
  | { readonly spring: { readonly duration: number; readonly bounce?: number } }
  | { readonly latch: { readonly size?: number } }
  | { readonly accelerate: number; readonly brake: number }
  | ((share: number) => number);

/**
 * A curve over one stretch: an ease of its share (0..1, past 1 for `back`), or a settling curve (a spring, a latch),
 * timed from `arrival` seconds before its key.
 */
export type PaintCurveTiming = { readonly kind: 'ease'; readonly ease: (share: number) => number } | { readonly kind: 'settling'; readonly curve: SettlingCurve };

const powerIn = (power: number) => (u: number) => u ** power;
const powerInOut = (power: number) => (u: number) => (u < 0.5 ? 2 ** (power - 1) * u ** power : 1 - (2 - 2 * u) ** power / 2);

/** Even acceleration over `a` of the stretch, an even cruise, even braking over the last `b`: the shares covered. */
function acceleratingEase(a: number, b: number) {
  const peak = 2 / (2 - a - b);
  return (u: number) => {
    if (u < a) return (peak * u * u) / (2 * a);
    if (u > 1 - b) return 1 - (peak * (1 - u) * (1 - u)) / (2 * b);
    return peak * (u - a / 2);
  };
}

const positive = (n: number) => n > 0 && Number.isFinite(n);

/** The power an `in`, `out` or `inOut` curve gives. */
function curvePower(curve: { readonly in: number } | { readonly out: number } | { readonly inOut: number }): number {
  if ('in' in curve) return curve.in;
  return 'out' in curve ? curve.out : curve.inOut;
}

const eased = (ease: (share: number) => number): PaintCurveTiming => ({ kind: 'ease', ease });

/** Why `curve` can't move a value across a stretch `seconds` long, or null. */
export function paintCurveProblem(curve: PaintCurve, seconds: number): string | null {
  if (typeof curve === 'string') return null;
  if (typeof curve === 'function') {
    const start = curve(0), end = curve(1);
    return Math.abs(start) < 1e-6 && Math.abs(end - 1) < 1e-6 ? null : `its curve function runs from ${start} to ${end}; an ease runs from 0 to 1`;
  }
  if ('back' in curve) return curve.back >= 0 && Number.isFinite(curve.back) ? null : `its curve overshoots by ${curve.back}, not 0 or more`;
  if ('spring' in curve) {
    const { duration, bounce = 0 } = curve.spring;
    return positive(duration) && bounce >= 0 && bounce < 1 ? null : `its spring takes a duration above 0 and a bounce in 0..1 (1 left out), not ${duration} s and ${bounce}`;
  }
  if ('latch' in curve) {
    const { size = 0.4 } = curve.latch;
    return positive(size) ? null : `its latch's size is ${size}, not above 0`;
  }
  if ('accelerate' in curve) {
    const { accelerate, brake } = curve;
    if (!(accelerate >= 0 && brake >= 0 && Number.isFinite(accelerate + brake))) return `it accelerates over ${accelerate} s and brakes over ${brake} s; each is 0 s or more`;
    return accelerate + brake <= seconds + 1e-9 ? null : `it accelerates over ${accelerate} s and brakes over ${brake} s, more than the ${seconds} s since the key before`;
  }
  const power = curvePower(curve);
  return positive(power) ? null : `its curve's power is ${power}, not above 0`;
}

/** `curve` over a stretch `seconds` long, checked first by paintCurveProblem. */
export function paintCurveTiming(curve: PaintCurve, seconds: number): PaintCurveTiming {
  if (typeof curve === 'function') return eased(curve);
  switch (curve) {
    case 'linear': return eased((u) => u);
    case 'in': return eased(powerIn(2));
    case 'out': return eased(powerOutEase(2));
    case 'inOut': return eased(powerInOut(2));
  }
  if ('in' in curve) return eased(powerIn(curve.in));
  if ('out' in curve) return eased(powerOutEase(curve.out));
  if ('inOut' in curve) return eased(powerInOut(curve.inOut));
  if ('back' in curve) return eased(backOutEase(curve.back));
  if ('spring' in curve) return { kind: 'settling', curve: perceptualSpring(curve.spring.duration, curve.spring.bounce) };
  if ('latch' in curve) return { kind: 'settling', curve: latchCurve(curve.latch.size) };
  return eased(acceleratingEase(curve.accelerate / seconds, curve.brake / seconds));
}

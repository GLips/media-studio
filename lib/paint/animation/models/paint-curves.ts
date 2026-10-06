// paint-curves.ts: how a keyed value (paint-keyed.ts) moves into a key from the one before: lib/picture/motion's eases,
// said on keys. Most shape the share of the way covered across the stretch between the two keys; two are timed in
// seconds of their own: a spring, which arrives on its key (98% of the way, motion.ts's `arrival`) and settles after
// it, and a move that accelerates, cruises and brakes.
//
// Only a spring and `back` overshoot their key; every other curve stays between its two keys' values.

import { backOutEase, perceptualSpring, powerOutEase, type PerceptualSpring } from '#lib/picture/motion/models/motion.ts';

/**
 * `linear`: an even pace. `in`, `out`, `inOut`: quadratic from rest, to rest, or both; `{ in: p }` and the rest, at
 * power p. `{ back: o }`: past the key by `o` of the way, settling back. `{ spring }`: perceptualSpring, arriving on
 * the key. `{ accelerate, brake }`: seconds speeding up and slowing down. Or an ease of the share, 0 to 1.
 */
export type PaintCurve =
  | 'linear' | 'in' | 'out' | 'inOut'
  | { readonly in: number } | { readonly out: number } | { readonly inOut: number }
  | { readonly back: number }
  | { readonly spring: { readonly duration: number; readonly bounce?: number } }
  | { readonly accelerate: number; readonly brake: number }
  | ((share: number) => number);

/**
 * A curve over one stretch: an ease of its share (0..1, past 1 for `back`), or a spring, timed from `arrival`
 * seconds before its key.
 */
export type PaintCurveTiming = { readonly kind: 'ease'; readonly ease: (share: number) => number } | { readonly kind: 'spring'; readonly spring: PerceptualSpring };

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
  if ('spring' in curve) return { kind: 'spring', spring: perceptualSpring(curve.spring.duration, curve.spring.bounce) };
  return eased(acceleratingEase(curve.accelerate / seconds, curve.brake / seconds));
}

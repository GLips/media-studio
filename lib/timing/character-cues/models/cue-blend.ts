// cue-blend.ts: how a control travels to a cue's value: a cut, an ease over a length, or a spring. Each is a pure
// function of seconds since the cue, so any frame can be drawn alone.
//
// A spring is the studio's perceptualSpring: it may overshoot (progress past 1) before it settles. A discrete control
// (a hand shape) switches at the spring's arrival, a time, so a bounce back below home can't flip it back.

import { perceptualSpring } from '#lib/picture/motion/models/motion.ts';
import { cueOffsetSeconds, type CueOffset, type CueSeconds } from './cue-time.ts';

export type CueEaseCurve = 'linear' | 'in' | 'out' | 'in-out';

/** perceptualSpring's terms: `duration` its pace in seconds, `bounce` its overshoot from 0 (none) toward 1. */
export type CueSpring = { readonly duration: number; readonly bounce?: number };

/** `'cut'` (the default), `{ ease: { seconds: 0.3 } }` (in and out unless `curve` says), or `{ spring: {…} }`. */
export type CueBlend = 'cut' | { readonly ease: CueOffset; readonly curve?: CueEaseCurve } | { readonly spring: CueSpring };

/** A blend made concrete: progress at seconds since its cue, when it arrives (discrete controls switch), when it is 1. */
export type CueBlendCurve = {
  readonly progress: (seconds: number) => number;
  readonly arrives: number;
  readonly settles: number;
};

const CUT: CueBlendCurve = { progress: () => 1, arrives: 0, settles: 0 };

const EASES: Readonly<Record<CueEaseCurve, (t: number) => number>> = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  'in-out': (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
};

const springs = new Map<string, CueBlendCurve>();

function springCurve({ duration, bounce = 0 }: CueSpring): CueBlendCurve {
  const key = `${duration}/${bounce}`;
  const known = springs.get(key);
  if (known) return known;
  const spring = perceptualSpring(duration, bounce);
  const curve: CueBlendCurve = { progress: spring, arrives: spring.arrival, settles: spring.settled };
  springs.set(key, curve);
  return curve;
}

/** `blend` on `clock`'s grid: an ease in beats is as long as those beats from `from` seconds. */
export function cueBlendCurve(blend: CueBlend, clock: CueSeconds, from: number): CueBlendCurve {
  if (blend === 'cut') return CUT;
  if ('spring' in blend) return springCurve(blend.spring);
  const seconds = cueOffsetSeconds(clock, from, blend.ease);
  if (!(seconds > 0)) return CUT;
  const curve = EASES[blend.curve ?? 'in-out'];
  const progress = (s: number) => {
    if (s >= seconds) return 1;
    return s <= 0 ? 0 : curve(s / seconds);
  };
  return { progress, arrives: seconds, settles: seconds };
}

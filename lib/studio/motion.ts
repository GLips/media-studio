// motion.ts: easing and progress helpers. Everything a scene draws is a function of its clock, so these are the
// whole vocabulary of change: `seg` turns a stretch of time into eased 0..1 progress, shaped by a curve token.
//
// The tokens are defaults for one register, calm and legible walkthrough UI. A teaser or showreel designs its own
// motion, and nothing here constrains that.

import { Easing, measureSpring, spring, type SpringConfig } from 'remotion';
import { FPS } from './frame.ts';

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export type EaseFn = (k: number) => number;

/** A curve for each role a move plays: `standard` moves within the frame, `entrance` arrives, `exit` leaves. */
export type CurveRoles = { standard: EaseFn; entrance: EaseFn; exit: EaseFn };

const bezier = (x1: number, y1: number, x2: number, y2: number): EaseFn => {
  const fn = Easing.bezier(x1, y1, x2, y2);
  return (k) => fn(clamp(k));
};

/**
 * Named curves, one system per register. Pick a system, then the role: `motionCurves.productive.entrance`.
 * Systems stay whole, so a video never mixes two families' curves without saying so.
 */
export const motionCurves = {
  /** IBM Carbon's productive set (@carbon/motion): brisk and unfussy, for walkthrough UI. */
  productive: {
    standard: bezier(0.2, 0, 0.38, 0.9),
    entrance: bezier(0, 0, 0.38, 0.9),
    exit: bezier(0.2, 0, 1, 0.9),
  },
  /** IBM Carbon's expressive set (@carbon/motion): a longer, softer landing, for reveals and moments that matter. */
  expressive: {
    standard: bezier(0.4, 0.14, 0.3, 1),
    entrance: bezier(0, 0, 0.3, 1),
    exit: bezier(0.4, 0.14, 1, 1),
  },
  /**
   * Robert Penner's cubic in-out, out and in. The library's own pieces (captions, text, rings, cards) and the camera
   * default use these, so videos already approved keep their motion. Stronger at the ends than Carbon's.
   */
  cubic: {
    standard: (k) => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; },
    entrance: (k) => 1 - Math.pow(1 - clamp(k), 3),
    exit: (k) => Math.pow(clamp(k), 3),
  },
  /**
   * Exponential (Penner's expo, exact: an arrival is 1 − 2^(−10k)): the showreel's snap. An arrival is half done a
   * tenth of the way in and then settles for the rest, so a move lands hard on its beat and still looks finished; its
   * standard move waits, whips through the middle and brakes. The reference reel's settles fit it within a pixel.
   * For a teaser or reel, not walkthrough UI.
   */
  expo: {
    standard: (k) => { k = clamp(k); return k === 0 || k === 1 ? k : k < 0.5 ? Math.pow(2, 20 * k - 10) / 2 : (2 - Math.pow(2, -20 * k + 10)) / 2; },
    entrance: (k) => { k = clamp(k); return k === 1 ? 1 : 1 - Math.pow(2, -10 * k); },
    exit: (k) => { k = clamp(k); return k === 0 ? 0 : Math.pow(2, 10 * k - 10); },
  },
  /** Smoothstep: an even, symmetric ease for opacity, where a dissolve shouldn't be seen to accelerate. */
  dissolve: (k) => { k = clamp(k); return k * k * (3 - 2 * k); },
  /** Constant speed: for what the viewer reads as mechanical on purpose (a scroll, a timer, a progress bar). */
  linear: (k) => clamp(k),
} as const satisfies Record<string, CurveRoles | EaseFn>;

/** Penner's power ease-out, 1 − (1 − k)^power: 2 is his quad, 4 his quart. */
export const powerOutEase = (power: number): EaseFn => (k) => 1 - (1 - clamp(k)) ** power;

/** Penner's sine in-out, half a cosine: softer at both ends than the cubic in-out. */
export const sineInOutEase: EaseFn = (k) => (1 - Math.cos(Math.PI * clamp(k))) / 2;

/**
 * Penner's back-out, set by how far it overshoots as a share of the travel (0.1 is 10% past the target) rather than
 * by its constant s, so a measured overshoot drops straight in: 0.126 is s = 1.95. It peaks 1 − 2s/3(s + 1) of the
 * way in and lands on exactly 1; 0 is a cubic ease-out.
 */
export function backOutEase(overshoot: number): EaseFn {
  const s = backOutStrength(overshoot);
  return (k) => {
    if (k <= 0) return 0;
    if (k >= 1) return 1;
    const u = k - 1;
    return 1 + (s + 1) * u * u * u + s * u * u;
  };
}

// Back-out's peak overshoot is 4s³ / 27(s + 1)², which only rises with s, so bisection finds the s for a peak.
function backOutStrength(overshoot: number) {
  let lo = 0, hi = 20;
  for (let i = 0; i < 48; i++) {
    const s = (lo + hi) / 2;
    if ((4 * s ** 3) / (27 * (s + 1) ** 2) < overshoot) lo = s;
    else hi = s;
  }
  return lo;
}

/**
 * Seconds for a move, by what it does and how far it goes, written for video: the viewer sees it once, at full
 * speed. To make a moment read better, lengthen the anticipation before it or the hold on its result ("fast actions,
 * slow meanings"), and leave the move itself alone. Land moves on speech (`s.line(id).word(…).start`), not on these.
 */
export const motionDurations = {
  /** A press or toggle: the cursor's squeeze, a checkbox ticking. */
  press: 0.12,
  /** One state of a page dissolving into the next under a still camera. */
  dissolve: 0.3,
  /** Something leaving. Exits are quicker than entrances: the eye has already moved on. */
  exit: 0.4,
  /** Something arriving: a tag or a line of text (`small`), a card or panel with contents (`large`). */
  enter: { small: 0.5, large: 0.9 },
  /** An element travelling: a nudge within its panel (`short`), across the frame (`long`). */
  travel: { short: 0.5, long: 1.0 },
  /** The camera: a small reframe, a push in or pull back from the whole page to a detail. */
  camera: { reframe: 0.5, push: 1.2 },
} as const;

/** Progress 0..1 through [a, b], eased. Camera moves use the default. */
export const seg = (t: number, a: number, b: number, fn: EaseFn = motionCurves.cubic.standard) => fn(clamp((t - a) / (b - a)));
/** Eased 0→1 starting at `a`: things arriving. */
export const on = (t: number, a: number, len = 0.8) => seg(t, a, a + len);
/** Eased 1→0 starting at `a`: things leaving. */
export const off = (t: number, a: number, len = 0.4) => 1 - seg(t, a, a + len);

// ---------- springs ----------

// "Landed": first within 0.5% of home, as motion.dev's visualDuration. A bouncy spring is crossing home at speed then,
// and overshoots after. "Settled": within 0.05%, and staying there.
const SPRING_LANDED = 0.005;
const SPRING_SETTLED = 0.0005;
const SPRING_STIFFNESS = 100;

/** Progress 0→1 (past 1 while it bounces) at `t` seconds after the spring starts. */
export type DeadlineSpring = ((t: number) => number) & {
  /** Seconds until it first reaches its target: the deadline it was asked for. */
  landed: number;
  /**
   * Seconds until it has finished settling and holds exactly 1. Later than `landed`, and steeply so as it gets bouncier:
   * bounce 0.75 rings on for about 16× `landed`, since the decay is exponential and settling means within 0.05%.
   */
  settled: number;
};

/**
 * A spring that reaches its target `duration` seconds after it starts, so it can land on a word; a bouncy one overshoots
 * after that. `bounce` 0 (no overshoot, the default) to just under 1 sets its shape; how much it overshoots follows
 * from that, not from the duration.
 * For moves only: fades and colour are tweens (`seg`).
 *
 *   const pop = springBy(0.5, 0.25); … scale={lerp(0.8, 1, pop(s.t - (w.start - pop.landed)))}
 */
export function springBy(duration: number, bounce = 0): DeadlineSpring {
  if (!(duration > 0)) throw new RangeError(`springBy: duration must be positive, got ${duration}`);
  if (!(bounce >= 0 && bounce < 1)) throw new RangeError(`springBy: bounce must be in [0, 1), got ${bounce}`);
  const zeta = 1 - bounce;
  const config: Partial<SpringConfig> = { mass: 1, stiffness: SPRING_STIFFNESS, damping: 2 * zeta * Math.sqrt(SPRING_STIFFNESS) };
  // Remotion stretches the spring so it settles at durationInFrames. Measure where it lands on its natural clock, and
  // stretch by what puts that on the deadline. A stiffness from (2π/d)² instead settles 40-65% late.
  const stretch = duration / springLandedSeconds(zeta);
  const durationInFrames = measureSpring({ fps: FPS, config, threshold: SPRING_SETTLED }) * stretch;
  const at = (t: number) => (t <= 0 ? 0 : spring({ frame: t * FPS, fps: FPS, config, durationInFrames, durationRestThreshold: SPRING_SETTLED }));
  return Object.assign(at, { landed: duration, settled: durationInFrames / FPS });
}

/**
 * When a spring of damping ratio `zeta` (stiffness SPRING_STIFFNESS, mass 1) first comes within SPRING_LANDED of
 * home, in seconds on its natural clock. This is the closed form Remotion steps through, including its use of the
 * critically damped solution for zeta 1.
 */
function springLandedSeconds(zeta: number): number {
  const w = Math.sqrt(SPRING_STIFFNESS), w1 = w * Math.sqrt(Math.max(0, 1 - zeta * zeta));
  const gap = (t: number) => zeta < 1
    ? Math.exp(-zeta * w * t) * (Math.cos(w1 * t) + ((zeta * w) / w1) * Math.sin(w1 * t))
    : Math.exp(-w * t) * (1 + w * t);
  let t = 0;
  while (Math.abs(gap(t)) >= SPRING_LANDED) t += 1e-4;
  return t;
}

/** Progress 0→1 (past 1 while it bounces) at `t` seconds after the spring starts. */
export type PerceptualSpring = ((t: number) => number) & {
  /** The perceptual duration it was asked for: the period it swings at, whatever its bounce. */
  duration: number;
  /** Seconds until it first comes within 0.5% of its target. Earlier as it gets bouncier, since it arrives at speed. */
  landed: number;
  /** Seconds until it has finished settling and holds exactly 1. */
  settled: number;
};

/**
 * A spring timed by how it feels rather than by when it arrives: Apple's spring(duration:bounce:), as kvin.me's
 * "Effortless UI spring animations" writes it out. Stiffness is (2π/duration)² and the damping ratio 1 − bounce, so
 * `duration` is the period of its swing and every bounce moves at the same pace; a bouncier one only overshoots more.
 * Where the move must land on a word or beat, use `springBy`, whose `duration` is that deadline instead.
 * Apple's negative bounce (overdamped, slower than smooth) is left out: bounce 0 is already the calmest a move needs.
 */
export function perceptualSpring(duration: number, bounce = 0): PerceptualSpring {
  if (!(duration > 0)) throw new RangeError(`perceptualSpring: duration must be positive, got ${duration}`);
  if (!(bounce >= 0 && bounce < 1)) throw new RangeError(`perceptualSpring: bounce must be in [0, 1), got ${bounce}`);
  const zeta = 1 - bounce;
  const w = (2 * Math.PI) / duration, w1 = w * Math.sqrt(1 - zeta * zeta);
  const gap = (t: number) => zeta < 1
    ? Math.exp(-zeta * w * t) * (Math.cos(w1 * t) + ((zeta * w) / w1) * Math.sin(w1 * t))
    : Math.exp(-w * t) * (1 + w * t);
  // Past `horizon` the gap's envelope is under the settled threshold, so the last step still outside it is the last.
  const step = duration / 2e4;
  const horizon = zeta < 1 ? Math.log(1 / (Math.sqrt(1 - zeta * zeta) * SPRING_SETTLED)) / (zeta * w) : (12 / w);
  let landed = NaN, settled = 0;
  for (let t = 0; t <= horizon; t += step) {
    const g = Math.abs(gap(t));
    if (Number.isNaN(landed) && g < SPRING_LANDED) landed = t;
    if (g >= SPRING_SETTLED) settled = t + step;
  }
  const at = (t: number) => (t <= 0 ? 0 : t >= settled ? 1 : 1 - gap(t));
  return Object.assign(at, { duration, landed, settled });
}

// ---------- staggers ----------

/** Where a stagger starts from: the first item, the last, the middle outward, the ends inward, or an item's index. */
export type StaggerFrom = 'start' | 'end' | 'center' | 'edges' | number;

/**
 * `each` is seconds between neighbours' starts. Or, relative to each item's `duration`, `lagRatio` is the fraction of it
 * the next item waits (manim's lag_ratio): 0 all together, 1 one after another. `max` caps the spread from first
 * start to last.
 */
export type StaggerTiming = ({ each: number } | { lagRatio: number; duration: number }) & { max?: number; from?: StaggerFrom };

/**
 * Seconds after the group starts that item `i` of `n` starts, on a whole frame. With `max`, a long list packs its
 * starts closer, so several items can share a frame. A component that consumes a stagger passes
 * `stagger: { group, index: i, count: n }` to its motion tag, so the tracks see the group.
 *
 *   rows.map((row, i) => <Text … k={seg(s.t, at + stagger(i, rows.length, { each: 0.08, max: 0.4 }), …)} />)
 */
export function stagger(i: number, n: number, timing: StaggerTiming): number {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`stagger: n must be a whole number of items, got ${n}`);
  if (!Number.isInteger(i) || i < 0 || i >= n) throw new RangeError(`stagger: item ${i} is outside 0..${n - 1}`);
  const { lo, hi } = staggerRankRange(n, timing.from);
  if (hi === lo) return 0;
  return quantiseToFrame((staggerSpread(timing, hi - lo) * (staggerRank(i, n, timing.from) - lo)) / (hi - lo));
}

/** Seconds after the group starts that its last item finishes, each item taking `duration`. 0 for no items. */
export function staggerFinish(n: number, timing: StaggerTiming & { duration: number }): number {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`staggerFinish: n must be a whole number of items, got ${n}`);
  if (n === 0) return 0;
  const { lo, hi } = staggerRankRange(n, timing.from);
  return quantiseToFrame(staggerSpread(timing, hi - lo)) + timing.duration;
}

const quantiseToFrame = (seconds: number) => Math.round(seconds * FPS) / FPS;

const staggerSpread = (timing: StaggerTiming, ranks: number) => {
  const each = 'each' in timing ? timing.each : timing.lagRatio * timing.duration;
  return Math.min(each * ranks, timing.max ?? Infinity);
};

function staggerRank(i: number, n: number, from: StaggerFrom = 'start'): number {
  const middle = (n - 1) / 2;
  if (from === 'start') return i;
  if (from === 'end') return n - 1 - i;
  if (from === 'center') return Math.abs(i - middle);
  if (from === 'edges') return middle - Math.abs(i - middle);
  if (!Number.isInteger(from) || from < 0 || from >= n) throw new RangeError(`stagger: from ${from} is outside 0..${n - 1}`);
  return Math.abs(i - from);
}

// The ranks' real range, not 0..n-1: from the centre of an even list the nearest pair is half a step out, and from an
// index origin the far side can be the short one. Normalising by it makes the first mover start at 0 and the last at
// the full spread.
function staggerRankRange(n: number, from: StaggerFrom | undefined) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const r = staggerRank(i, n, from);
    lo = Math.min(lo, r);
    hi = Math.max(hi, r);
  }
  return { lo, hi };
}

// bounce.ts: the model of the bouncing ball that opens the reference reel. One pure function of time
// (`bouncingBallAt`) gives the ball's centre, its squash and stretch and its contact with the ground, and everything
// bounce.tsx draws reads it: the ball, its dotted path, onion-skin ghosts, impact marks, the elastic ground line and
// the callouts, so the path shown is the path flown. It lands once per beat on exact parabolas and never loses height
// (a musical loop, not decaying physics). Its last landing can crouch and launch into the swell (bounce-swell.ts),
// growing until its colour is the next shot's ground.

import { FPS, H, W } from '#models/frame/frame.ts';
import { clamp, lerp, powerOutEase } from '#models/motion/motion.ts';
import { hashRandom } from '#models/motion/random.ts';
import {
  DEG, REF_F, ROUND, TAU, halfHeight, lawStrain, mixStrain, scaleStrain, shapeOfStrain, strainOf, type Strain,
} from './bounce-shape.ts';
import { SWELL_TIME, fieldSwellAt, smearSamples } from './bounce-swell.ts';

// ---------- the reference's measures ----------

// Reel 01, 0.9–2.8 s. Lengths are for its 112 px ball; the ones written against `size` scale with it.
const REF = {
  size: 112,
  height: 298,
  step: 260,
  groundY: 700,
  contact: 4.5 * REF_F,
  squash: 3.4,
  stretchPerSpeed: 1 / 6420,
};
/** How sharply a landing squashes and recovers: 1 − |u|^1.7 over the contact, u −1 at touch to 1 at lift-off. */
const HUMP = 1.7;
/** The shortest crouch a launch waits for by default: two frames at 30 fps. */
const CROUCH_MIN = 4 * REF_F;
// The line rings at 6.9 Hz losing 45% a half-cycle (ζ 0.19); its first swing up is 0.6 of the dent it rebounds from.
const RING_WD = TAU * 6.9;
const RING_DECAY = (0.19 * RING_WD) / Math.sqrt(1 - 0.19 ** 2);
const RING_GAIN = 0.6;

/** Leaving the ground the stretch overshoots its law (1.6 against 1.4), dips under, and settles within 0.13 s. */
const liftSpring = (τ: number) => 1 - Math.exp(-τ / 0.008) + 0.7 * Math.exp(-τ / 0.05) * Math.sin((TAU * τ) / 0.13);
const hump = (u: number) => 1 - Math.abs(u) ** HUMP;
/** The impact marks' ease-out, fitted to the reference ring's per-frame steps (5, 3, 4, 3, 3, 3, 2, 2, 2, 2, 1 px). */
export const markEase = powerOutEase(1.5);

// ---------- the ball ----------

/** When the ball lands: the beats (`beats`), or a steady run of `count` from `first`, `spb` apart. */
export type BounceTiming =
  | {
    /** Seconds on the piece's clock of each landing's biggest squash. Put them on frames, or that pose never renders. */
    beats: readonly number[];
    /** Seconds per beat, for gravity and the loop past the beats. Default: the beats' median spacing. */
    spb?: number;
  }
  | { first: number; spb: number; count: number };

/** The last landing as a launch pad: the ball crouches, leaves, and swells until its colour fills the frame. */
export type BallLaunch = {
  /** When the colour covers the frame. Default: a frame before the beat after the last landing, so the next shot starts on it. */
  fill?: number;
  /** When it leaves the ground, with anticipation. Default `fill` − 0.283 s (the reference's swell). */
  at?: number;
  /** Where the swell heads as it grows. Default the frame's centre. */
  to?: { x: number; y: number };
  /**
   * The crouch before it: the landing's squash presses on until it leaves, to flatter than a landing (3.9:1) and deeper
   * into the line (0.14 × size); false leaves at once.
   */
  anticipation?: false | { squash?: number; dent?: number };
  /** How far the swell's path hops up on its way (0.77 × size), and its stretch along the launch (1.75:1). */
  lift?: number;
  stretch?: number;
};

export type BounceParams = BounceTiming & {
  /** The first landing's x. Default: the landings centred on the frame. */
  x?: number;
  /** Pixels from one landing to the next; negative bounces left. 260 (0.24 H). */
  step?: number;
  /** The ground line's y: 700 (0.65 H). */
  groundY?: number;
  /** The ball's diameter: 112 (0.104 H). */
  size?: number;
  /** Apex above the ball at rest, for a bounce a beat long: 298 (0.28 H). Gravity follows from it and the beat. */
  height?: number;
  /** px/s²: when given, each arc is as high as this gravity makes a bounce of its length, and `height` is unused. */
  gravity?: number;
  /** Seconds on the ground per landing: 0.075 (4.5 reference frames), centred on the beat. */
  contact?: number;
  /** Width over height at the biggest squash: 3.4. */
  squash?: number;
  /** Pixels the line gives under the biggest squash: 0.107 × size. */
  dent?: number;
  /** Aspect gained per px/s of speed, the stretch along the velocity: 1/6420. */
  stretchPerSpeed?: number;
  /** The fall in: from rest at centre y `from` (just above the frame), drifting `dx`; false enters on a full arc. */
  drop?: false | { from?: number; dx?: number };
  launch?: BallLaunch;
};

export type BallPhase = 'waiting' | 'drop' | 'air' | 'contact' | 'crouch' | 'swell' | 'field';

export type BallPose = {
  x: number;
  y: number;
  /** Full axes in px: `w` along `angle` (degrees, clockwise from +x), `h` across it. w × h stays size² until the swell. */
  w: number;
  h: number;
  angle: number;
  /** px/s. */
  vx: number;
  vy: number;
  phase: BallPhase;
  /**
   * The landing it's on or last left; −1 before the first with a drop. Without a drop the loop runs back before the
   * first beat (−1, −2…), and without a launch on past the last (n, n + 1…).
   */
  contact: number;
  /** Seconds since that landing's biggest squash: negative while still pressing into it. */
  since: number;
  /** Pixels the ground gives under it now. */
  dent: number;
  /** 0 before the launch, then 0..1 to a covered frame. */
  swell: number;
};

export type BounceModel = {
  ts: readonly number[];
  n: number;
  x: number;
  step: number;
  groundY: number;
  r: number;
  half: number;
  g: number;
  k: number;
  squash: Strain;
  dent: number;
  spb: number;
  before: number;
  after: number;
  drop: { start: number; x: number; y: number; dx: number; T: number } | null;
  launch: { at: number; fill: number; to: { x: number; y: number }; crouch: { squash: Strain; dent: number } | null; lift: number; stretch: number } | null;
};

export function bounceModel(p: BounceParams): BounceModel {
  const ts = 'beats' in p ? [...p.beats] : Array.from({ length: p.count }, (_, i) => p.first + i * p.spb);
  if (!ts.length) throw new RangeError('bouncingBallAt: give at least one beat');
  const n = ts.length, size = p.size ?? REF.size, r = size / 2, half = (p.contact ?? REF.contact) / 2;
  const gaps = ts.slice(1).map((t, i) => t - ts[i]);
  gaps.forEach((gap, i) => {
    if (!(gap > 2 * half)) throw new RangeError(`bouncingBallAt: beats ${i} and ${i + 1} are ${gap.toFixed(3)} s apart, no longer than a landing (${(2 * half).toFixed(3)} s)`);
  });
  const spb = p.spb ?? (gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0.5);
  const g = p.gravity ?? (8 * (p.height ?? REF.height)) / (spb - 2 * half) ** 2;
  const step = p.step ?? REF.step, groundY = p.groundY ?? REF.groundY, k = p.stretchPerSpeed ?? REF.stretchPerSpeed;
  const x = p.x ?? W / 2 - ((n - 1) * step) / 2;

  let drop: BounceModel['drop'] = null;
  if (p.drop !== false) {
    const from = p.drop?.from ?? -0.69 * size, dx = p.drop?.dx ?? 1.25 * size * Math.sign(step || 1);
    if (!(from < groundY - size)) throw new RangeError(`bouncingBallAt: the drop starts at y ${from}, not above the ground`);
    // Falls until its stretched bottom meets the line: the stretch comes from the speed there, found in two steps.
    const T0 = Math.sqrt((2 * (groundY - r - from)) / g);
    const T = Math.sqrt((2 * (groundY - halfHeight(r, lawStrain(dx / T0, g * T0, k)) - from)) / g);
    drop = { start: ts[0] - half - T, x: x - dx, y: from, dx, T };
  }

  let launch: BounceModel['launch'] = null;
  if (p.launch) {
    const L = p.launch, pad = ts[n - 1];
    const fill = L.fill ?? pad + spb - 1 / FPS;
    const crouch = L.anticipation === false ? null : { squash: strainOf(L.anticipation?.squash ?? 3.9, 0), dent: L.anticipation?.dent ?? 0.139 * size };
    const at = crouch ? (L.at ?? Math.max(pad + CROUCH_MIN, fill - SWELL_TIME)) : pad + half;
    if (crouch && !(at > pad)) throw new RangeError(`bouncingBallAt: the launch leaves the ground at ${at.toFixed(3)} s, not after the last landing's squash at ${pad.toFixed(3)} s`);
    if (!(fill > at)) throw new RangeError(`bouncingBallAt: the launch fills the frame at ${fill.toFixed(3)} s, before it leaves the ground at ${at.toFixed(3)} s`);
    launch = { at, fill, to: L.to ?? { x: W / 2, y: H / 2 }, crouch, lift: L.lift ?? 0.77 * size, stretch: L.stretch ?? 1.75 };
  }

  return {
    ts, n, x, step, groundY, r, half, g, k, spb, drop, launch,
    squash: strainOf(p.squash ?? REF.squash, 0),
    dent: p.dent ?? (12 / REF.size) * size,
    before: gaps[0] ?? spb,
    after: gaps[gaps.length - 1] ?? spb,
  };
}

export const contactTime = (m: BounceModel, i: number) =>
  i < 0 ? m.ts[0] + i * m.before : i >= m.n ? m.ts[m.n - 1] + (i - m.n + 1) * m.after : m.ts[i];
export const contactX = (m: BounceModel, i: number) => m.x + i * m.step;

/** The last landing touched by `t`: −1 before the first with a drop; the loop's own numbers past either end. */
function lastTouched(m: BounceModel, t: number): number {
  const touch = (i: number) => contactTime(m, i) - m.half;
  if (t < touch(0)) return m.drop ? -1 : Math.floor((t - touch(0)) / m.before);
  let i = 0;
  while (i + 1 < m.n && touch(i + 1) <= t) i++;
  if (i === m.n - 1 && !m.launch && t >= touch(m.n)) i = m.n - 1 + Math.floor((t - touch(m.n - 1)) / m.after);
  return i;
}

/**
 * The flight into landing `j`: from lift-off, round, at rest height, to touching down stretched, when the stretched
 * ball's bottom meets the line. So a landing starts with no dent and ends round at rest height, with no jump.
 */
function arcInto(m: BounceModel, j: number) {
  const lift = contactTime(m, j - 1) + m.half, T = contactTime(m, j) - m.half - lift;
  const x0 = contactX(m, j - 1), x1 = contactX(m, j), vx = (x1 - x0) / T;
  const y0 = m.groundY - m.r, y1 = m.groundY - halfHeight(m.r, lawStrain(vx, (m.g * T) / 2, m.k));
  return { lift, T, x0, y0, vx, vy0: (y1 - y0) / T - (m.g * T) / 2 };
}

function arrivalStrain(m: BounceModel, j: number): Strain {
  if (j === 0 && m.drop) return lawStrain(m.drop.dx / m.drop.T, m.g * m.drop.T, m.k);
  const a = arcInto(m, j);
  return lawStrain(a.vx, a.vy0 + m.g * a.T, m.k);
}

export type RawPose = { x: number; y: number; s: Strain; r: number; phase: BallPhase; contact: number; since: number; dent: number; swell: number };

function contactPose(m: BounceModel, i: number, u: number): RawPose {
  const h = hump(u), s = mixStrain(u < 0 ? arrivalStrain(m, i) : ROUND, m.squash, h), dent = m.dent * h;
  // Its bottom rides the dent; x holds still through the landing (no skid).
  return { x: contactX(m, i), y: m.groundY + dent - halfHeight(m.r, s), s, r: m.r, phase: 'contact', contact: i, since: u * m.half, dent, swell: 0 };
}

/** How far the pad's crouch has pressed `since` its landing's biggest squash: 0 there, 1 as it leaves the ground. */
const crouchLoad = (m: BounceModel, since: number) => clamp(since / (m.launch!.at - contactTime(m, m.n - 1)));

/**
 * The pad's crouch: its landing's squash presses on at a steady rate, flatter and deeper, until it leaves; eased into
 * its pose, it would read as a hold. The reference first rebounds for a 60 fps frame (1.45:1): at 30 fps that fills a
 * frame and reads as a second bounce, so the crouch doesn't.
 */
function crouchPose(m: BounceModel, since: number): RawPose {
  const c = m.launch!.crouch!, pad = m.n - 1, k = crouchLoad(m, since);
  const s = mixStrain(m.squash, c.squash, k), dent = lerp(m.dent, c.dent, k);
  return { x: contactX(m, pad), y: m.groundY + dent - halfHeight(m.r, s), s, r: m.r, phase: 'crouch', contact: pad, since, dent, swell: 0 };
}

/** The swell the launch hands over to: from the ball's pose as it leaves, over the launch's own span. */
export function launchSwell(m: BounceModel) {
  const L = m.launch!, pad = m.n - 1;
  const from = L.crouch ? crouchPose(m, L.at - contactTime(m, pad)) : contactPose(m, pad, 1);
  const shape = shapeOfStrain(from.s);
  return {
    at: L.at,
    options: { from: { x: from.x, y: from.y, r: m.r, aspect: shape.aspect, angle: shape.angle * DEG }, to: L.to, lift: L.lift, stretch: L.stretch, duration: L.fill - L.at },
  };
}

export function rawPoseAt(m: BounceModel, t: number): RawPose {
  const L = m.launch, pad = m.n - 1;
  if (L && t >= L.at) {
    const { at, options } = launchSwell(m), k = (t - at) / options.duration, sw = fieldSwellAt(k, options);
    return { x: sw.x, y: sw.y, s: strainOf(sw.aspect, sw.angle / DEG), r: sw.r, phase: k >= 1 ? 'field' : 'swell', contact: pad, since: t - contactTime(m, pad), dent: 0, swell: clamp(k) };
  }
  if (m.drop && t < contactTime(m, 0) - m.half) {
    const { start, x, y, dx, T } = m.drop, τ = Math.max(0, t - start);
    return { x: x + (dx * τ) / T, y: y + 0.5 * m.g * τ * τ, s: lawStrain(dx / T, m.g * τ, m.k), r: m.r, phase: t < start ? 'waiting' : 'drop', contact: -1, since: t - m.ts[0], dent: 0, swell: 0 };
  }
  const i = lastTouched(m, t), since = t - contactTime(m, i);
  if (L?.crouch && i === pad && since > 0) return crouchPose(m, since);
  if (since <= m.half) return contactPose(m, i, since / m.half);
  const a = arcInto(m, i + 1), τ = t - a.lift;
  return {
    x: a.x0 + a.vx * τ, y: a.y0 + a.vy0 * τ + 0.5 * m.g * τ * τ,
    s: scaleStrain(lawStrain(a.vx, a.vy0 + m.g * τ, m.k), liftSpring(τ)),
    r: m.r, phase: 'air', contact: i, since, dent: 0, swell: 0,
  };
}

/**
 * The ball at `t` seconds (the piece's clock): centre, squash and stretch, and its contact with the ground, in closed
 * form from the beats, so any frame, a ghost, a match cut or a camera can ask for any moment. Each landing's biggest
 * squash (3.4:1) falls exactly on its beat; the flight between is a parabola under one gravity.
 */
export function bouncingBallAt(t: number, params: BounceParams): BallPose {
  const m = bounceModel(params), p = rawPoseAt(m, t), dt = 1e-3;
  const before = rawPoseAt(m, t - dt), after = rawPoseAt(m, t + dt);
  const { aspect, angle } = shapeOfStrain(p.s), sq = Math.sqrt(aspect);
  return {
    x: p.x, y: p.y, w: 2 * p.r * sq, h: (2 * p.r) / sq, angle: angle * DEG,
    vx: (after.x - before.x) / (2 * dt), vy: (after.y - before.y) / (2 * dt),
    phase: p.phase, contact: p.contact, since: p.since, dent: p.dent, swell: p.swell,
  };
}

// ---------- the elastic ground ----------

/** Pixels landing `i` presses the line down at its x (negative: ringing up), at `t`. */
function landingDent(m: BounceModel, i: number, t: number): number {
  const ti = contactTime(m, i), u = (t - ti) / m.half, L = m.launch;
  if (u < -1) return 0;
  if (L?.crouch && i === m.n - 1 && u > 0) {
    if (t < L.at) return lerp(m.dent, L.crouch.dent, crouchLoad(m, t - ti));
    // Let go from the crouch's deepest press: the string springs up through level and rings down.
    const τ = t - L.at;
    return L.crouch.dent * Math.exp(-RING_DECAY * τ) * (Math.cos(RING_WD * τ) + (RING_DECAY / RING_WD) * Math.sin(RING_WD * τ));
  }
  if (u <= 1) return m.dent * hump(u);
  const τ = t - ti - m.half;
  return -RING_GAIN * m.dent * Math.exp(-RING_DECAY * τ) * Math.sin(RING_WD * τ);
}

/** Every landing still moving the line at `t`, each a standing Gaussian dent at its x. */
export function groundDents(m: BounceModel, t: number) {
  // A ring is under a tenth of a pixel after 0.8 s.
  const last = m.launch ? Math.min(lastTouched(m, t), m.n - 1) : lastTouched(m, t);
  const dents: { x: number; depth: number }[] = [];
  for (let i = lastTouched(m, t - 0.8); i <= last; i++) {
    if (i < 0 && m.drop) continue;
    const depth = landingDent(m, i, t);
    if (Math.abs(depth) > 0.05) dents.push({ x: contactX(m, i), depth });
  }
  return dents;
}

// ---------- what the drawing lays out ----------

const SCRAMBLE_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789*#&%+/<>[]{}=?';

/**
 * `text` typing on as the reference's HUD decodes: its first place shows a random glyph from `since` 0, the rest type
 * on from `hold` at `rate` characters a second, each re-rolling every frame until it settles `lag` after it appeared.
 * Characters not yet shown are spaces, so the line never shifts. type.ts's scrambleAt scrambles every character from
 * the start.
 */
export function typeOnScramble(text: string, since: number, seed: string, { rate = 90, hold = 4 * REF_F, lag = 4 * REF_F } = {}): string {
  const count = (s: number) => (s < 0 ? 0 : s < hold ? 1 : 2 + Math.floor((s - hold) * rate));
  const shown = count(since), settled = count(since - lag), frame = Math.floor(since * FPS);
  return [...text].map((ch, i) => {
    if (i >= shown) return ' ';
    if (i < settled || ch === ' ') return ch;
    return SCRAMBLE_GLYPHS[Math.floor(hashRandom(seed, i, frame) * SCRAMBLE_GLYPHS.length)];
  }).join('');
}

/** The ball as an SVG ellipse: `shape`'s squash and stretch, centred where `at` is. */
export function ballEllipse(shape: RawPose, at: { x: number; y: number } = shape) {
  const { aspect, angle } = shapeOfStrain(shape.s), sq = Math.sqrt(aspect);
  return { cx: at.x, cy: at.y, rx: shape.r * sq, ry: shape.r / sq, transform: `rotate(${angle * DEG} ${at.x} ${at.y})` };
}

/**
 * Where to draw the frame's ball while its shutter is open around `t`, at most 2.5 px apart. Only the position blurs: a
 * landing's squash changes within a shutter, and blurring it smears the squash into a bell. Each sample is placed by
 * the ball's lowest point then, as a landing's centre sinks only because the ball flattens.
 */
export function shutterCentres(m: BounceModel, t: number, exposure: number): { x: number; y: number }[] {
  const frame = rawPoseAt(m, t), below = halfHeight(frame.r, frame.s);
  if (exposure <= 0) return [frame];
  return smearSamples((k) => {
    const p = rawPoseAt(m, t + exposure * (k - 0.5));
    return { x: p.x, y: p.y + halfHeight(p.r, p.s) - below };
  }, 2.5, 31);
}

/** The dotted path: the drop, then each flight as the parabola between rest heights, V-ing at every landing. */
export function guidePath(m: BounceModel) {
  const rest = m.groundY - m.r, pts: string[] = [];
  const add = (x: number, y: number) => { if (y > -8) pts.push(`${pts.length ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`); };
  if (m.drop) for (let j = 0; j <= 40; j++) { const s = j / 40; add(m.drop.x + m.drop.dx * s, m.drop.y + (rest - m.drop.y) * s * s); }
  for (let i = m.drop ? 0 : -1; i < m.n - 1; i++) {
    const T = contactTime(m, i + 1) - contactTime(m, i) - 2 * m.half, apex = (m.g * T * T) / 8;
    for (let j = m.drop || i >= 0 ? 1 : 0; j <= 48; j++) { const s = j / 48; add(lerp(contactX(m, i), contactX(m, i + 1), s), rest - 4 * apex * s * (1 - s)); }
  }
  return pts.join('');
}

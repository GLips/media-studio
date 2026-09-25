// bounce.tsx: the bouncing ball that opens the reference reel. One pure function of time (`bouncingBallAt`) gives the
// ball's centre, its squash and stretch and its contact with the ground, and everything drawn reads it: the ball, its
// dotted path, onion-skin ghosts, impact marks, the elastic ground line and the callouts, so the path shown is the
// path flown. It lands once per beat on exact parabolas and never loses height (a musical loop, not decaying
// physics). Its last landing can crouch and launch into `FieldSwell`, growing until its colour is the next shot's
// ground.

import { MONO_FONT } from '#models/type/faces.ts';
import { FPS, H, W } from '#models/frame/frame.ts';
import { clamp, lerp, motionCurves, powerOutEase } from '#models/motion/motion.ts';
import { pieceMotionAttrs } from '../motion-tag.ts';
import { hashRandom } from '#models/motion/random.ts';

// ---------- the reference's measures ----------

/** One frame of the reference reel (60 fps): the unit its timings were measured in. */
const REF_F = 1 / 60;
const TAU = 2 * Math.PI;
const DEG = 180 / Math.PI;

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
// Launch to a covered frame: 17 reference frames, from the last one crouched.
const SWELL_TIME = 17 * REF_F;
/** The swell's default shutter: the reference's edge. */
const SWELL_SHUTTER = 0.3;
/** The swell's move to `to` over progress `u`: it sits 0.64 of a reference frame, then eases out (power 2.5) over 11.36. */
const swellMove = (u: number) => powerOutEase(2.5)((u - 0.64 / 17) / (11.36 / 17));
/** Its growth, as a share of ln(final radius / start radius); fitted to the reference's scale on every frame. */
const swellGrowth = (u: number) => 0.5 * u * (1 + u);

// ---------- shape ----------

/**
 * A squash or stretch as one vector: ln(aspect) turned to twice the major axis's angle. Shapes blend by mixing these,
 * so a tall stretch passes through round into a flat squash rather than spinning, and every blend keeps the area.
 */
type Strain = { x: number; y: number };
const ROUND: Strain = { x: 0, y: 0 };
const strainOf = (aspect: number, angle: number): Strain => {
  const l = Math.log(aspect);
  return { x: l * Math.cos(2 * angle), y: l * Math.sin(2 * angle) };
};
const mixStrain = (a: Strain, b: Strain, k: number): Strain => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const scaleStrain = (a: Strain, k: number): Strain => ({ x: a.x * k, y: a.y * k });
function shapeOfStrain(s: Strain) {
  const l = Math.hypot(s.x, s.y);
  return { aspect: Math.exp(l), angle: l > 1e-9 ? Math.atan2(s.y, s.x) / 2 : 0 };
}
/** How far below its centre a ball of radius `r` reaches under strain `s`. */
function halfHeight(r: number, s: Strain) {
  const { aspect, angle } = shapeOfStrain(s), sin = Math.sin(angle), cos = Math.cos(angle);
  return r * Math.sqrt(aspect * sin * sin + (cos * cos) / aspect);
}
/** The reference's law: stretched along its velocity by 1 + speed × `k` (1 + v/107 in px per 60 fps frame). */
const lawStrain = (vx: number, vy: number, k: number) => strainOf(1 + k * Math.hypot(vx, vy), Math.atan2(vy, vx));
/** Leaving the ground the stretch overshoots its law (1.6 against 1.4), dips under, and settles within 0.13 s. */
const liftSpring = (τ: number) => 1 - Math.exp(-τ / 0.008) + 0.7 * Math.exp(-τ / 0.05) * Math.sin((TAU * τ) / 0.13);
const hump = (u: number) => 1 - Math.abs(u) ** HUMP;
/** The impact marks' ease-out, fitted to the reference ring's per-frame steps (5, 3, 4, 3, 3, 3, 2, 2, 2, 2, 1 px). */
const markEase = powerOutEase(1.5);
const smoothstep = motionCurves.dissolve;

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

type BounceModel = {
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

function bounceModel(p: BounceParams): BounceModel {
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

const contactTime = (m: BounceModel, i: number) =>
  i < 0 ? m.ts[0] + i * m.before : i >= m.n ? m.ts[m.n - 1] + (i - m.n + 1) * m.after : m.ts[i];
const contactX = (m: BounceModel, i: number) => m.x + i * m.step;

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

type RawPose = { x: number; y: number; s: Strain; r: number; phase: BallPhase; contact: number; since: number; dent: number; swell: number };

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
function launchSwell(m: BounceModel) {
  const L = m.launch!, pad = m.n - 1;
  const from = L.crouch ? crouchPose(m, L.at - contactTime(m, pad)) : contactPose(m, pad, 1);
  const shape = shapeOfStrain(from.s);
  return {
    at: L.at,
    options: { from: { x: from.x, y: from.y, r: m.r, aspect: shape.aspect, angle: shape.angle * DEG }, to: L.to, lift: L.lift, stretch: L.stretch, duration: L.fill - L.at },
  };
}

function rawPoseAt(m: BounceModel, t: number): RawPose {
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
function groundDents(m: BounceModel, t: number) {
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

// ---------- the swell ----------

/** The circle a swell grows from. `aspect` and `angle` (degrees) when it starts squashed, as a ball leaving a crouch does. */
export type SwellFrom = { x: number; y: number; r: number; aspect?: number; angle?: number };

export type FieldSwellOptions = {
  from: SwellFrom;
  /** Where it heads as it grows: the frame's centre by default. */
  to?: { x: number; y: number };
  /** Pixels its path hops up on the way (0 for a straight line). */
  lift?: number;
  /** Peak width over height along its direction of travel early on, relaxing to round: 1.75. 1 for none. */
  stretch?: number;
  /** Seconds from start to a covered frame, for the blur: 0.283 (17 reference frames). */
  duration?: number;
  /**
   * Shutter as a share of a frame: the edge ramps across as far as it grows while the shutter is open. 0.3 gives the
   * reference's edge (10–90% over 0.085 r at full speed); 0.5, film's 180° at 30 fps, reads softer.
   */
  shutter?: number;
};

export type SwellPose = {
  x: number;
  y: number;
  /** Radius of the circle of the same area. */
  r: number;
  aspect: number;
  /** Degrees, the long axis. */
  angle: number;
  /** Pixels across the edge's ramp, from the growth's motion blur. */
  soft: number;
  /** The colour covers the whole frame. */
  covered: boolean;
};

/** Pixels from (x, y) to the frame's farthest corner. */
const farthestCorner = (x: number, y: number) => Math.hypot(Math.max(x, W - x), Math.max(y, H - y));

/**
 * The swell at progress `k` (0 start, 1 covered): a circle hopping to `to` on an ease-out while its radius grows
 * exponentially, ever faster (the reference's ×1.25 per 60 fps frame at the end), so the edge whips past the corners.
 * ln r runs 0.5k + 0.5k² of the way to 1.15× the reach to the farthest corner.
 */
export function fieldSwellAt(k: number, { from, to = { x: W / 2, y: H / 2 }, lift = 0, stretch = 1.75, duration = SWELL_TIME, shutter = SWELL_SHUTTER }: FieldSwellOptions): SwellPose {
  const u = clamp(k), grow = Math.log((1.15 * farthestCorner(to.x, to.y) + 2) / from.r);
  const r = from.r * Math.exp(grow * swellGrowth(u));
  const e = swellMove(u);
  const x = lerp(from.x, to.x, e), y = lerp(from.y, to.y, e) - lift * 4 * e * (1 - e);
  // The stretch lies along the launch (toward where the hop peaks), strongest for a circle that travels far for its size.
  const dx = 0.7 * (to.x - from.x), dy = 0.7 * (to.y - from.y) - 0.84 * lift;
  const reach = clamp(Math.hypot(dx, dy) / (4 * from.r));
  const along = scaleStrain(strainOf(stretch, Math.atan2(dy, dx)), reach * smoothstep(u / 0.16) * (1 - smoothstep((u - 0.3) / 0.32)));
  // A squashed start (a crouch) springs round within the swell's first frame.
  const start = scaleStrain(strainOf(from.aspect ?? 1, (from.angle ?? 0) / DEG), 1 - smoothstep(u / 0.07));
  const { aspect, angle } = shapeOfStrain({ x: along.x + start.x, y: along.y + start.y });
  const soft = Math.max(1, (r * grow * (0.5 + u) * shutter) / (duration * FPS));
  const covered = k >= 1 || r / Math.sqrt(aspect) - soft / 2 >= farthestCorner(x, y);
  return { x, y, r, aspect, angle: angle * DEG, soft, covered };
}

/** Where the swell's centre passes while the shutter is open around `k`, `k`'s own in the middle. */
function swellCentres(k: number, opts: FieldSwellOptions & { duration: number }): { x: number; y: number }[] {
  const span = (opts.shutter ?? SWELL_SHUTTER) / FPS / opts.duration;
  return smearSamples((j) => fieldSwellAt(k + span * (j - 0.5), opts), 3, 15);
}

/**
 * A circle's colour growing over the frame. Its edge ramps as wide as the growth's smear and its centre is smeared
 * along its path (summed like the ball), which keeps a 5-frame zoom from strobing at 30 fps.
 */
function SwellDisc({ pose, centres = [pose], color, tag }: { pose: SwellPose; centres?: readonly { x: number; y: number }[]; color: string; tag: Record<string, string> }) {
  if (pose.covered) return <div {...tag} style={{ position: 'absolute', inset: 0, background: color }} />;
  const outer = pose.r + pose.soft / 2, sq = Math.sqrt(pose.aspect);
  // A smoothstep ramp across the edge: a plain linear one shows Mach bands on a flat field.
  const stops = [0, 0.25, 0.5, 0.75, 1].map((j) => {
    const alpha = Math.round(100 * (1 - smoothstep(j)));
    return `color-mix(in srgb, ${color} ${alpha}%, transparent) ${(((pose.r - pose.soft / 2 + pose.soft * j) / outer) * 100).toFixed(3)}%`;
  });
  const background = `radial-gradient(closest-side, ${stops.join(', ')})`;
  const at = centres[(centres.length - 1) / 2], cos = Math.cos(pose.angle / DEG), sin = Math.sin(pose.angle / DEG);
  // The tag stays on the frame's own disc; the smear's copies sit inside it, offset in its rotated, squashed frame.
  return (
    <div {...tag} style={{
      position: 'absolute', left: at.x - outer, top: at.y - outer, width: 2 * outer, height: 2 * outer,
      transform: `rotate(${pose.angle}deg) scale(${sq}, ${1 / sq})`, isolation: 'isolate',
      background: centres.length === 1 ? background : undefined,
    }}>
      {centres.length > 1 && centres.map((c, j) => {
        const dx = c.x - at.x, dy = c.y - at.y;
        return (
          <div key={j} style={{
            position: 'absolute', left: (cos * dx + sin * dy) / sq, top: (cos * dy - sin * dx) * sq, width: '100%', height: '100%',
            background, opacity: 1 / centres.length, mixBlendMode: 'plus-lighter',
          }} />
        );
      })}
    </div>
  );
}

/**
 * A circle (a ball, a swatch, an i's tittle) growing until its colour fills the frame, moving toward `to` as it grows:
 * a zoom-through that matches on colour, so the next shot starts on that ground. Give `k` (0..1), or `t` seconds over
 * `duration`. Nothing draws before it starts; draw the circle yourself until then.
 */
export function FieldSwell({ color, motion, from, to, lift, stretch, shutter, ...clock }: Omit<FieldSwellOptions, 'duration'> & {
  color: string;
  /** Its name in the motion tracks, `swell` by default; the track reports `k`. */
  motion?: string | false;
} & ({ k: number; duration?: number; t?: never } | { t: number; duration?: number; k?: never })) {
  const duration = clock.duration ?? SWELL_TIME, k = clock.k ?? clock.t! / duration;
  if (k < 0) return null;
  const opts = { from, to, lift, stretch, shutter, duration };
  const tag = pieceMotionAttrs(motion, 'swell', { kind: 'field-swell', values: { k: clamp(k) } });
  return <SwellDisc pose={fieldSwellAt(k, opts)} centres={swellCentres(k, opts)} color={color} tag={tag} />;
}

// ---------- the drawing ----------

/** A callout naming the craft a landing shows, read off a leader line from the contact. */
export type BounceCallout = {
  /** The landing it names: 0 for the first. */
  contact: number;
  label: string;
  /** The figure over the label: "01" for the first landing's by default. */
  number?: string;
  /** The side it reads to. */
  side?: 'right' | 'left';
};

const SCRAMBLE_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789*#&%+/<>[]{}=?';

/**
 * `text` typing on as the reference's HUD decodes: its first place shows a random glyph from `since` 0, the rest type
 * on from `hold` at `rate` characters a second, each re-rolling every frame until it settles `lag` after it appeared.
 * Characters not yet shown are spaces, so the line never shifts. type.tsx's scrambleAt scrambles every character from
 * the start.
 */
function typeOnScramble(text: string, since: number, seed: string, { rate = 90, hold = 4 * REF_F, lag = 4 * REF_F } = {}): string {
  const count = (s: number) => (s < 0 ? 0 : s < hold ? 1 : 2 + Math.floor((s - hold) * rate));
  const shown = count(since), settled = count(since - lag), frame = Math.floor(since * FPS);
  return [...text].map((ch, i) => {
    if (i >= shown) return ' ';
    if (i < settled || ch === ' ') return ch;
    return SCRAMBLE_GLYPHS[Math.floor(hashRandom(seed, i, frame) * SCRAMBLE_GLYPHS.length)];
  }).join('');
}

/** The ball as an SVG ellipse: `shape`'s squash and stretch, centred where `at` is. */
function ballEllipse(shape: RawPose, at: { x: number; y: number } = shape) {
  const { aspect, angle } = shapeOfStrain(shape.s), sq = Math.sqrt(aspect);
  return { cx: at.x, cy: at.y, rx: shape.r * sq, ry: shape.r / sq, transform: `rotate(${angle * DEG} ${at.x} ${at.y})` };
}

/**
 * Where to draw the frame's ball while its shutter is open around `t`, at most 2.5 px apart. Only the position blurs: a
 * landing's squash changes within a shutter, and blurring it smears the squash into a bell. Each sample is placed by
 * the ball's lowest point then, as a landing's centre sinks only because the ball flattens.
 */
function shutterCentres(m: BounceModel, t: number, exposure: number): { x: number; y: number }[] {
  const frame = rawPoseAt(m, t), below = halfHeight(frame.r, frame.s);
  if (exposure <= 0) return [frame];
  return smearSamples((k) => {
    const p = rawPoseAt(m, t + exposure * (k - 0.5));
    return { x: p.x, y: p.y + halfHeight(p.r, p.s) - below };
  }, 2.5, 31);
}

/**
 * `at` sampled evenly over 0..1, densely enough that its fastest stretch steps at most `gap` px (a landing stops the
 * ball partway through a shutter), up to `most`. An odd count, so the middle sample is `at(0.5)`, the frame's own.
 */
function smearSamples<P extends { x: number; y: number }>(at: (k: number) => P, gap: number, most: number): P[] {
  const probe = Array.from({ length: 9 }, (_, j) => at(j / 8));
  const fastest = 8 * Math.max(...probe.slice(1).map((p, j) => Math.hypot(p.x - probe[j].x, p.y - probe[j].y)));
  const count = Math.min(most, Math.ceil(fastest / gap) + 1) | 1;
  return count < 3 ? [probe[4]] : Array.from({ length: count }, (_, j) => at(j / (count - 1)));
}

/** The dotted path: the drop, then each flight as the parabola between rest heights, V-ing at every landing. */
function guidePath(m: BounceModel) {
  const rest = m.groundY - m.r, pts: string[] = [];
  const add = (x: number, y: number) => { if (y > -8) pts.push(`${pts.length ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`); };
  if (m.drop) for (let j = 0; j <= 40; j++) { const s = j / 40; add(m.drop.x + m.drop.dx * s, m.drop.y + (rest - m.drop.y) * s * s); }
  for (let i = m.drop ? 0 : -1; i < m.n - 1; i++) {
    const T = contactTime(m, i + 1) - contactTime(m, i) - 2 * m.half, apex = (m.g * T * T) / 8;
    for (let j = m.drop || i >= 0 ? 1 : 0; j <= 48; j++) { const s = j / 48; add(lerp(contactX(m, i), contactX(m, i + 1), s), rest - 4 * apex * s * (1 - s)); }
  }
  return pts.join('');
}

/**
 * The reference reel's bouncing ball, drawn whole: the ball, motion-blurred; its dotted path; three onion-skin ghosts;
 * a diamond, sparks and ground ring at each landing; the elastic ground line with its ruler; and `callouts`. With
 * `launch`, it swells into a full field of `color` (see `FieldSwell`). Defaults are the reference's: #ef4c22 on
 * #0c0c0e, cream lines.
 */
export function BounceBall(props: BounceParams & {
  /** Seconds on the piece's clock. */
  t: number;
  color?: string;
  /** The ground behind it; null draws none, to lay the ball over another shot. */
  background?: string | null;
  /** Lines, marks and labels. */
  ink?: string;
  /** The callouts' figures: the ball's colour by default. */
  accent?: string;
  callouts?: readonly BounceCallout[];
  /** The ground line's ends. Default: centred on the frame, 1200 px or enough to hold the landings. */
  line?: { from: number; to: number };
  /** When the line starts drawing from its centre out: a beat before the first landing by default. */
  inAt?: number;
  guide?: boolean;
  /** Onion-skin ghosts, one a frame back each (the reference's 1/30 s): 3. 0 for none. */
  ghosts?: number;
  /** The diamond, sparks and ground ring at each landing. */
  marks?: boolean;
  /** The ball's shutter as a share of a frame: 0.5 is film's 180°. 0 draws it sharp. The swell's edge is its own. */
  shutter?: number;
  /** Seeds the callouts' decoding glyphs. */
  seed?: string | number;
  /** The ball's name in the motion tracks, `ball` by default; it reports the landing it's on and its aspect. */
  motion?: string | false;
}) {
  const { t, color = '#ef4c22', background = '#0c0c0e', ink = '#f3f0e7', callouts = [], guide = true, ghosts = 3, marks = true, shutter = 0.5, seed = 'bounce', motion } = props;
  const accent = props.accent ?? color;
  const m = bounceModel(props), D = 2 * m.r, pose = rawPoseAt(m, t), L = m.launch;
  // One track from drop to field: the landing it's on, its width over height, and the swell's progress.
  const ballTag = (aspect: number, swell: number) =>
    pieceMotionAttrs(motion, 'ball', { kind: 'bounce', values: { contact: pose.contact, aspect: Number(aspect.toFixed(3)), swell } });

  if (pose.phase === 'field') return <SwellDisc pose={fieldSwellAt(1, launchSwell(m).options)} color={color} tag={ballTag(1, 1)} />;

  // Everything but the ground line fades as the ball launches.
  const chrome = L ? 1 - clamp((t - L.at - 2 * REF_F) / (6 * REF_F)) : 1;
  const inAt = props.inAt ?? m.ts[0] - m.spb;
  const guideAt = m.drop ? m.drop.start : inAt + 0.1;
  // The marks' and callouts' clock, a hair ahead: a beat and a frame are the same instant reached by different float
  // sums, and a mark that starts on a frame mustn't miss it by 1e-17 s.
  const tm = t + 1e-6;
  const shown = (i: number) => i >= 0 && i < m.n && tm >= contactTime(m, i);

  // The ground line and its ruler, on a 40 px lattice centred on the frame.
  const reach = Math.max(600, Math.ceil((Math.max(...m.ts.map((_, i) => Math.abs(contactX(m, i) - W / 2))) + 280) / 40) * 40);
  const span = props.line ?? { from: W / 2 - reach, to: W / 2 + reach };
  const mid = (span.from + span.to) / 2, drawn = ((span.to - span.from) / 2) * motionCurves.expo.entrance((t - inAt) / 0.43);
  const dents = groundDents(m, t), sigma2 = 2 * (0.89 * D) ** 2;
  const lineY = (x: number) => m.groundY + dents.reduce((y, d) => y + d.depth * Math.exp(-((x - d.x) ** 2) / sigma2), 0);
  const lineXs: number[] = [];
  if (drawn > 0.5) { for (let x = mid - drawn; x < mid + drawn; x += 6) lineXs.push(x); lineXs.push(mid + drawn); }
  const ticks: { x: number; major: boolean }[] = [];
  for (let x = W / 2 + Math.ceil((mid - drawn - W / 2) / 40) * 40; x <= mid + drawn; x += 40) ticks.push({ x, major: Math.abs((x - W / 2) % 200) < 1e-6 });

  // The ball, its centre sampled across the shutter and summed (plus-lighter in an isolated group sums coverage exactly).
  const drawBall = pose.phase !== 'waiting' && pose.phase !== 'swell';
  const centres = drawBall ? shutterCentres(m, t, shutter / FPS) : [];

  const ghostPoses = Array.from({ length: ghosts }, (_, j) => {
    const at = t - (j + 1) / 30;
    if (m.drop && at < m.drop.start) return null;
    const g = rawPoseAt(m, at);
    // A ghost that has barely left the ball (the crouch pressing on) would only ring its edge.
    const apart = clamp((Math.hypot(g.x - pose.x, g.y - pose.y) + Math.abs(ballEllipse(g).rx - ballEllipse(pose).rx)) / 12);
    return { g, alpha: 0.15 * 0.75 ** j * apart * chrome };
  });

  const sideOf = (c: BounceCallout) => (c.side === 'left' ? -1 : 1);
  const calloutEnd = (i: number) => (L && i === m.n - 1 ? L.at + 7 * REF_F : contactTime(m, i + 1) - REF_F);
  const calloutState = (c: BounceCallout) => {
    const since = tm - contactTime(m, c.contact), end = calloutEnd(c.contact);
    // In from half a reference frame before the landing, out over the five before it ends.
    const alpha = clamp((since + 0.5 * REF_F) / (1.5 * REF_F)) * (1 - clamp((t - (end - 5 * REF_F)) / (5 * REF_F)));
    const s = sideOf(c), dot = { x: contactX(m, c.contact) + s * 16, y: m.groundY + 18 };
    const elbow = { x: dot.x + s * 39.6, y: dot.y + 39.6 }, tip = { x: elbow.x + s * 31, y: elbow.y };
    return { since, alpha, s, dot, elbow, tip };
  };
  const liveCallouts = callouts.filter((c) => shown(c.contact) && t < calloutEnd(c.contact));

  const swell = L ? launchSwell(m) : null;
  const swellK = swell ? (t - swell.at) / swell.options.duration : -1;
  const launched = swell && swellK >= 0 ? { k: swellK, pose: fieldSwellAt(swellK, swell.options), centres: swellCentres(swellK, swell.options) } : null;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {background && <div style={{ position: 'absolute', inset: 0, background }} />}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {ticks.map(({ x, major }) => (
          <line key={x} x1={x} x2={x} y1={m.groundY + 8} y2={m.groundY + (major ? 20 : 16)} stroke={ink} strokeWidth={1.5} opacity={0.24} />
        ))}
        {lineXs.length > 1 && (
          <path d={lineXs.map((x, j) => `${j ? 'L' : 'M'}${x.toFixed(1)} ${lineY(x).toFixed(2)}`).join('')} fill="none" stroke={ink} strokeWidth={2} strokeLinecap="round" opacity={0.86} />
        )}
        {guide && t >= guideAt && (
          <path d={guidePath(m)} fill="none" stroke={ink} strokeWidth={2} strokeLinecap="round" strokeDasharray="0 8" opacity={0.34 * clamp((t - guideAt) / (4 * REF_F)) * chrome} />
        )}
        {marks && m.ts.map((ti, i) => {
          if (!shown(i)) return null;
          const since = tm - ti, x = contactX(m, i), rest = m.groundY - m.r, hub = m.groundY - 0.1 * D;
          // The ring spreads over 11 reference frames from +2; the sparks fly out over 4 from +1, their backs catching up.
          const ring = (since - 2 * REF_F) / (11 * REF_F), spark = (since - REF_F) / (4 * REF_F);
          const a = D * (0.446 + 0.893 * markEase(ring));
          const rIn = D * (0.705 + 0.268 * markEase(spark)), rOut = D * (0.866 + 0.143 * markEase(spark));
          return (
            <g key={i}>
              {ring >= 0 && ring < 1 && <ellipse cx={x} cy={m.groundY} rx={a} ry={0.3 * a} fill="none" stroke={ink} strokeWidth={2} opacity={0.66 * (1 - ring)} />}
              <path d={`M${x} ${rest - 8}L${x + 8} ${rest}L${x} ${rest + 8}L${x - 8} ${rest}Z`} fill={ink} opacity={0.93 * chrome} />
              {spark >= 0 && spark < 1 && [-72, -36, 0, 36, 72].map((deg) => {
                const dx = Math.sin(deg / DEG), dy = -Math.cos(deg / DEG);
                return <line key={deg} x1={x + dx * rIn} y1={hub + dy * rIn} x2={x + dx * rOut} y2={hub + dy * rOut} stroke={ink} strokeWidth={2} strokeLinecap="round" opacity={0.85 * (1 - 0.8 * spark)} />;
              })}
            </g>
          );
        })}
        {ghostPoses.map((gp, j) => gp && gp.alpha > 0.005 && (
          <ellipse key={j} {...ballEllipse(gp.g)} fill="none" stroke={ink} strokeWidth={1.5} opacity={gp.alpha} />
        ))}
        {liveCallouts.map((c) => {
          const { since, alpha, dot, elbow, tip } = calloutState(c);
          // The diagonal draws in 3 reference frames, then the run across in 5.
          const drawn = 56 * clamp(since / (3 * REF_F)) + 31 * motionCurves.cubic.entrance((since - 3 * REF_F) / (5 * REF_F));
          return (
            <g key={c.contact} opacity={alpha}>
              <polyline points={`${dot.x},${dot.y} ${elbow.x},${elbow.y} ${tip.x},${tip.y}`} fill="none" stroke={ink} strokeWidth={1.2} opacity={0.66} strokeDasharray={`${drawn} 100`} />
              {since >= REF_F && <circle cx={dot.x} cy={dot.y} r={2.6} fill={ink} />}
            </g>
          );
        })}
        {drawBall && (
          <g {...ballTag(shapeOfStrain(pose.s).aspect, 0)} style={{ isolation: 'isolate' }}>
            {centres.map((at, j) => (
              <ellipse key={j} {...ballEllipse(pose, at)} fill={color} opacity={1 / centres.length} style={centres.length > 1 ? { mixBlendMode: 'plus-lighter' } : undefined} />
            ))}
          </g>
        )}
      </svg>
      {liveCallouts.map((c) => {
        const { since, alpha, s, tip } = calloutState(c), size = 15;
        const number = c.number ?? String(c.contact + 1).padStart(2, '0');
        const place = s > 0 ? { left: tip.x + 10 } : { right: W - (tip.x - 10) };
        const type = { position: 'absolute', ...place, font: `500 ${size}px/1 ${MONO_FONT}`, letterSpacing: '0.1em', whiteSpace: 'pre', textAlign: s > 0 ? 'left' : 'right' } as const;
        return (
          <div key={c.contact} style={{ position: 'absolute', inset: 0, opacity: alpha }}>
            <div style={{ ...type, top: tip.y - 20 - size / 2, color: accent }}>{number}</div>
            <div style={{ ...type, top: tip.y - size / 2, color: ink, opacity: 0.9 }}>{typeOnScramble(c.label, since, `${seed}|${c.contact}`)}</div>
          </div>
        );
      })}
      {launched && <SwellDisc pose={launched.pose} centres={launched.centres} color={color} tag={ballTag(launched.pose.aspect, clamp(launched.k))} />}
    </div>
  );
}

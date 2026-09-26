// bounce-swell.ts: a circle growing until its colour covers the frame, as a pure function of its progress; the
// bouncing ball launches into it, and any circle (a swatch, an i's tittle) can.

import type { FrameSize, VideoFormat } from '#models/frame/frame.ts';
import { clamp, lerp, powerOutEase } from '#models/motion/motion.ts';
import { DEG, REF_F, scaleStrain, shapeOfStrain, smoothstep, strainOf } from './bounce-shape.ts';

// Launch to a covered frame: 17 reference frames, from the last one crouched.
export const SWELL_TIME = 17 * REF_F;
/** The swell's default shutter: the reference's edge. */
const SWELL_SHUTTER = 0.3;
/** The swell's move to `to` over progress `u`: it sits 0.64 of a reference frame, then eases out (power 2.5) over 11.36. */
const swellMove = (u: number) => powerOutEase(2.5)((u - 0.64 / 17) / (11.36 / 17));
/** Its growth, as a share of ln(final radius / start radius); fitted to the reference's scale on every frame. */
const swellGrowth = (u: number) => 0.5 * u * (1 + u);

/** The circle a swell grows from. `aspect` and `angle` (degrees) when it starts squashed, as a ball leaving a crouch does. */
export type SwellFrom = { x: number; y: number; r: number; aspect?: number; angle?: number };

export type FieldSwellOptions = {
  /** The video's: the frame it covers, and the frame rate its shutter is a share of. */
  format: VideoFormat;
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

/** Pixels from (x, y) to the farthest corner of a frame `size` big. */
const farthestCorner = (x: number, y: number, { width, height }: FrameSize) => Math.hypot(Math.max(x, width - x), Math.max(y, height - y));

/**
 * The swell at progress `k` (0 start, 1 covered): a circle hopping to `to` on an ease-out while its radius grows
 * exponentially, ever faster (the reference's ×1.25 per 60 fps frame at the end), so the edge whips past the corners.
 * ln r runs 0.5k + 0.5k² of the way to 1.15× the reach to the farthest corner.
 */
export function fieldSwellAt(k: number, { format, from, to = { x: format.width / 2, y: format.height / 2 }, lift = 0, stretch = 1.75, duration = SWELL_TIME, shutter = SWELL_SHUTTER }: FieldSwellOptions): SwellPose {
  const u = clamp(k), grow = Math.log((1.15 * farthestCorner(to.x, to.y, format) + 2) / from.r);
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
  const soft = Math.max(1, (r * grow * (0.5 + u) * shutter) / (duration * format.fps));
  const covered = k >= 1 || r / Math.sqrt(aspect) - soft / 2 >= farthestCorner(x, y, format);
  return { x, y, r, aspect, angle: angle * DEG, soft, covered };
}

/** Where the swell's centre passes while the shutter is open around `k`, `k`'s own in the middle. */
export function swellCentres(k: number, opts: FieldSwellOptions & { duration: number }): { x: number; y: number }[] {
  const span = (opts.shutter ?? SWELL_SHUTTER) / opts.format.fps / opts.duration;
  return smearSamples((j) => fieldSwellAt(k + span * (j - 0.5), opts), 3, 15);
}

/**
 * `at` sampled evenly over 0..1, densely enough that its fastest stretch steps at most `gap` px (a landing stops the
 * ball partway through a shutter), up to `most`. An odd count, so the middle sample is `at(0.5)`, the frame's own.
 */
export function smearSamples<P extends { x: number; y: number }>(at: (k: number) => P, gap: number, most: number): P[] {
  const probe = Array.from({ length: 9 }, (_, j) => at(j / 8));
  const fastest = 8 * Math.max(...probe.slice(1).map((p, j) => Math.hypot(p.x - probe[j].x, p.y - probe[j].y)));
  const count = Math.min(most, Math.ceil(fastest / gap) + 1) | 1;
  return count < 3 ? [probe[4]] : Array.from({ length: count }, (_, j) => at(j / (count - 1)));
}

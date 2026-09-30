// type.ts: the kinetic type pieces' pure math: how a word is set and placed, a SlantWord's pose and transform, and a
// ScrambleText's decode and glitch schedule. Runs without a browser; the drawing measures and draws in reel/type*.tsx.

import { inflate, multiplyAffine, type AffineMatrix, type Point, type Rect } from '#lib/picture/frame/models/geometry.ts';
import { fullFrameRect, type FrameSize } from '#lib/picture/frame/models/frame.ts';
import { clamp, lerp, motionCurves, sineInOutEase } from '#lib/picture/motion/models/motion.ts';
import { hashRandom, seededRandom } from '#lib/picture/motion/models/random.ts';

const outExpo = motionCurves.expo.entrance;

// ---------- setting a word ----------

export type Align = 'left' | 'center' | 'right';

/** How a word is set: `cap` is its cap height in frame px (the size a frame shows), `spacing` its tracking in em. */
export type Setting = { family: string; cap: number; weight: number; stretch: number; spacing: number };

/** A word as the browser sets it: its font size, each character's advance box (x from the word's start), its width. */
export type SetWord = { size: number; chars: readonly { char: string; x: number; w: number }[]; width: number };

export const leftOf = (x: number, width: number, align: Align) => (align === 'center' ? x - width / 2 : align === 'right' ? x - width : x);

// Where the reference sets a label against the box it names: 6 px in from its left, its baseline 26 px over its top.
export const labelAt = (box: Point) => ({ x: box.x + 6, y: box.y - 26 });

// ---------- SelectionBox ----------

/** The reference's start: the video frame's own edges, just inside so the lines and handles show. */
export const frameEdgesRect = (size: FrameSize) => inflate(fullFrameRect(size), -10);

export const lerpRect = (a: Rect, b: Rect, k: number): Rect => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) });

// ---------- SlantWord ----------

// Archivo's lowercase stem in ems at weights 100, 200 … 900, measured on the dotless ı: it sizes the drawn tittle.
const ARCHIVO_STEM = [0.048, 0.058, 0.072, 0.088, 0.104, 0.122, 0.139, 0.164, 0.199];
export const stemAt = (weight: number) => {
  const f = clamp((weight - 100) / 100, 0, 8), i = Math.min(7, Math.floor(f));
  return lerp(ARCHIVO_STEM[i], ARCHIVO_STEM[i + 1], f - i);
};
// The reference's tittle: round, 1.4 stems across, its centre 0.685 em over the baseline.
export const TITTLE_ACROSS = 1.4;
export const TITTLE_HEIGHT = 0.685;
// Where a slanted word's label starts, in em from its box's slanted foot: Archivo's lowercase side bearing, less the
// 11 px the reference sets its "(03)" left of the i's foot.
export const SLANT_LABEL_IN = 0.036;

/** A SlantWord's pose at a moment of its entrance: its scale, turn and slant (degrees). */
export type SlantPose = { scale: number; turn: number; slant: number };

/** A SlantWord's entrance, as its props of the same names set it. */
export type SlantEntrance = {
  scale: number; duration: number; turn: number; turnDuration: number; slant: number; slantFrom: number; slantDuration: number;
};

/**
 * A SlantWord's pose `t` s into `entrance`, as it draws it. With `slantMatrix` about the word's origin, a scene can
 * draw in step with the word, e.g. inside one of its letters.
 */
export const slantWordPose = (t: number, { scale, duration, turn, turnDuration, slant, slantFrom, slantDuration }: SlantEntrance): SlantPose => ({
  scale: lerp(scale, 1, outExpo(t / duration)),
  turn: turn * (1 - sineInOutEase(t / turnDuration)),
  slant: lerp(slantFrom, slant, sineInOutEase((2 * t) / slantDuration - 1)),
});

/**
 * A word's transform about `origin`: scaled and turned (degrees), then slanted forward in screen space. A SlantWord's
 * origin is the middle of its cap box.
 */
export function slantMatrix(origin: Point, { scale, turn, slant }: SlantPose): AffineMatrix {
  const r = (turn * Math.PI) / 180, cos = Math.cos(r) * scale, sin = Math.sin(r) * scale;
  const skew: AffineMatrix = [1, 0, -Math.tan((slant * Math.PI) / 180), 1, 0, 0];
  return multiplyAffine(multiplyAffine(multiplyAffine([1, 0, 0, 1, origin.x, origin.y], skew), [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -origin.x, -origin.y]);
}

/** An i's tittle as a SlantWord draws it: centre and radius in frame px, the shape a FieldSwell grows from. */
export type Tittle = { x: number; y: number; r: number };

// ---------- ScrambleText ----------

/** The reference's code glyphs, which CODE decodes from. */
export const CODE_GLYPHS = '<>/{}#=$17';

export type ScrambleTiming = {
  /** Picks the glyphs: the same seed shows the same frames on every render. */
  seed: string | number;
  /** The glyphs an unlocked character shows. */
  charset?: string;
  /** Seconds to the first character locking, and between one locking and the next. A space takes no turn. */
  delay?: number;
  each?: number;
  /** Times a second an unlocked character re-rolls: the reference's 60 is every frame at 30 fps. */
  rate?: number;
};

/**
 * What a scramble shows `t` seconds in: each character of `text`, locked onto itself or a glyph from `charset` that
 * re-rolls `rate` times a second. Characters lock left to right, `each` apart after `delay`; spaces never scramble.
 * Pure, so the same seed gives the same frames on every render.
 */
export function scrambleAt(text: string, t: number, { seed, charset = CODE_GLYPHS, delay = 0.03, each = 0.05, rate = 60 }: ScrambleTiming) {
  // The epsilons keep a tick or a lock that lands on a frame from slipping to the frame after: delay + k·each sums
  // inexactly (0.1 + 2 × 0.1 is 0.30000000000000004).
  const tick = Math.floor(t * rate + 1e-6);
  let turn = 0;
  return [...text].map((char, slot) => {
    if (!char.trim() || t + 1e-6 >= delay + turn++ * each) return { char, locked: true };
    return { char: charset[Math.floor(hashRandom(seed, slot, tick) * charset.length)], locked: false };
  });
}

/** Seconds after its start that a scramble of `text` locks its last character. */
export function scrambleFinish(text: string, { delay = 0.03, each = 0.05 }: Pick<ScrambleTiming, 'delay' | 'each'> = {}) {
  return delay + Math.max(0, [...text].filter((c) => c.trim()).length - 1) * each;
}

// A hit's colour split decays ×0.85 a 60 fps frame down to 45% of its peak, until the next hit or 0.09 s after the last.
const GLITCH = { decay: 0.85, floor: 0.45, tail: 0.09 };

type Glitch = { split: number; slices: { y: number; h: number; dx: number }[]; ghost: Point | null };

/**
 * The glitch `t` seconds in: its colour split in px and, re-rolled each 60 fps tick, its slices (y from the baseline)
 * and a ghost's offset. Sizes are the reference's at its 306 px cap, scaled to `cap`.
 */
export function wordGlitchAt(t: number, hits: readonly number[], peak: number, seed: string | number, cap: number): Glitch | null {
  const sorted = hits.toSorted((p, q) => p - q);
  const i = sorted.findLastIndex((h) => h <= t);
  if (i < 0 || (i === sorted.length - 1 && t - sorted[i] >= GLITCH.tail)) return null;
  const split = peak * Math.max(GLITCH.floor, GLITCH.decay ** ((t - sorted[i]) * 60));
  const roll = seededRandom(`${seed}|glitch|${Math.floor(t * 60 + 1e-6)}`);
  const unit = cap / 306;
  const slices: Glitch['slices'] = [];
  // Bands 10–60 px tall, shifted 10–40 px either way, down the cap with gaps between; most ticks have some.
  if (roll() < 0.85) {
    for (let y = -cap - 10 * unit + 30 * unit * roll(); y < 0.05 * cap;) {
      const h = (10 + 50 * roll()) * unit;
      if (roll() < 0.55) slices.push({ y, h, dx: (roll() < 0.5 ? -1 : 1) * (10 + 30 * roll()) * unit });
      y += h + 40 * unit * roll();
    }
  }
  const ghost = roll() < 0.35 ? { x: (roll() - 0.5) * 0.24 * cap, y: (roll() < 0.5 ? -1 : 1) * (0.1 + 0.2 * roll()) * cap } : null;
  return { split, slices, ghost };
}

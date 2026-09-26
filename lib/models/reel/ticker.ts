// ticker.ts: TickerBands' model: the reference's poses, looks and moves, the hero's line, and the smear arithmetic.
// ticker-layout.ts lays the glyphs out; lib/studio/reel/ticker.tsx draws them.

import type { FrameSize } from '#models/frame/frame.ts';
import { smearSigma } from '#models/motion/shutter.ts';
import {
  archivoAdvance, layoutGlyphLine, mixGlyphPose, tickerBreathAt,
  type GlyphAxes, type GlyphPose, type GlyphLineSlot, type TickerBreath, type TickerPose,
} from './ticker-layout.ts';

// ---------- the reference's values ----------

// Archivo stands in for the reference's Roboto Flex–class face. These poses give "MOTION" at cap 110 px the
// reference's spread of word widths as it breathes (326 → 698 px, 10th to 90th percentile, ink between dots), its
// stems (0.10 → 0.31 cap) and letter gaps (3–7 → 8–10 px). The light end needs scaleX: Archivo stops at 62% wide.
export const TICKER_LIGHT: TickerPose = { wght: 460, wdth: 62, scaleX: 0.75, tracking: -0.037, dot: 0.05 };
export const TICKER_BOLD: TickerPose = { wght: 840, wdth: 122, scaleX: 1, tracking: -0.065, dot: 0.75 };

/** The hero's own poses: it breathes between `light` and `bold`, then eases into `hold` from the look that holds it. */
export type TickerHeroPoses = {
  light: GlyphPose;
  bold: GlyphPose;
  hold: GlyphPose & { /** Seconds to settle into it. */ settle: number };
};

/**
 * The reference's hero sets looser than the tickers at its light end and a little narrower at its bold: "MOTION"
 * breathes 369 → 686 px. Held, it is 538 px on 28 px stems with its letters all but touching.
 */
export const TICKER_HERO_POSES: TickerHeroPoses = {
  light: { wght: 460, wdth: 62, scaleX: 0.79, tracking: 0.007 },
  bold: { wght: 840, wdth: 118, scaleX: 1, tracking: -0.075 },
  hold: { wght: 800, wdth: 90, scaleX: 1, tracking: -0.094, settle: 0.04 },
};

/** One beat's look. */
export type TickerLook = {
  /** Tickers that swap their band and type colours: the even bands (0, 2, 4, …), the odd ones, or none. */
  stripes?: 'none' | 'even' | 'odd';
  /** Degrees the tickers' glyphs lean, as a skew: band edges stay level and the hero stays upright. */
  oblique?: number;
  /** This beat's changes to the tickers' breath ends. */
  light?: Partial<TickerPose>;
  bold?: Partial<TickerPose>;
  /** The hero leaves the breath for its `hold` pose, and holds it from here on. */
  heroHold?: boolean;
};

/**
 * The reference's four beats: slam in, stripes, inverted stripes leaning 11.3°, then all plain while the hero holds.
 * Its leaning beat also sets looser at the bold end (letter gaps 13–15 px, 8–10 upright) and ~40 px narrower at the light.
 */
export const TICKER_LOOKS: readonly TickerLook[] = [
  {},
  { stripes: 'even' },
  { stripes: 'odd', oblique: 11.3, light: { scaleX: 0.68, tracking: -0.045 }, bold: { tracking: -0.034 } },
  { heroHold: true },
];

/**
 * `ground` shows where a band is displaced and where the hero band has closed; `band` and `type` are a ticker's fill
 * and letters (a stripe swaps them) and `dot` its separators; `hero` and `heroType` are the hero band's.
 */
export type TickerColors = { ground: string; band: string; type: string; dot: string; hero: string; heroType: string };
export const TICKER_COLORS: TickerColors = { ground: '#0a0a0c', band: '#3a3cf4', type: '#efece6', dot: '#ee4c2f', hero: '#ee4c2f', heroType: '#1c0a16' };

/** A block jolt on every beat after the first: A·e^(−τ/decay)·cos(2π·hz·τ), odd and even bands opposite ways. */
export type TickerKick = { px: number; hz: number; decay: number };
/** Bands arriving from the right: the left edge is width·e^(−τ/decay), starting `lead` s before t = 0, `stagger` s later a band out from the hero. */
export type TickerEnter = { decay: number; stagger: number; lead: number };
/**
 * Tickers leaving along their drift on expo-in, all off `early` s before the last beat ends: the pair beside the
 * hero over `duration` s, each pair further out `step` s quicker. The hero band closes onto its centre line over
 * `collapse` s to the same moment, leaving its word in the type colour on the ground.
 */
export type TickerExit = { duration: number; step: number; early: number; collapse: number };

export const TICKER_KICK: TickerKick = { px: 38, hz: 4.9, decay: 0.061 };
// The reference's edges start 65 ms before the cut as read, mid-exposure; its exposure's first half is 4 ms more.
export const TICKER_ENTER: TickerEnter = { decay: 0.071, stagger: 0.02, lead: 0.069 };
// The reference's bands are gone 13 ms before the beat; ours 50 ms, a 30 fps frame and a shutter, so the last frame
// before a beat on the frame grid, open from 50 ms before it, sees only the word.
export const TICKER_EXIT: TickerExit = { duration: 0.24, step: 0.025, early: 0.05, collapse: 0.2 };
export const TICKER_BREATH: TickerBreath = { period: 0.875, lag: 0.047 };
// The reference's hero is widest 0.46 s after the cut, and so near its widest again when it holds on beat 3.
export const TICKER_HERO_PHASE = 0.1049;

/**
 * 180° at 30 fps: twice the reference's 60 fps smear in pixels, which our coarser frame rate needs to keep fast moves
 * from strobing. Whatever moves is drawn where it was mid-exposure and smeared along its travel, as ShutterBlur's
 * samples would average.
 */
export const TICKER_SHUTTER = 1 / 60;

/**
 * The beat whose look TickerBands shows at `t` (past its last look, the last holds). A look shows from the frame (at
 * `fps`) nearest its beat, as BeatGrid.frame rounds, so every band flips on the same frame.
 */
export const tickerLookBeat = (t: number, spb: number, fps: number) => Math.floor((t + 0.5 / fps) / spb);

/** Where a moving block was mid-exposure, and how far it travelled while the shutter was open, px. */
export function tickerExposure(block: (t: number) => number, t: number, shutter: number) {
  const now = block(t);
  if (shutter <= 0) return { offset: now, travel: 0 };
  const before = block(t - shutter);
  return { offset: (now + before) / 2, travel: Math.abs(now - before) };
}

// ---------- the hero's line ----------

type HeroGlyph = { char: string; axes: GlyphAxes; x: number };

/** The hero's glyphs (and its number's place) at `t`, centred on the frame: the breath, eased into the hold once held. */
export function tickerHeroLine(t: number, { word, count, size, breath, poses, heldAt, phase, frame }: {
  word: string;
  count?: (t: number) => number;
  size: number;
  breath: TickerBreath;
  poses: TickerHeroPoses;
  heldAt: number | null;
  phase: number;
  frame: FrameSize;
}) {
  const held = heldAt === null ? 0 : 1 - Math.exp(-Math.max(0, t - heldAt) / poses.hold.settle);
  const poseAt = (i: number) => mixGlyphPose(mixGlyphPose(poses.light, poses.bold, tickerBreathAt(t, i, breath, phase)), poses.hold, held);
  const chars = count ? [...word, ' '] : [...word];
  const slots: GlyphLineSlot[] = chars.map((char, i) => {
    const pose = poseAt(i);
    return { char, axes: axesOf(pose), tracking: pose.tracking };
  });
  let countPose: GlyphPose | null = null;
  if (count) {
    countPose = poseAt(chars.length);
    // The Odometer gives each digit 1ch plus its tracking, inside the wrapper that squeezes it by scaleX.
    const digits = String(Math.max(0, Math.round(count(t)))).length;
    slots.push({ blank: digits * (archivoAdvance('0', axesOf(countPose)) + countPose.tracking * countPose.scaleX) * size });
  }
  const line = layoutGlyphLine(slots, size);
  const left = (frame.width - line.width) / 2;
  const glyphs: HeroGlyph[] = [];
  chars.forEach((char, i) => {
    const slot = slots[i];
    if (char.trim() && 'char' in slot) glyphs.push({ char, axes: slot.axes, x: left + line.x[i] });
  });
  return { glyphs, held, count: countPose && { pose: countPose, x: left + line.x[chars.length] } };
}

const axesOf = ({ wght, wdth, scaleX }: GlyphPose): GlyphAxes => ({ wght, wdth, scaleX });

// ---------- smears ----------

// Below this a smear can't be seen and text stays crisp: the drift alone (231 px/s) smears σ 1.2 px at 1/60 s.
const MIN_SIGMA = 1.5;
// σ rounds to steps of √2, so glyphs moving at about the same speed share a filter.
export const tickerBlurLevel = (sigma: number) => (sigma < MIN_SIGMA ? null : Math.round(2 * Math.log2(sigma / MIN_SIGMA)));
export const tickerLevelSigma = (level: number) => MIN_SIGMA * 2 ** (level / 2);
// Every glyph gets a box this many em wide (Archivo's widest, №, is 1.65), so one filter region fits them all.
export const TICKER_GLYPH_BOX_EM = 1.8;

// A band's own travel (arriving, jolting, leaving) is smeared as the box an open shutter makes: blurred copies spread
// evenly along it, averaged. A Gaussian with the same edge ramp reaches ~0.4 of the travel further each way, and at
// the whip's speeds turns the letters to haze where the reference's stay legible as ghosts. A power of two.
export const TICKER_BOX_TAPS = 8;
export const tickerBoxSmeared = (travel: number) => smearSigma(travel) >= MIN_SIGMA;
// How far past the band's own box its smear reaches, px: half the travel, then three σ of each copy's blur.
export const tickerBoxReach = (travel: number) => (tickerBoxSmeared(travel) ? travel / 2 + (3 * travel) / (2 * TICKER_BOX_TAPS) : 0);

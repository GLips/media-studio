// ticker.tsx: full-bleed bands of a word repeating between accent dots, after the reference reel's "MOTION" bar.
// Not a marquee: each glyph's weight and width breathe on one sinusoid, a little behind the glyph to its left, so a
// bold wave runs along every row and the row reflows around it (ticker-layout.ts places each glyph at its own axes).
// The tickers drift in mirrored pairs around a still hero band; the look changes on every beat with a damped jolt;
// the bands whip in from the right, then fly off along their drift while the hero band closes onto its word.

import { useId, type ReactNode } from 'react';
import { DISPLAY_FONT } from '#models/type/faces.ts';
import { FPS, H, W } from '#models/frame/frame.ts';
import { motionCurves } from '#models/motion/motion.ts';
import { smearSigma } from '#models/motion/shutter.ts';
import { pieceMotionAttrs } from '../motion-tag.ts';
import { hashRandom } from '#models/motion/random.ts';
import { Odometer } from '../kit.tsx';
import {
  ARCHIVO_BASELINE_EM, ARCHIVO_CAP_EM, archivoAdvance, layoutGlyphLine, layoutTickerRow, mixGlyphPose, tickerBreathAt,
  type GlyphAxes, type GlyphPose, type GlyphLineSlot, type TickerBreath, type TickerPose, type TickerSlot,
} from '#models/reel/ticker-layout.ts';

export type { GlyphPose, TickerBreath, TickerPose } from '#models/reel/ticker-layout.ts';

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
const REFERENCE_COLORS: TickerColors = { ground: '#0a0a0c', band: '#3a3cf4', type: '#efece6', dot: '#ee4c2f', hero: '#ee4c2f', heroType: '#1c0a16' };

/** A block jolt on every beat after the first: A·e^(−τ/decay)·cos(2π·hz·τ), odd and even bands opposite ways. */
export type TickerKick = { px: number; hz: number; decay: number };
/** Bands arriving from the right: the left edge is W·e^(−τ/decay), starting `lead` s before t = 0, `stagger` s later a band out from the hero. */
export type TickerEnter = { decay: number; stagger: number; lead: number };
/**
 * Tickers leaving along their drift on expo-in, all off `early` s before the last beat ends: the pair beside the
 * hero over `duration` s, each pair further out `step` s quicker. The hero band closes onto its centre line over
 * `collapse` s to the same moment, leaving its word in the type colour on the ground.
 */
export type TickerExit = { duration: number; step: number; early: number; collapse: number };

const REFERENCE_KICK: TickerKick = { px: 38, hz: 4.9, decay: 0.061 };
// The reference's edges start 65 ms before the cut as read, mid-exposure; its exposure's first half is 4 ms more.
const REFERENCE_ENTER: TickerEnter = { decay: 0.071, stagger: 0.02, lead: 0.069 };
// The reference's bands are gone 13 ms before the beat; ours 50 ms, a 30 fps frame and a shutter, so the last frame
// before a beat on the frame grid, open from 50 ms before it, sees only the word.
const REFERENCE_EXIT: TickerExit = { duration: 0.24, step: 0.025, early: 0.05, collapse: 0.2 };
const REFERENCE_BREATH: TickerBreath = { period: 0.875, lag: 0.047 };
// The reference's hero is widest 0.46 s after the cut, and so near its widest again when it holds on beat 3.
const REFERENCE_HERO_PHASE = 0.1049;

/**
 * 180° at 30 fps: twice the reference's 60 fps smear in pixels, which our coarser frame rate needs to keep fast moves
 * from strobing. Whatever moves is drawn where it was mid-exposure and smeared along its travel, as ShutterBlur's
 * samples would average.
 */
const SHUTTER = 1 / 60;

// ---------- the piece ----------

export type TickerBandsProps = {
  /** Seconds since the first beat (the cut in); nothing draws before it. */
  t: number;
  /** Seconds per beat: a look (and a jolt) lands on each. */
  spb: number;
  /** The word the tickers repeat, dots between. */
  text?: string;
  /** The hero band's word. Default `text`. */
  hero?: string;
  /** A number after the hero's word, rolling as an Odometer: its value at each moment, e.g. stepping on the beats. */
  count?: (t: number) => number;
  /** Bands, odd: the middle one is the hero. Each is 1/bands of the frame's height. */
  bands?: number;
  /** Cap height, px: 110 is 10.2% of frame height, 0.71 of a band. Tracking and poses scale with it. */
  cap?: number;
  /** The separator dot's diameter, px. */
  dot?: number;
  /**
   * The palette over the reference's, or each band's at `t`, top to bottom with the hero's in the middle: bands can
   * turn red one by one as a count climbs. A stripe look swaps a ticker's `band` and `type` colours.
   */
  colors?: Partial<TickerColors> | ((band: number, t: number) => Partial<TickerColors>);
  /** One look per beat; the last holds. The piece lasts `looks.length` beats, and its exit ends the last. */
  looks?: readonly TickerLook[];
  breath?: TickerBreath;
  /** The tickers' breath ends. */
  light?: TickerPose;
  bold?: TickerPose;
  heroPoses?: TickerHeroPoses;
  /** Drift speed, px/s (231 is 12% of frame width a second). */
  drift?: number;
  /** Each band's drift direction, top to bottom: default mirrored about the hero, L R L · L R L. */
  directions?: readonly number[];
  kick?: TickerKick | false;
  enter?: TickerEnter | false;
  exit?: TickerExit | false;
  /** Seeds the tickers' breath phases. */
  seed?: number | string;
  /** Each band's breath phase in cycles, top to bottom. Default: seeded for the tickers, the reference's for the hero. */
  phases?: readonly number[];
  /** Seconds the shutter is open for motion smear; 0 for none. */
  shutter?: number;
  motion?: string | false;
};

/**
 * The reference's ticker bands (reel 05, 8.4–10.3 s), as a pure function of `t`: seven bands of `text`, the middle
 * one a still hero. Defaults are the reference's, at 128 BPM there: `spb` 0.469.
 */
export function TickerBands({
  t, spb, text = 'MOTION', hero = text, count, bands = 7, cap = 110, dot = 20, colors, looks = TICKER_LOOKS,
  breath = REFERENCE_BREATH, light = TICKER_LIGHT, bold = TICKER_BOLD, heroPoses = TICKER_HERO_POSES, drift = 231,
  directions, kick = REFERENCE_KICK, enter = REFERENCE_ENTER, exit = REFERENCE_EXIT, seed = 'ticker', phases,
  shutter = SHUTTER, motion,
}: TickerBandsProps) {
  if (!(bands % 2 === 1 && bands >= 1)) throw new Error(`TickerBands: bands must be odd, to have a middle one, not ${bands}`);
  if (t < 0) return null;
  const middle = (bands - 1) / 2;
  const beat = tickerLookBeat(t, spb);
  const look = looks[Math.min(beat, looks.length - 1)];
  const end = looks.length * spb - (exit ? exit.early : 0);
  const size = cap / ARCHIVO_CAP_EM;
  const holdFrom = looks.findIndex((l) => l.heroHold);

  // A band's displacement as a block over this frame's exposure: arriving, jolting, leaving. Content drifts inside it.
  // The jolt is this frame's beat's, held at its peak before the beat: a step doesn't smear, so the frame the look
  // flips on shows the band crisp at full kick, as the reference's first frame after a beat does.
  const blockAt = (b: number) => (at: number) => {
    const d = Math.abs(b - middle);
    let x = 0;
    if (enter) {
      const start = -enter.lead + d * enter.stagger;
      x += at < start ? W : W * Math.exp(-(at - start) / enter.decay);
    }
    if (kick && beat >= 1 && beat < looks.length) {
      const tau = Math.max(0, at - beat * spb);
      x += (-1) ** (b + beat) * kick.px * Math.exp(-tau / kick.decay) * Math.cos(2 * Math.PI * kick.hz * tau);
    }
    if (exit && b !== middle) {
      const duration = Math.max(0.05, exit.duration - (d - 1) * exit.step);
      x += directionOf(b) * W * motionCurves.expo.exit((at - (end - duration)) / duration);
    }
    return x;
  };
  const directionOf = (b: number) => directions?.[b] ?? (b === middle ? 0 : Math.abs(b - middle) % 2 ? -1 : 1);
  const phaseOf = (b: number) => phases?.[b] ?? (b === middle ? REFERENCE_HERO_PHASE : hashRandom(seed, 'band', b));
  const top = (b: number) => Math.round((b * H) / bands);
  const palette = Array.from({ length: bands }, (_, b): TickerColors => ({
    ...REFERENCE_COLORS, ...(typeof colors === 'function' ? colors(b, t) : colors),
  }));

  return (
    <div
      {...pieceMotionAttrs(motion, 'ticker', { kind: 'ticker-bands', values: { beat, breath: mod1(t / breath.period) } })}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      {palette.map((c, b) => (
        <div key={`ground-${b}`} style={{ position: 'absolute', left: 0, top: top(b), width: W, height: top(b + 1) - top(b), background: c.ground }} />
      ))}
      {palette.map((c, b) => {
        const band = { top: top(b), height: top(b + 1) - top(b) };
        if (b === middle) {
          const heldAt = holdFrom >= 0 && beat >= holdFrom ? holdFrom * spb : null;
          return (
            <HeroBand
              key={b} t={t} {...band} word={hero} count={count} size={size} cap={cap} colors={c} breath={breath}
              poses={heroPoses} heldAt={heldAt} phase={phaseOf(b)} block={blockAt(b)} shutter={shutter}
              collapse={exit ? motionCurves.expo.exit((t - (end - exit.collapse)) / exit.collapse) : 0} tagged={motion !== false}
            />
          );
        }
        const striped = (look.stripes === 'even' && b % 2 === 0) || (look.stripes === 'odd' && b % 2 === 1);
        return (
          <TickerBand
            key={b} t={t} {...band} text={text} cap={cap} dot={dot} fill={striped ? c.type : c.band}
            color={striped ? c.band : c.type} dotColor={c.dot} drift={drift * directionOf(b)} phase={phaseOf(b)}
            breath={breath} light={{ ...light, ...look.light }} bold={{ ...bold, ...look.bold }} oblique={look.oblique ?? 0}
            block={blockAt(b)} shutter={shutter} motion={motion === false ? false : undefined} name={`band-${b}`}
          />
        );
      })}
    </div>
  );
}

/**
 * The beat whose look TickerBands shows at `t` (past its last look, the last holds). A look shows from the frame
 * nearest its beat, as BeatGrid.frame rounds, so every band flips on the same frame.
 */
export const tickerLookBeat = (t: number, spb: number) => Math.floor((t + 0.5 / FPS) / spb);
const mod1 = (x: number) => x - Math.floor(x);

// ---------- one band ----------

export type TickerBandProps = {
  t: number;
  text: string;
  /** The band's top edge and height, px; it spans the frame's width. */
  top: number;
  height: number;
  cap?: number;
  dot?: number;
  /** The band's colour, its letters' and its dots'. */
  fill: string;
  color: string;
  dotColor: string;
  /** Px/s the words move along the band, signed: negative drifts left. */
  drift?: number;
  /** Where its breath starts, in cycles. */
  phase?: number;
  breath?: TickerBreath;
  light?: TickerPose;
  bold?: TickerPose;
  oblique?: number;
  /** The whole band's displacement at any moment, px: it arrives, jolts and leaves with this, and smears by it. */
  block?: (t: number) => number;
  shutter?: number;
  motion?: string | false;
  /** Its track's name when `motion` doesn't give one. */
  name?: string;
};

/**
 * One full-bleed ticker band: `text` repeating between dots, breathing and drifting. TickerBands stacks seven; use
 * one alone for a single strip across a shot.
 */
export function TickerBand({
  t, text, top, height, cap = 110, dot = 20, fill, color, dotColor, drift = 0, phase = 0, breath = REFERENCE_BREATH,
  light = TICKER_LIGHT, bold = TICKER_BOLD, oblique = 0, block = () => 0, shutter = SHUTTER, motion, name = 'band',
}: TickerBandProps) {
  const id = useId().replace(/[^\w-]/g, '');
  const size = cap / ARCHIVO_CAP_EM;
  const style = { unit: [...text, null], size, breath, light, bold, phase };
  const { offset, travel } = exposure(block, t, shutter);
  const reach = boxReach(travel);
  if (offset - reach >= W || offset + reach <= -W) return null;
  // The part of the band on screen, in its own coordinates, with room for a lean, a smear and the block's blur.
  const margin = Math.tan((Math.abs(oblique) * Math.PI) / 180) * cap + 24 + reach;
  const span = { from: Math.max(0, -offset) - margin, to: Math.min(W, W - offset) + margin, centre: W / 2, anchor: W };
  const row = layoutTickerRow(t, style, { offset: drift * t, ...span });
  const was = shutter > 0 ? new Map(layoutTickerRow(t - shutter, style, { offset: drift * (t - shutter), ...span, from: span.from - W / 4, to: span.to + W / 4 }).map((s) => [s.index, s.x])) : null;
  const baseline = (height + cap) / 2;
  const blurs = new Set<number>();
  // Where a slot was mid-exposure, and the level of the smear its travel leaves (null when that's too little to see).
  const exposed = (slot: TickerSlot, scaleX: number) => {
    const before = was?.get(slot.index);
    if (before === undefined) return { x: slot.x, level: null };
    const level = blurLevel(smearSigma(slot.x - before) / scaleX);
    if (level !== null) blurs.add(level);
    return { x: (slot.x + before) / 2, level };
  };

  const cells = row.map((slot) => {
    if (slot.char === null) {
      const { x, level } = exposed(slot, 1);
      return <Dot key={slot.index} x={x + slot.advance / 2} y={baseline - cap / 2} d={dot} color={dotColor} filter={level === null ? undefined : `url(#${id}-d${level})`} />;
    }
    if (slot.char.trim() === '') return null;
    const { x, level } = exposed(slot, slot.axes.scaleX ?? 1);
    return <Glyph key={slot.index} char={slot.char} axes={slot.axes} x={x} baseline={baseline} size={size} color={color} filter={level === null ? undefined : `url(#${id}-g${level})`} />;
  });

  return (
    <>
      <BlurFilters id={id} glyphLevels={blurs} dot={dot} size={size} travel={travel} />
      <div
        {...pieceMotionAttrs(motion, name, { kind: 'ticker-band', values: { drift: drift * t } })}
        style={{
          position: 'absolute', left: 0, top, width: W, height, overflow: 'hidden', background: fill,
          transform: `translateX(${offset}px)`, filter: boxSmeared(travel) ? `url(#${id}-block)` : undefined,
        }}
      >
        <div style={{ position: 'absolute', inset: 0, transform: oblique ? `skewX(${-oblique}deg)` : undefined, transformOrigin: `0 ${baseline - cap / 2}px` }}>
          {cells}
        </div>
      </div>
    </>
  );
}

/** Where a moving block was mid-exposure, and how far it travelled while the shutter was open, px. */
function exposure(block: (t: number) => number, t: number, shutter: number) {
  const now = block(t);
  if (shutter <= 0) return { offset: now, travel: 0 };
  const before = block(t - shutter);
  return { offset: (now + before) / 2, travel: Math.abs(now - before) };
}

// ---------- the hero band ----------

/**
 * The hero: a centred word breathing like the tickers, with an optional rolling number after it, that eases into the
 * hold pose once held. Collapsing, its colour closes onto the centre line over a copy of its content in the type
 * colour, so the word stays put and only the band goes.
 */
function HeroBand({ t, top, height, word, count, size, cap, colors, breath, poses, heldAt, phase, block, shutter, collapse, tagged }: {
  t: number;
  top: number;
  height: number;
  word: string;
  count?: (t: number) => number;
  size: number;
  cap: number;
  colors: TickerColors;
  breath: TickerBreath;
  poses: TickerHeroPoses;
  heldAt: number | null;
  phase: number;
  block: (t: number) => number;
  shutter: number;
  collapse: number;
  tagged: boolean;
}) {
  const id = useId().replace(/[^\w-]/g, '');
  const { offset, travel } = exposure(block, t, shutter);
  const baseline = (height + cap) / 2;
  const lineAt = (at: number) => heroLine(at, { word, count, size, breath, poses, heldAt, phase });
  const line = lineAt(t);
  const was = shutter > 0 ? lineAt(t - shutter) : null;
  const blurs = new Set<number>();
  const glyphs = line.glyphs.map((g, i) => {
    const before = was?.glyphs[i].x;
    if (before === undefined) return { ...g, level: null };
    const level = blurLevel(smearSigma(g.x - before) / (g.axes.scaleX ?? 1));
    if (level !== null) blurs.add(level);
    return { ...g, x: (g.x + before) / 2, level };
  });
  const number = line.count && { ...line.count, x: was?.count ? (line.count.x + was.count.x) / 2 : line.count.x };
  const inset = (height / 2) * collapse;

  const content = (color: string, live: boolean) => (
    <>
      {glyphs.map((g, i) => (
        <Glyph key={i} char={g.char} axes={g.axes} x={g.x} baseline={baseline} size={size} color={color} filter={g.level === null ? undefined : `url(#${id}-g${g.level})`} />
      ))}
      {count && number && (
        <div style={{ position: 'absolute', inset: 0, transform: `scaleX(${number.pose.scaleX})`, transformOrigin: `${number.x}px 0` }}>
          <Odometer
            t={t} value={count} x={number.x} y={baseline} size={size} color={color} weight={number.pose.wght}
            stretch={number.pose.wdth} tracking={number.pose.tracking} motion={live && tagged ? undefined : false}
          />
        </div>
      )}
    </>
  );

  return (
    <>
      <BlurFilters id={id} glyphLevels={blurs} dot={0} size={size} travel={travel} />
      <div
        {...(tagged ? pieceMotionAttrs(undefined, 'hero', { kind: 'ticker-hero', values: { hold: line.held, collapse } }) : {})}
        style={{
          position: 'absolute', left: 0, top, width: W, height, transform: `translateX(${offset}px)`,
          filter: boxSmeared(travel) ? `url(#${id}-block)` : undefined,
        }}
      >
        {collapse > 0 && content(colors.type, false)}
        {inset < height / 2 && (
          <div style={{ position: 'absolute', inset: 0, background: colors.hero, clipPath: inset > 0 ? `inset(${inset}px 0 ${inset}px 0)` : undefined }}>
            {content(colors.heroType, true)}
          </div>
        )}
      </div>
    </>
  );
}

type HeroGlyph = { char: string; axes: GlyphAxes; x: number };

/** The hero's glyphs (and its number's place) at `t`, centred on the frame: the breath, eased into the hold once held. */
function heroLine(t: number, { word, count, size, breath, poses, heldAt, phase }: {
  word: string;
  count?: (t: number) => number;
  size: number;
  breath: TickerBreath;
  poses: TickerHeroPoses;
  heldAt: number | null;
  phase: number;
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
  const left = (W - line.width) / 2;
  const glyphs: HeroGlyph[] = [];
  chars.forEach((char, i) => {
    const slot = slots[i];
    if (char.trim() && 'char' in slot) glyphs.push({ char, axes: slot.axes, x: left + line.x[i] });
  });
  return { glyphs, held, count: countPose && { pose: countPose, x: left + line.x[chars.length] } };
}

const axesOf = ({ wght, wdth, scaleX }: GlyphPose): GlyphAxes => ({ wght, wdth, scaleX });

// ---------- drawing ----------

/** A glyph at its own axes, its advance box starting at `x`, sitting on `baseline`. */
function Glyph({ char, axes, x, baseline, size, color, filter }: { char: string; axes: GlyphAxes; x: number; baseline: number; size: number; color: string; filter?: string }) {
  return (
    <span
      style={{
        position: 'absolute', left: 0, top: baseline - ARCHIVO_BASELINE_EM * size, width: GLYPH_BOX_EM * size, height: size,
        fontFamily: DISPLAY_FONT, fontSize: size, lineHeight: `${size}px`, fontWeight: axes.wght, fontStretch: `${axes.wdth}%`,
        fontVariationSettings: `"wght" ${axes.wght}, "wdth" ${axes.wdth}`, color, whiteSpace: 'pre',
        transform: `translateX(${x}px) scaleX(${axes.scaleX ?? 1})`, transformOrigin: '0 0', filter,
      }}
    >
      {char}
    </span>
  );
}

function Dot({ x, y, d, color, filter }: { x: number; y: number; d: number; color: string; filter?: string }) {
  return <div style={{ position: 'absolute', left: 0, top: y - d / 2, width: d, height: d, borderRadius: '50%', background: color, transform: `translateX(${x - d / 2}px)`, filter }} />;
}

// Below this a smear can't be seen and text stays crisp: the drift alone (231 px/s) smears σ 1.2 px at 1/60 s.
const MIN_SIGMA = 1.5;
// σ rounds to steps of √2, so glyphs moving at about the same speed share a filter.
const blurLevel = (sigma: number) => (sigma < MIN_SIGMA ? null : Math.round(2 * Math.log2(sigma / MIN_SIGMA)));
const levelSigma = (level: number) => MIN_SIGMA * 2 ** (level / 2);
// Every glyph gets a box this many em wide (Archivo's widest, №, is 1.65), so one filter region fits them all.
const GLYPH_BOX_EM = 1.8;

// A band's own travel (arriving, jolting, leaving) is smeared as the box an open shutter makes: blurred copies spread
// evenly along it, averaged. A Gaussian with the same edge ramp reaches ~0.4 of the travel further each way, and at
// the whip's speeds turns the letters to haze where the reference's stay legible as ghosts. A power of two.
const BOX_TAPS = 8;
const boxSmeared = (travel: number) => smearSigma(travel) >= MIN_SIGMA;
// How far past the band's own box its smear reaches, px: half the travel, then three σ of each copy's blur.
const boxReach = (travel: number) => (boxSmeared(travel) ? travel / 2 + (3 * travel) / (2 * BOX_TAPS) : 0);

/**
 * This band's smears: a horizontal Gaussian per blur level its glyphs and dots use, and a box for the band's own
 * `travel`. A filter region is a share of the element it's on, so each is sized for its element's box.
 */
function BlurFilters({ id, glyphLevels, dot, size, travel }: { id: string; glyphLevels: ReadonlySet<number>; dot: number; size: number; travel: number }) {
  const box = boxSmeared(travel);
  if (!glyphLevels.size && !box) return null;
  const gaussian = (key: string, sigma: number, boxWidth: number): ReactNode => {
    const pad = (3 * sigma + 4) / boxWidth;
    return (
      <filter key={key} id={`${id}-${key}`} x={-pad} y={-0.1} width={1 + 2 * pad} height={1.2} colorInterpolationFilters="sRGB">
        <feGaussianBlur stdDeviation={`${sigma} 0`} />
      </filter>
    );
  };
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }}>
      {[...glyphLevels].map((level) => gaussian(`g${level}`, levelSigma(level), GLYPH_BOX_EM * size))}
      {dot > 0 && [...glyphLevels].map((level) => gaussian(`d${level}`, levelSigma(level), dot))}
      {box && <BoxSmear id={`${id}-block`} travel={travel} />}
    </svg>
  );
}

/** A box smear `travel` px long, centred: each copy blurred by half the gap between copies, so they run together. */
function BoxSmear({ id, travel }: { id: string; travel: number }) {
  const gap = travel / BOX_TAPS;
  const pad = (boxReach(travel) + 4) / W;
  const taps = Array.from({ length: BOX_TAPS }, (_, i) => `tap${i}`);
  // Average the copies in pairs, then pairs of pairs: arithmetic compositing is on premultiplied colour, as exposure is.
  const mixes: ReactNode[] = [];
  for (let level = taps, n = 0; level.length > 1; ) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2, n++) {
      mixes.push(<feComposite key={`mix${n}`} in={level[i]} in2={level[i + 1]} operator="arithmetic" k2={0.5} k3={0.5} result={`mix${n}`} />);
      next.push(`mix${n}`);
    }
    level = next;
  }
  return (
    <filter id={id} x={-pad} y={-0.1} width={1 + 2 * pad} height={1.2} colorInterpolationFilters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation={`${gap / 2} 0`} result="soft" />
      {taps.map((tap, i) => <feOffset key={tap} in="soft" dx={(i + 0.5) * gap - travel / 2} result={tap} />)}
      {mixes}
    </filter>
  );
}

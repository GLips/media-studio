// ticker.tsx: full-bleed bands of a word repeating between accent dots, after the reference reel's "MOTION" bar.
// Not a marquee: each glyph's weight and width breathe on one sinusoid, a little behind the glyph to its left, so a
// bold wave runs along every row and the row reflows around it (ticker-layout.ts places each glyph at its own axes).
// The tickers drift in mirrored pairs around a still hero band; the look changes on every beat with a damped jolt;
// the bands whip in from the right, then fly off along their drift while the hero band closes onto its word.
// Its poses, looks, moves and smear arithmetic are lib/models/reel/ticker.ts.

import { useId, type ReactNode } from 'react';
import { DISPLAY_FONT } from '#models/type/faces.ts';
import { motionCurves } from '#models/motion/motion.ts';
import { smearSigma } from '#models/motion/shutter.ts';
import { useVideoFormat } from '../composition/video-format.ts';
import { pieceMotionAttrs } from '../probe/motion-tag.ts';
import { hashRandom } from '#models/motion/random.ts';
import { Odometer } from '../kit/kit.tsx';
import {
  ARCHIVO_BASELINE_EM, ARCHIVO_CAP_EM, layoutTickerRow, type GlyphAxes, type TickerBreath, type TickerPose, type TickerSlot,
} from '#models/reel/ticker-layout.ts';
import {
  TICKER_BOLD, TICKER_BOX_TAPS, TICKER_BREATH, TICKER_COLORS, TICKER_ENTER, TICKER_EXIT, TICKER_GLYPH_BOX_EM,
  TICKER_HERO_PHASE, TICKER_HERO_POSES, TICKER_KICK, TICKER_LIGHT, TICKER_LOOKS, TICKER_SHUTTER, tickerBlurLevel,
  tickerBoxReach, tickerBoxSmeared, tickerExposure, tickerHeroLine, tickerLevelSigma, tickerLookBeat,
  type TickerColors, type TickerEnter, type TickerExit, type TickerHeroPoses, type TickerKick, type TickerLook,
} from '#models/reel/ticker.ts';

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
  breath = TICKER_BREATH, light = TICKER_LIGHT, bold = TICKER_BOLD, heroPoses = TICKER_HERO_POSES, drift = 231,
  directions, kick = TICKER_KICK, enter = TICKER_ENTER, exit = TICKER_EXIT, seed = 'ticker', phases,
  shutter = TICKER_SHUTTER, motion,
}: TickerBandsProps) {
  const { fps, width, height } = useVideoFormat();
  if (!(bands % 2 === 1 && bands >= 1)) throw new Error(`TickerBands: bands must be odd, to have a middle one, not ${bands}`);
  if (t < 0) return null;
  const middle = (bands - 1) / 2;
  const beat = tickerLookBeat(t, spb, fps);
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
      x += at < start ? width : width * Math.exp(-(at - start) / enter.decay);
    }
    if (kick && beat >= 1 && beat < looks.length) {
      const tau = Math.max(0, at - beat * spb);
      x += (-1) ** (b + beat) * kick.px * Math.exp(-tau / kick.decay) * Math.cos(2 * Math.PI * kick.hz * tau);
    }
    if (exit && b !== middle) {
      const duration = Math.max(0.05, exit.duration - (d - 1) * exit.step);
      x += directionOf(b) * width * motionCurves.expo.exit((at - (end - duration)) / duration);
    }
    return x;
  };
  const directionOf = (b: number) => directions?.[b] ?? (b === middle ? 0 : Math.abs(b - middle) % 2 ? -1 : 1);
  const phaseOf = (b: number) => phases?.[b] ?? (b === middle ? TICKER_HERO_PHASE : hashRandom(seed, 'band', b));
  const top = (b: number) => Math.round((b * height) / bands);
  const palette = Array.from({ length: bands }, (_, b): TickerColors => ({
    ...TICKER_COLORS, ...(typeof colors === 'function' ? colors(b, t) : colors),
  }));

  return (
    <div
      {...pieceMotionAttrs(motion, 'ticker', { kind: 'ticker-bands', values: { beat, breath: mod1(t / breath.period) } })}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      {palette.map((c, b) => (
        <div key={`ground-${b}`} style={{ position: 'absolute', left: 0, top: top(b), width, height: top(b + 1) - top(b), background: c.ground }} />
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
  t, text, top, height, cap = 110, dot = 20, fill, color, dotColor, drift = 0, phase = 0, breath = TICKER_BREATH,
  light = TICKER_LIGHT, bold = TICKER_BOLD, oblique = 0, block = () => 0, shutter = TICKER_SHUTTER, motion, name = 'band',
}: TickerBandProps) {
  const id = useId().replace(/[^\w-]/g, '');
  const { width } = useVideoFormat();
  const size = cap / ARCHIVO_CAP_EM;
  const style = { unit: [...text, null], size, breath, light, bold, phase };
  const { offset, travel } = tickerExposure(block, t, shutter);
  const reach = tickerBoxReach(travel);
  if (offset - reach >= width || offset + reach <= -width) return null;
  // The part of the band on screen, in its own coordinates, with room for a lean, a smear and the block's blur.
  const margin = Math.tan((Math.abs(oblique) * Math.PI) / 180) * cap + 24 + reach;
  const span = { from: Math.max(0, -offset) - margin, to: Math.min(width, width - offset) + margin, centre: width / 2, anchor: width };
  const row = layoutTickerRow(t, style, { offset: drift * t, ...span });
  const was = shutter > 0 ? new Map(layoutTickerRow(t - shutter, style, { offset: drift * (t - shutter), ...span, from: span.from - width / 4, to: span.to + width / 4 }).map((s) => [s.index, s.x])) : null;
  const baseline = (height + cap) / 2;
  const blurs = new Set<number>();
  // Where a slot was mid-exposure, and the level of the smear its travel leaves (null when that's too little to see).
  const exposed = (slot: TickerSlot, scaleX: number) => {
    const before = was?.get(slot.index);
    if (before === undefined) return { x: slot.x, level: null };
    const level = tickerBlurLevel(smearSigma(slot.x - before) / scaleX);
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
          position: 'absolute', left: 0, top, width, height, overflow: 'hidden', background: fill,
          transform: `translateX(${offset}px)`, filter: tickerBoxSmeared(travel) ? `url(#${id}-block)` : undefined,
        }}
      >
        <div style={{ position: 'absolute', inset: 0, transform: oblique ? `skewX(${-oblique}deg)` : undefined, transformOrigin: `0 ${baseline - cap / 2}px` }}>
          {cells}
        </div>
      </div>
    </>
  );
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
  const frame = useVideoFormat();
  const { offset, travel } = tickerExposure(block, t, shutter);
  const baseline = (height + cap) / 2;
  const lineAt = (at: number) => tickerHeroLine(at, { word, count, size, breath, poses, heldAt, phase, frame });
  const line = lineAt(t);
  const was = shutter > 0 ? lineAt(t - shutter) : null;
  const blurs = new Set<number>();
  const glyphs = line.glyphs.map((g, i) => {
    const before = was?.glyphs[i].x;
    if (before === undefined) return { ...g, level: null };
    const level = tickerBlurLevel(smearSigma(g.x - before) / (g.axes.scaleX ?? 1));
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
          position: 'absolute', left: 0, top, width: frame.width, height, transform: `translateX(${offset}px)`,
          filter: tickerBoxSmeared(travel) ? `url(#${id}-block)` : undefined,
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

// ---------- drawing ----------

/** A glyph at its own axes, its advance box starting at `x`, sitting on `baseline`. */
function Glyph({ char, axes, x, baseline, size, color, filter }: { char: string; axes: GlyphAxes; x: number; baseline: number; size: number; color: string; filter?: string }) {
  return (
    <span
      style={{
        position: 'absolute', left: 0, top: baseline - ARCHIVO_BASELINE_EM * size, width: TICKER_GLYPH_BOX_EM * size, height: size,
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

/**
 * This band's smears: a horizontal Gaussian per blur level its glyphs and dots use, and a box for the band's own
 * `travel`. A filter region is a share of the element it's on, so each is sized for its element's box.
 */
function BlurFilters({ id, glyphLevels, dot, size, travel }: { id: string; glyphLevels: ReadonlySet<number>; dot: number; size: number; travel: number }) {
  const box = tickerBoxSmeared(travel);
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
      {[...glyphLevels].map((level) => gaussian(`g${level}`, tickerLevelSigma(level), TICKER_GLYPH_BOX_EM * size))}
      {dot > 0 && [...glyphLevels].map((level) => gaussian(`d${level}`, tickerLevelSigma(level), dot))}
      {box && <BoxSmear id={`${id}-block`} travel={travel} />}
    </svg>
  );
}

/** A box smear `travel` px long, centred: each copy blurred by half the gap between copies, so they run together. */
function BoxSmear({ id, travel }: { id: string; travel: number }) {
  const { width } = useVideoFormat();
  const gap = travel / TICKER_BOX_TAPS;
  const pad = (tickerBoxReach(travel) + 4) / width;
  const taps = Array.from({ length: TICKER_BOX_TAPS }, (_, i) => `tap${i}`);
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

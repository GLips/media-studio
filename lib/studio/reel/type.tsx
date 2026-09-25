// Kinetic display type, one word a beat, after the reference's "EVERY FRAME is CODE" bar: letters rising out of a
// line (RiseWord), a weight morph a design tool's selection closes on (WeightWord, SelectionBox), light type turning
// level into a slant (SlantWord), a code-glyph decode with glitch hits (ScrambleText).
//
// None has an exit: each is still from its settle time on, so a scene holds a word by rendering any later `t`, and the
// next word cuts in on its beat with figure and ground swapped. A word is measured once as the browser sets it and
// drawn a letter at a time there, so moving a letter never reflows the word. Fast moves smear under a 1/120 s shutter.

import { Fragment, useId, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useDelayRender } from 'remotion';
import { inflate, type Point, type Rect } from '../camera.ts';
import { DISPLAY_FONT, MONO_FONT } from '../fonts.ts';
import { FULL_FRAME, H, W } from '../frame.ts';
import { clamp, lerp, motionCurves } from '../motion.ts';
import { motionEchoAttrs, pieceMotionAttrs } from '../motion-tag.ts';
import { hashRandom, seededRandom } from '../random.ts';

const outExpo = motionCurves.expo.entrance;
const outQuart = (k: number) => 1 - (1 - clamp(k)) ** 4;
const sineInOut = (k: number) => (1 - Math.cos(Math.PI * clamp(k))) / 2;

/**
 * The reference's shutter, 180° at its 60 fps: its smears are this long, so ours match it frame for frame. Our 30 fps
 * jumps twice as far between frames; 1/60 (180° at 30 fps) smears twice as long and strobes less.
 */
export const REEL_SHUTTER = 1 / 120;

// A Gaussian of σ = 0.312 L has the 10–90% edge ramp (2.563σ) of a box blur L long, which is what an open shutter
// makes of an edge travelling L px.
const smearSigma = (travel: number) => 0.312 * travel;

/**
 * Pixels a position covers while a shutter centred on `t` is open. A move starting at `start` is drawn whole from its
 * first moment, so the shutter opens no earlier: centred on it, half the exposure would see the move not yet begun.
 */
function travelIn(at: (t: number) => number, t: number, shutter: number, start = -Infinity) {
  if (t < start) return 0;
  const open = Math.max(start, t - shutter / 2);
  return Math.abs(at(open + shutter) - at(open));
}

// ---------- setting a word ----------

type Align = 'left' | 'center' | 'right';

/** How a word is set: `cap` is its cap height in frame px (the size a frame shows), `spacing` its tracking in em. */
type Setting = { family: string; cap: number; weight: number; stretch: number; spacing: number };

/** A word as the browser sets it: its font size, each character's advance box (x from the word's start), its width. */
type SetWord = { size: number; chars: readonly { char: string; x: number; w: number }[]; width: number };

// Cap height over the em: Archivo's measures 0.686–0.688 at every weight and width; JetBrains Mono's is 730/1000.
const capOfEm = (family: string) => (family === MONO_FONT ? 0.73 : 0.687);

// No ligatures: one glyph a character, so every letter has a place of its own.
const faceStyle = ({ family, weight, stretch }: Setting, size: number): CSSProperties => ({
  fontFamily: family, fontSize: size, fontWeight: weight, fontStretch: `${stretch}%`, fontKerning: 'normal', fontVariantLigatures: 'none',
});

const SVG_NS = 'http://www.w3.org/2000/svg';
const setWords = new Map<string, SetWord>();
let typeProbe: SVGSVGElement | null = null;

// Measured in a hidden SVG of its own under <body>, so no transform around a piece (the Studio's preview scale, a
// camera) reaches the numbers. SVG counts characters in UTF-16 units: one a character for anything a reel sets.
function measureWord(text: string, setting: Setting): SetWord {
  const size = setting.cap / capOfEm(setting.family);
  const key = JSON.stringify([text, setting.family, size, setting.weight, setting.stretch, setting.spacing]);
  const known = setWords.get(key);
  if (known) return known;
  if (!typeProbe?.isConnected) {
    typeProbe = document.createElementNS(SVG_NS, 'svg');
    typeProbe.setAttribute('style', 'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none');
    document.body.appendChild(typeProbe);
  }
  const el = document.createElementNS(SVG_NS, 'text');
  Object.assign(el.style, faceStyle(setting, size), { fontSize: `${size}px`, letterSpacing: `${setting.spacing}em`, whiteSpace: 'pre' });
  el.textContent = text;
  typeProbe.appendChild(el);
  const chars = [...text].map((char, i) => {
    const x = el.getStartPositionOfChar(i).x;
    return { char, x, w: el.getEndPositionOfChar(i).x - x };
  });
  el.remove();
  const last = chars.at(-1);
  // The word's box ends at its last letter's advance, without the tracking after it.
  const word = { size, chars, width: last ? last.x + last.w - setting.spacing * size : 0 };
  setWords.set(key, word);
  return word;
}

const unquote = (name: string) => name.trim().replace(/^["']|["']$/g, '');
const faceLoaded = (name: string) => [...document.fonts].some((f) => unquote(f.family) === name && f.status === 'loaded');

/**
 * Whether `family`'s first face has loaded, holding the render until it has. fonts.ts adds a face to document.fonts
 * only once it's loaded, so `document.fonts.ready` can resolve before it's there: this polls for the face itself.
 */
function useFaceLoaded(family: string): boolean {
  const name = unquote(family.split(',')[0]);
  const [loaded, setLoaded] = useState(() => faceLoaded(name));
  const { delayRender, continueRender } = useDelayRender();
  useLayoutEffect(() => {
    if (loaded) return;
    if (faceLoaded(name)) {
      setLoaded(true);
      return;
    }
    const handle = delayRender(`loading ${name} to set type`);
    let held = true;
    const release = () => {
      if (held) continueRender(handle);
      held = false;
    };
    const poll = setInterval(() => {
      if (!faceLoaded(name)) return;
      clearInterval(poll);
      flushSync(() => setLoaded(true));
      release();
    }, 16);
    return () => {
      clearInterval(poll);
      release();
    };
  }, [loaded, name]);
  return loaded;
}

const leftOf = (x: number, width: number, align: Align) => (align === 'center' ? x - width / 2 : align === 'right' ? x - width : x);

const layer: CSSProperties = { position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' };

// ---------- index label ----------

const LABEL_CAP = 14;

/**
 * The reference's "(01)" by a word: mono, a 14 px cap (1.3% of frame height), baseline at (x, y), in over 0.06 s. Its
 * colour is drawn as given: the reference's run from its ground's dark at 64% ("(01)") to white.
 */
function IndexLabel({ text, x, y, t, color }: { text: string; x: number; y: number; t: number; color: string }) {
  if (t <= 0) return null;
  return (
    <text x={x} y={y} fill={color} opacity={clamp(t / 0.06)} style={{ fontFamily: MONO_FONT, fontSize: LABEL_CAP / capOfEm(MONO_FONT), fontWeight: 400 }}>
      {text}
    </text>
  );
}

// Where the reference sets a label against the box it names: 6 px in from its left, its baseline 26 px over its top.
const labelAt = (box: Point) => ({ x: box.x + 6, y: box.y - 26 });

// ---------- RiseWord ----------

// The mask and the rule as shares of the cap, from EVERY's 318 px: the mask's edge 13 px under the baseline, the rule
// 12 px thick with its top 34 px under it, drawing from 75 ms after the first letter over 0.33 s.
const RISE_MASK = 0.041;
const RULE_GAP = 0.107;
const RULE_WEIGHT = 0.038;
const RULE_AT = 0.075;
const RULE_TIME = 0.33;

/** `rest` moved along the width axis until its word is `widen` wider. */
function widerSetting(text: string, rest: Setting, widen: number): Setting {
  if (!widen) return rest;
  const width = measureWord(text, rest).width;
  const guess = clamp(rest.stretch * (1 + widen), 62, 125);
  const guessed = measureWord(text, { ...rest, stretch: guess }).width;
  if (guessed === width) return rest;
  // Advance widths run near linear along the axis, so one secant step lands within a pixel or two.
  return { ...rest, stretch: clamp(rest.stretch + ((guess - rest.stretch) * widen * width) / (guessed - width), 62, 125) };
}

/**
 * Letters rising out of a line one after another as the word relaxes from `widen` wider on Archivo's width axis: the
 * reference's EVERY. Each rises on out-expo over `duration`, `each` after the last, smeared while fast. Still from
 * (letters − 1) × each + duration on. Defaults: caps 318 px (29% of frame height), Archivo Black at width 91.3.
 */
export function RiseWord({
  t, text, x = W / 2, y, cap = 318, color = '#15090c', align = 'center', weight = 900, stretch = 91.3, spacing = -0.02,
  duration = 0.4, each = 0.025, rise = 1.045, widen = 0.07, rule = false, label, labelColor = color, shutter = REEL_SHUTTER, motion,
}: {
  /** Seconds since the first letter starts. */
  t: number;
  text: string;
  /** Where `align` puts the word, and its baseline. The default centres the caps in the frame. */
  x?: number;
  y?: number;
  cap?: number;
  color?: string;
  align?: Align;
  weight?: number;
  stretch?: number;
  spacing?: number;
  /** Seconds a letter takes to rise, and between one letter's start and the next's (a space takes no turn). */
  duration?: number;
  each?: number;
  /** How far a letter rises, in caps: 1.045 starts a flat-topped letter just under the mask, 0.041 cap under the baseline. */
  rise?: number;
  /** How much wider than set the word starts. */
  widen?: number;
  /** A rule under the word's box, drawn left to right. */
  rule?: boolean;
  /** An index label, e.g. "(01)", in at 0.1 s over the word's left edge. */
  label?: string;
  labelColor?: string;
  /** Seconds the shutter is open for the smear; 0 for none. */
  shutter?: number;
  motion?: string | false;
}) {
  const id = useId();
  const ready = useFaceLoaded(DISPLAY_FONT);
  if (!ready || t < 0) return null;
  const rest: Setting = { family: DISPLAY_FONT, cap, weight, stretch, spacing };
  const wide = widerSetting(text, rest, widen);
  const [set, wideSet] = [measureWord(text, rest), measureWord(text, wide)];
  const base = y ?? H / 2 + cap / 2;
  const left = leftOf(x, set.width, align), wideLeft = leftOf(x, wideSet.width, align);
  // Both layouts are measured once; between them each letter's place and its glyph's width move together.
  const loose = 1 - outExpo(t / duration);
  const face = faceStyle({ ...rest, stretch: lerp(stretch, wide.stretch, loose) }, set.size);
  const count = set.chars.filter((c) => c.char.trim()).length;
  let turns = 0;
  const letters = set.chars.flatMap((c, i) => {
    if (!c.char.trim()) return [];
    const turn = turns++, start = turn * each;
    // A letter waits unseen for its turn: a round letter's overshoot would peek over the mask.
    if (t < start) return [];
    const lift = (tt: number) => rise * cap * (1 - outExpo((tt - start) / duration));
    return [{
      i, turn, start, char: c.char, x: lerp(left + c.x, wideLeft + wideSet.chars[i].x, loose), dy: lift(t),
      sigma: shutter > 0 ? smearSigma(travelIn(lift, t, shutter, start)) : 0,
    }];
  });
  const settled = Math.max(0, count - 1) * each + duration;

  // The rule's tip is all that moves: a box-blurred edge is a linear ramp as long as its travel.
  const tip = (tt: number) => set.width * outExpo((tt - RULE_AT) / RULE_TIME);
  const ruleTip = tip(t), ruleRamp = shutter > 0 ? travelIn(tip, t, shutter, RULE_AT) : 0;
  const ruleSolid = Math.max(0, ruleTip - ruleRamp / 2), ruleY = base + RULE_GAP * cap;
  return (
    <svg width={W} height={H} style={layer}>
      <defs>
        <clipPath id={`${id}-mask`}>
          <rect x={-W} y={-H} width={3 * W} height={H + base + RISE_MASK * cap} />
        </clipPath>
        {letters.map((c) => c.sigma > 0.25 && (
          <filter key={c.i} id={`${id}-smear${c.i}`} x="-5%" y="-60%" width="110%" height="220%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation={`0 ${c.sigma}`} />
          </filter>
        ))}
        {rule && ruleRamp > 1 && (
          <linearGradient id={`${id}-tip`}>
            <stop offset={0} stopColor={color} />
            <stop offset={1} stopColor={color} stopOpacity={0} />
          </linearGradient>
        )}
      </defs>
      <g {...pieceMotionAttrs(motion, text, { kind: 'rise-word', values: { k: clamp(t / settled) } })} clipPath={`url(#${id}-mask)`} fill={color}>
        {letters.map((c) => (
          <text
            key={c.i}
            {...(motion === false ? {} : pieceMotionAttrs(undefined, `${c.turn} ${c.char}`, {
              kind: 'letter', values: { k: clamp((t - c.start) / duration) }, stagger: { group: 'letters', index: c.turn, count },
            }))}
            x={c.x}
            y={base + c.dy}
            filter={c.sigma > 0.25 ? `url(#${id}-smear${c.i})` : undefined}
            style={face}
          >
            {c.char}
          </text>
        ))}
      </g>
      {rule && ruleTip > 0.5 && (
        <g fill={color}>
          <rect x={left} y={ruleY} width={ruleSolid} height={RULE_WEIGHT * cap} />
          {ruleRamp > 1 && <rect x={left + ruleSolid} y={ruleY} width={ruleRamp} height={RULE_WEIGHT * cap} fill={`url(#${id}-tip)`} />}
        </g>
      )}
      {label && <IndexLabel text={label} {...labelAt({ x: left, y: base - cap })} t={t - 0.1} color={labelColor} />}
    </svg>
  );
}

// ---------- WeightWord ----------

/** A WeightWord's SelectionBox: its padding around the word's cap box in px (0.13 cap by default), look and timing. */
export type WordSelection = { pad?: number; from?: Rect; delay?: number; duration?: number; color?: string; handle?: string; readout?: boolean };

/**
 * A word morphing in place from weight `from` to `to` (and width `stretch` to `stretchTo`): the reference's FRAME, Thin
 * to Black in 0.3 s. Its glyphs widen by themselves about `align`'s anchor; `select` closes a SelectionBox onto the
 * landed word. Still from `duration` on, and its selection from 0.32 s. Defaults: caps 264 px (24% of frame height).
 */
export function WeightWord({
  t, text, x = W / 2, y, cap = 264, color = '#e84a20', align = 'center', from = 100, to = 900, stretch = 85, stretchTo = stretch,
  spacing = 0, duration = 0.3, select = false, label, labelColor = color, motion,
}: {
  /** Seconds since the morph starts. */
  t: number;
  text: string;
  /** Where `align` puts the word, and its baseline. The default centres the caps in the frame. */
  x?: number;
  y?: number;
  cap?: number;
  color?: string;
  align?: Align;
  /** The weights the morph runs between, 100–900. */
  from?: number;
  to?: number;
  stretch?: number;
  stretchTo?: number;
  spacing?: number;
  duration?: number;
  /** A SelectionBox closing onto the word: `true` for the reference's, or its padding, look and timing. */
  select?: boolean | WordSelection;
  /** An index label, e.g. "(02)", in at 0.1 s over the word's (or its selection's) left edge. */
  label?: string;
  labelColor?: string;
  motion?: string | false;
}) {
  const ready = useFaceLoaded(DISPLAY_FONT);
  if (!ready || t < 0) return null;
  const landed: Setting = { family: DISPLAY_FONT, cap, weight: to, stretch: stretchTo, spacing };
  const set = measureWord(text, landed);
  const base = y ?? H / 2 + cap / 2;
  // Out-quart, not out-expo: Archivo's stems thicken faster toward Black, and on this curve they grow as the
  // reference's F does, near linear for eight frames and then easing.
  const k = outQuart(t / duration);
  const setting = { ...landed, weight: lerp(from, to, k), stretch: lerp(stretch, stretchTo, k) };
  // SVG anchors the word's advance, which ends in one more letter's tracking: shift by it so the box stays put.
  const anchorX = x + (align === 'center' ? 0.5 : align === 'right' ? 1 : 0) * spacing * set.size;
  const box = { x: leftOf(x, set.width, align), y: base - cap, w: set.width, h: cap };
  const selection = select === true ? {} : select || null;
  const frame = selection && inflate(box, selection.pad ?? 0.13 * cap);
  return (
    <>
      <svg width={W} height={H} style={layer}>
        <text
          {...pieceMotionAttrs(motion, text, { kind: 'weight-word', values: { weight: setting.weight, stretch: setting.stretch } })}
          x={anchorX}
          y={base}
          fill={color}
          textAnchor={align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'}
          style={{ ...faceStyle(setting, set.size), letterSpacing: `${spacing}em`, whiteSpace: 'pre' }}
        >
          {text}
        </text>
        {label && <IndexLabel text={label} {...(frame ? { x: frame.x + 6, y: frame.y - 23 } : labelAt(box))} t={t - 0.1} color={labelColor} />}
      </svg>
      {selection && frame && (
        <SelectionBox t={t} to={frame} from={selection.from} delay={selection.delay} duration={selection.duration} color={selection.color}
          handle={selection.handle} readout={selection.readout} motion={motion === false ? false : undefined} />
      )}
    </>
  );
}

// ---------- SelectionBox ----------

const HANDLE = 12;
const PILL = { h: 30, gap: 19, size: 15, pad: 17, radius: 4 };

/** The reference's start: the video frame's own edges, just inside so the lines and handles show. */
const FRAME_EDGES = inflate(FULL_FRAME, -10);

const lerpRect = (a: Rect, b: Rect, k: number): Rect => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) });

/**
 * A design tool's selection: a thin rect with square handles at corners and edge midpoints, closing from `from` onto
 * `to` (lines' centres) on out-expo, a pill under it counting its live W × H. Fast edges and handles smear. Still from
 * `delay` + `duration` on. Defaults, the reference's: from the frame's edges, 2 px #3a40f0 lines, 0.3 s.
 */
export function SelectionBox({
  t, to, from = FRAME_EDGES, delay = 1 / 60, duration = 0.3, color = '#3a40f0', handle = '#f2f0ee', readout = true, readoutAt = 0.11,
  shutter = REEL_SHUTTER, motion,
}: {
  /** Seconds since it appears on `from`. */
  t: number;
  to: Rect;
  from?: Rect;
  /** Seconds it sits on `from` before closing: the reference's shows the frame's edges, still, on the cut's frame. */
  delay?: number;
  duration?: number;
  color?: string;
  /** The handles' fill. */
  handle?: string;
  /** The W × H pill, fading in under the box `readoutAt` seconds after it appears. */
  readout?: boolean;
  readoutAt?: number;
  shutter?: number;
  motion?: string | false;
}) {
  if (t < 0) return null;
  const at = (tt: number) => lerpRect(from, to, outExpo((tt - delay) / duration));
  // The shutter's open and close, never before the box starts moving.
  const open = Math.max(delay, t - shutter / 2);
  const r = at(t), [a, b] = t < delay ? [r, r] : [at(open), at(open + shutter)];
  const line = 2;
  // A thin line smeared by a shutter is a band over its travel keeping its ink, as a box blur does.
  const band = (p: number, q: number) => ({ from: Math.min(p, q) - line / 2, size: Math.abs(q - p) + line, alpha: line / (Math.abs(q - p) + line) });
  const edges = [
    { ...band(a.x, b.x), vertical: true }, { ...band(a.x + a.w, b.x + b.w), vertical: true },
    { ...band(a.y, b.y), vertical: false }, { ...band(a.y + a.h, b.y + b.h), vertical: false },
  ];
  const handles = (q: Rect) => [0, 0.5, 1].flatMap((u) => [0, 0.5, 1].filter((v) => u !== 0.5 || v !== 0.5).map((v) => ({ x: q.x + u * q.w, y: q.y + v * q.h })));
  const [ha, hb] = [handles(a), handles(b)];
  const text = `${Math.round(r.w)} × ${Math.round(r.h)}`;
  const pillW = text.length * PILL.size * 0.6 + 2 * PILL.pad;
  const pill = { x: r.x + r.w / 2 - pillW / 2, y: r.y + r.h + PILL.gap, w: pillW };
  const shown = readout ? clamp((t - readoutAt) / 0.035) : 0;
  return (
    <svg width={W} height={H} style={layer}>
      <rect {...pieceMotionAttrs(motion, 'selection', { kind: 'selection-box', values: { k: outExpo((t - delay) / duration) } })} x={r.x} y={r.y} width={r.w} height={r.h} fill="none" />
      {edges.map((e, i) => (
        <rect key={i} fill={color} opacity={e.alpha}
          {...(e.vertical ? { x: e.from, y: r.y, width: e.size, height: r.h } : { x: r.x, y: e.from, width: r.w, height: e.size })} />
      ))}
      {hb.map((p, i) => {
        const q = ha[i], len = Math.hypot(p.x - q.x, p.y - q.y);
        return len < 1
          ? <rect key={i} x={p.x - HANDLE / 2 + 1} y={p.y - HANDLE / 2 + 1} width={HANDLE - 2} height={HANDLE - 2} fill={handle} stroke={color} strokeWidth={2} />
          : <line key={i} x1={q.x} y1={q.y} x2={p.x} y2={p.y} stroke={handle} strokeWidth={HANDLE} strokeLinecap="square" opacity={HANDLE / (HANDLE + len)} />;
      })}
      {shown > 0 && (
        <g opacity={shown}>
          <rect x={pill.x} y={pill.y} width={pill.w} height={PILL.h} rx={PILL.radius} fill={color} />
          <text x={pill.x + pill.w / 2} y={pill.y + PILL.h / 2 + (capOfEm(MONO_FONT) * PILL.size) / 2} textAnchor="middle" fill="#fff"
            style={{ fontFamily: MONO_FONT, fontSize: PILL.size, fontWeight: 500 }}>
            {text}
          </text>
        </g>
      )}
    </svg>
  );
}

// ---------- SlantWord ----------

// Archivo's lowercase stem in ems at weights 100, 200 … 900, measured on the dotless ı: it sizes the drawn tittle.
const ARCHIVO_STEM = [0.048, 0.058, 0.072, 0.088, 0.104, 0.122, 0.139, 0.164, 0.199];
const stemAt = (weight: number) => {
  const f = clamp((weight - 100) / 100, 0, 8), i = Math.min(7, Math.floor(f));
  return lerp(ARCHIVO_STEM[i], ARCHIVO_STEM[i + 1], f - i);
};
// The reference's tittle: round, 1.4 stems across, its centre 0.685 em over the baseline.
const TITTLE_ACROSS = 1.4;
const TITTLE_HEIGHT = 0.685;
// Where a slanted word's label starts, in em from its box's slanted foot: Archivo's lowercase side bearing, less the
// 11 px the reference sets its "(03)" left of the i's foot.
const SLANT_LABEL_IN = 0.036;

type Matrix = [number, number, number, number, number, number];
const multiply = ([a, b, c, d, e, f]: Matrix, [g, h, i, j, k, l]: Matrix): Matrix =>
  [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
const apply = ([a, b, c, d, e, f]: Matrix, x: number, y: number): Point => ({ x: a * x + c * y + e, y: b * x + d * y + f });

type SlantPose = { scale: number; turn: number; slant: number };

/** A word's transform about `origin`: scaled and turned (degrees), then slanted forward in screen space. */
function slantMatrix(origin: Point, { scale, turn, slant }: SlantPose): Matrix {
  const r = (turn * Math.PI) / 180, cos = Math.cos(r) * scale, sin = Math.sin(r) * scale;
  const skew: Matrix = [1, 0, -Math.tan((slant * Math.PI) / 180), 1, 0, 0];
  return multiply(multiply(multiply([1, 0, 0, 1, origin.x, origin.y], skew), [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -origin.x, -origin.y]);
}

/** An i's tittle as a SlantWord draws it: centre and radius in frame px, the shape a FieldSwell grows from. */
export type Tittle = { x: number; y: number; r: number };

/**
 * Light type entering big and turned, levelling as it slants: the reference's "is". Scale settles on out-expo, turn on
 * a sine, slant last, over the second half of `slantDuration`. An i's tittle is a round dot riding the slant. Still
 * from the longest duration on. Defaults: caps 420 px (39% of frame height), Archivo 200.
 */
export function SlantWord({
  t, text, x = W / 2, y, cap = 420, color = '#464bf5', align = 'center', weight = 200, stretch = 100, spacing = 0,
  scale = 1.5, duration = 0.3, turn = -18, turnDuration = 0.12, slant = 15.5, slantFrom = 13, slantDuration = 0.17,
  label, labelColor = color, tittle, shutter = REEL_SHUTTER, motion,
}: {
  /** Seconds since it enters. */
  t: number;
  text: string;
  /** Where `align` puts the word, and its baseline. The default centres the caps in the frame. */
  x?: number;
  y?: number;
  cap?: number;
  color?: string;
  align?: Align;
  weight?: number;
  stretch?: number;
  spacing?: number;
  /** Its size on entering, settling to 1 over `duration`. */
  scale?: number;
  duration?: number;
  /** Degrees it enters turned (negative is anticlockwise), level after `turnDuration`. */
  turn?: number;
  turnDuration?: number;
  /** Degrees it leans forward at rest, and on entering. */
  slant?: number;
  slantFrom?: number;
  slantDuration?: number;
  /** An index label, e.g. "(03)", in at 0.08 s over the word's resting top left. */
  label?: string;
  labelColor?: string;
  /**
   * Draws in place of each i's tittle, given where the word has it: return a node to replace the dot, e.g.
   * `(dot) => t >= at && <FieldSwell from={dot} … />` to zoom through it into the next ground, or nothing to keep it.
   */
  tittle?: (dot: Tittle) => ReactNode;
  shutter?: number;
  motion?: string | false;
}) {
  const id = useId();
  const ready = useFaceLoaded(DISPLAY_FONT);
  if (!ready || t < 0) return null;
  const setting: Setting = { family: DISPLAY_FONT, cap, weight, stretch, spacing };
  // Set dotless, so each tittle can be drawn round on top of the slant and be a zoom's anchor.
  const shown = text.replaceAll('i', 'ı');
  const set = measureWord(shown, setting);
  const base = y ?? H / 2 + cap / 2;
  const left = leftOf(x, set.width, align);
  const origin = { x: left + set.width / 2, y: base - cap / 2 };
  const poseAt = (tt: number): SlantPose => ({
    scale: lerp(scale, 1, outExpo(tt / duration)),
    turn: turn * (1 - sineInOut(tt / turnDuration)),
    slant: lerp(slantFrom, slant, sineInOut((2 * tt) / slantDuration - 1)),
  });
  const pose = poseAt(t), m = slantMatrix(origin, pose);
  // A zoom and a turn smear every way: the farthest-travelling corner sets one even blur, halved as the edges mostly
  // move along themselves. The shutter opens no earlier than the entrance, as travelIn's does.
  const open = Math.max(0, t - shutter / 2);
  const [m0, m1] = [slantMatrix(origin, poseAt(open)), slantMatrix(origin, poseAt(open + shutter))];
  const corners = [[left, base - cap], [left + set.width, base - cap], [left, base], [left + set.width, base]] as const;
  const travel = shutter > 0 ? Math.max(...corners.map(([cx, cy]) => {
    const p = apply(m0, cx, cy), q = apply(m1, cx, cy);
    return Math.hypot(q.x - p.x, q.y - p.y);
  })) : 0;
  const sigma = smearSigma(travel) / 2;
  const radius = (TITTLE_ACROSS / 2) * stemAt(weight) * set.size;
  const dotsAt = (mm: Matrix, s: number) => set.chars.flatMap((c, i) => (text[i] === 'i'
    ? [{ ...apply(mm, left + c.x + (c.w - spacing * set.size) / 2, base - TITTLE_HEIGHT * set.size), r: radius * s }]
    : []));
  const dots = dotsAt(m, pose.scale).map((d) => ({ ...d, swap: tittle?.(d) }));
  const swapped = (node: ReactNode) => node != null && node !== false;
  // The label sits by the word at rest, not riding its entrance: over the ink's top, by the slanted word's foot.
  const still = slantMatrix(origin, { scale: 1, turn: 0, slant });
  const inkTop = Math.min(base - cap, ...dotsAt(still, 1).map((d) => d.y - d.r));
  const foot = apply(still, left, base).x + SLANT_LABEL_IN * set.size;
  return (
    <>
      <svg width={W} height={H} style={layer}>
        {sigma > 0.25 && (
          <filter id={`${id}-smear`} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation={sigma} />
          </filter>
        )}
        <g {...pieceMotionAttrs(motion, text, { kind: 'slant-word', values: pose })} filter={sigma > 0.25 ? `url(#${id}-smear)` : undefined} fill={color}>
          <text x={left} y={base} transform={`matrix(${m.join(' ')})`} style={{ ...faceStyle(setting, set.size), letterSpacing: `${spacing}em`, whiteSpace: 'pre' }}>
            {shown}
          </text>
          {dots.map((d, i) => !swapped(d.swap) && <circle key={i} cx={d.x} cy={d.y} r={d.r} />)}
        </g>
        {label && <IndexLabel text={label} {...labelAt({ x: foot, y: inkTop })} t={t - 0.08} color={labelColor} />}
      </svg>
      {dots.map((d, i) => swapped(d.swap) && <Fragment key={i}>{d.swap}</Fragment>)}
    </>
  );
}

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
function glitchAt(t: number, hits: readonly number[], peak: number, seed: string | number, cap: number): Glitch | null {
  const sorted = [...hits].sort((p, q) => p - q);
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

// An RGB split over whatever is behind, in four blended passes. Per channel, a multiply by white with that channel
// zeroed scales it by 1 − the copy's alpha; a plus-lighter then adds the copy's channel times its alpha: plain "over",
// so a half-clear ghost lands true. Red comes from one copy, green and blue from the other.
const SPLIT_PASSES = [
  { side: 1, blend: 'multiply', matrix: '0 0 0 0 0  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0' },
  { side: 1, blend: 'plus-lighter', matrix: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0' },
  { side: -1, blend: 'multiply', matrix: '0 0 0 0 1  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0' },
  { side: -1, blend: 'plus-lighter', matrix: '0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0' },
] as const;

/**
 * Characters decoding from code glyphs into `text` left to right, glitch hits splitting its colour channels, slicing
 * it and leaving a ghost: the reference's CODE, or a HUD label's decode (`mono`). A scrambled glyph centres on its
 * letter's place. Still once all letters lock and 0.09 s past the last hit. Defaults: caps 306 px (28% of frame height).
 */
export function ScrambleText({
  t, text, x = W / 2, y, cap = 306, color = '#f3f0e7', align = 'center', mono = false, weight, stretch, spacing,
  seed = text, charset, delay, each, rate, hits = [], split = 13, cursor, label, labelColor = color, motion,
}: {
  /** Seconds since the scramble starts. */
  t: number;
  text: string;
  /** Where `align` puts the text, and its baseline. The default centres the caps in the frame. */
  x?: number;
  y?: number;
  cap?: number;
  color?: string;
  align?: Align;
  /** Set in MONO_FONT (weight 500) rather than Archivo Black at width 62. */
  mono?: boolean;
  weight?: number;
  stretch?: number;
  spacing?: number;
  seed?: string | number;
  charset?: string;
  delay?: number;
  each?: number;
  rate?: number;
  /** Seconds after `t` 0 that glitch hits land: the reference's three 16ths are `[0, 1, 2].map((n) => (n * spb) / 4)`. */
  hits?: readonly number[];
  /** A hit's colour split in px, the red channel one way and green and blue the other. */
  split?: number;
  /** A block cursor after the text in this colour, flickering through the glitch. */
  cursor?: string;
  /** An index label, e.g. "(04)", in with the scramble and taking its glitch. */
  label?: string;
  labelColor?: string;
  motion?: string | false;
}) {
  const id = useId();
  const setting: Setting = mono
    ? { family: MONO_FONT, cap, weight: weight ?? 500, stretch: 100, spacing: spacing ?? 0 }
    : { family: DISPLAY_FONT, cap, weight: weight ?? 900, stretch: stretch ?? 62, spacing: spacing ?? -0.02 };
  const ready = useFaceLoaded(setting.family);
  if (!ready || t < 0) return null;
  const set = measureWord(text, setting);
  const base = y ?? H / 2 + cap / 2;
  const left = leftOf(x, set.width, align);
  const timing = { seed, charset, delay, each, rate };
  const glitch = glitchAt(t, hits, split, seed, cap);
  const settled = !glitch && t >= scrambleFinish(text, { delay, each });
  const cursorOn = cursor && (settled || hashRandom(seed, 'cursor', Math.floor(t * 60 + 1e-6)) < 0.5);
  const face = faceStyle(setting, set.size);
  const tracking = setting.spacing * set.size;
  const drawAt = (tt: number) => (
    <>
      {scrambleAt(text, tt, timing).map((s, i) => {
        const c = set.chars[i];
        if (!s.char.trim()) return null;
        return s.locked
          ? <text key={i} x={left + c.x} y={base} style={face}>{s.char}</text>
          : <text key={i} x={left + c.x + (c.w - tracking) / 2} y={base} textAnchor="middle" style={face}>{s.char}</text>;
      })}
      {cursorOn && <rect x={left + set.width + 0.1 * cap} y={base - cap} width={0.22 * cap} height={cap} fill={cursor} />}
      {label && <IndexLabel text={label} {...labelAt({ x: left, y: base - cap })} t={tt} color={labelColor} />}
    </>
  );
  const shown = scrambleAt(text, t, timing);
  const tag = pieceMotionAttrs(motion, text, {
    kind: 'scramble-text', values: { locked: shown.filter((s) => s.locked).length / Math.max(1, shown.length), split: glitch?.split ?? 0 },
  });
  if (!glitch) {
    return (
      <svg width={W} height={H} style={layer}>
        <g {...tag} fill={color}>{drawAt(t)}</g>
      </svg>
    );
  }
  const bands = glitch.slices;
  // The ghost is the frame before, as a video's echo is.
  const copies = (main: Record<string, string>) => (
    <>
      {glitch.ghost && <g {...motionEchoAttrs} opacity={0.5} transform={`translate(${glitch.ghost.x} ${glitch.ghost.y})`}>{drawAt(t - 1 / 30)}</g>}
      <g {...main} clipPath={bands.length ? `url(#${id}-rest)` : undefined}>{drawAt(t)}</g>
      {bands.map((s, i) => (
        <g key={i} {...motionEchoAttrs} clipPath={`url(#${id}-band${i})`}>
          <g transform={`translate(${s.dx} 0)`}>{drawAt(t)}</g>
        </g>
      ))}
    </>
  );
  return (
    <>
      {SPLIT_PASSES.map((pass, n) => (
        <svg key={n} width={W} height={H} style={{ ...layer, mixBlendMode: pass.blend }}>
          <defs>
            <filter id={`${id}-pass${n}`} colorInterpolationFilters="sRGB">
              <feColorMatrix values={pass.matrix} />
            </filter>
            {n === 0 && bands.length > 0 && (
              <clipPath id={`${id}-rest`}>
                <path clipRule="evenodd" d={`M${-W} ${-H}H${2 * W}V${2 * H}H${-W}Z${bands.map((s) => `M${-W} ${base + s.y}H${2 * W}v${s.h}H${-W}Z`).join('')}`} />
              </clipPath>
            )}
            {n === 0 && bands.map((s, i) => (
              <clipPath key={i} id={`${id}-band${i}`}>
                <rect x={-W} y={base + s.y} width={3 * W} height={s.h} />
              </clipPath>
            ))}
          </defs>
          {/* Only the last pass carries the tag; the others are copies for the look. */}
          <g {...(n < SPLIT_PASSES.length - 1 ? motionEchoAttrs : {})} filter={`url(#${id}-pass${n})`} fill={color} transform={`translate(${(pass.side * glitch.split) / 2} 0)`}>
            {copies(n === SPLIT_PASSES.length - 1 ? tag : {})}
          </g>
        </svg>
      ))}
    </>
  );
}

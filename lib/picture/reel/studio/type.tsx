// Kinetic display type, one word a beat, after the reference's "EVERY FRAME is CODE" bar: letters rising out of a
// line (RiseWord), a weight morph a design tool's selection closes on (WeightWord, SelectionBox), light type turning
// level into a slant (SlantWord), a code-glyph decode with glitch hits (ScrambleText).
//
// None has an exit: each is still from its settle time on, so a scene holds a word by rendering any later `t`, and the
// next word cuts in on its beat with figure and ground swapped. A word is measured once as the browser sets it and
// drawn a letter at a time there, so moving a letter never reflows it.
//
// SlantWord and ScrambleText live in type-slant.tsx and type-scramble.tsx.

import { useId } from 'react';
import { inflate, type Rect } from '#lib/picture/camera/models/camera.ts';
import { useStudioFontsReady } from '#lib/picture/type/studio/fonts.ts';
import { DISPLAY_FONT, MONO_ADVANCE_EM, MONO_CAP_EM, MONO_FONT } from '#lib/picture/type/models/faces.ts';
import { clamp, lerp, motionCurves, powerOutEase } from '#lib/picture/motion/models/motion.ts';
import { REEL_SHUTTER, shutterOpensAt, shutterTravel, smearSigma } from '#lib/picture/motion/models/shutter.ts';
import { useVideoFormat } from '#lib/picture/composition/studio/video-format.ts';
import { pieceMotionAttrs } from '#lib/output/look/studio/motion-tag.ts';
import { frameEdgesRect, labelAt, leftOf, lerpRect, type Align, type Setting } from '../models/type.ts';
import { faceStyle, layer, measureWord, widerSetting } from './type-measure.ts';

const outExpo = motionCurves.expo.entrance;
const outQuart = powerOutEase(4);

// ---------- index label ----------

const LABEL_CAP = 14;

/**
 * The reference's "(01)" by a word: mono, a 14 px cap (1.3% of frame height), baseline at (x, y), in over 0.06 s. Its
 * colour is drawn as given: the reference's run from its ground's dark at 64% ("(01)") to white. An SVG `<text>`, for
 * inside an `<svg>`: the pieces draw it in their own.
 */
export function IndexLabel({ text, x, y, t, color }: { text: string; x: number; y: number; t: number; color: string }) {
  if (t <= 0) return null;
  return (
    <text x={x} y={y} fill={color} opacity={clamp(t / 0.06)} style={{ fontFamily: MONO_FONT, fontSize: LABEL_CAP / MONO_CAP_EM, fontWeight: 400 }}>
      {text}
    </text>
  );
}

// ---------- RiseWord ----------

// The mask and the rule as shares of the cap, from EVERY's 318 px: the mask's edge 13 px under the baseline, the rule
// 12 px thick with its top 34 px under it, drawing from 75 ms after the first letter over 0.33 s.
const RISE_MASK = 0.041;
const RULE_GAP = 0.107;
const RULE_WEIGHT = 0.038;
const RULE_AT = 0.075;
const RULE_TIME = 0.33;

/**
 * Letters rising out of a line one after another as the word relaxes from `widen` wider on Archivo's width axis: the
 * reference's EVERY. Each rises on out-expo over `duration`, `each` after the last, smeared while fast. Still from
 * (letters − 1) × each + duration on. Defaults: caps 318 px (29% of frame height), Archivo Black at width 91.3.
 */
export function RiseWord({
  t, text, x: givenX, y, cap = 318, color = '#15090c', align = 'center', weight = 900, stretch = 91.3, spacing = -0.02,
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
  const ready = useStudioFontsReady();
  const { width, height } = useVideoFormat(), x = givenX ?? width / 2;
  if (!ready || t < 0) return null;
  const rest: Setting = { family: DISPLAY_FONT, cap, weight, stretch, spacing };
  const wide = widerSetting(text, rest, widen);
  const [set, wideSet] = [measureWord(text, rest), measureWord(text, wide)];
  const base = y ?? height / 2 + cap / 2;
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
      sigma: shutter > 0 ? smearSigma(shutterTravel(lift, t, shutter, start)) : 0,
    }];
  });
  const settled = Math.max(0, count - 1) * each + duration;

  // The rule's tip is all that moves: a box-blurred edge is a linear ramp as long as its travel.
  const tip = (tt: number) => set.width * outExpo((tt - RULE_AT) / RULE_TIME);
  const ruleTip = tip(t), ruleRamp = shutter > 0 ? shutterTravel(tip, t, shutter, RULE_AT) : 0;
  const ruleSolid = Math.max(0, ruleTip - ruleRamp / 2), ruleY = base + RULE_GAP * cap;
  return (
    <svg width={width} height={height} style={layer}>
      <defs>
        <clipPath id={`${id}-mask`}>
          <rect x={-width} y={-height} width={3 * width} height={height + base + RISE_MASK * cap} />
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
  t, text, x: givenX, y, cap = 264, color = '#e84a20', align = 'center', from = 100, to = 900, stretch = 85, stretchTo = stretch,
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
  const ready = useStudioFontsReady();
  const { width, height } = useVideoFormat(), x = givenX ?? width / 2;
  if (!ready || t < 0) return null;
  const landed: Setting = { family: DISPLAY_FONT, cap, weight: to, stretch: stretchTo, spacing };
  const set = measureWord(text, landed);
  const base = y ?? height / 2 + cap / 2;
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
      <svg width={width} height={height} style={layer}>
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

/**
 * A design tool's selection: a thin rect with square handles at corners and edge midpoints, closing from `from` onto
 * `to` (lines' centres) on out-expo, a pill under it counting its live W × H. Fast edges and handles smear. Still from
 * `delay` + `duration` on. Defaults, the reference's: from the frame's edges, 2 px #3a40f0 lines, 0.3 s.
 */
export function SelectionBox({
  t, to, from: givenFrom, delay = 1 / 60, duration = 0.3, color = '#3a40f0', handle = '#f2f0ee', readout = true, readoutAt = 0.11,
  readoutColor = '#fff', shutter = REEL_SHUTTER, motion,
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
  /** The pill's figures, on `color`: the default white is unreadable on a light box. */
  readoutColor?: string;
  shutter?: number;
  motion?: string | false;
}) {
  const { width, height } = useVideoFormat(), from = givenFrom ?? frameEdgesRect({ width, height });
  if (t < 0) return null;
  const at = (tt: number) => lerpRect(from, to, outExpo((tt - delay) / duration));
  // The shutter's open and close, never before the box starts moving.
  const open = shutterOpensAt(t, shutter, delay);
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
  const pillW = text.length * PILL.size * MONO_ADVANCE_EM + 2 * PILL.pad;
  const pill = { x: r.x + r.w / 2 - pillW / 2, y: r.y + r.h + PILL.gap, w: pillW };
  const shown = readout ? clamp((t - readoutAt) / 0.035) : 0;
  return (
    <svg width={width} height={height} style={layer}>
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
          <text x={pill.x + pill.w / 2} y={pill.y + PILL.h / 2 + (MONO_CAP_EM * PILL.size) / 2} textAnchor="middle" fill={readoutColor}
            style={{ fontFamily: MONO_FONT, fontSize: PILL.size, fontWeight: 500 }}>
            {text}
          </text>
        </g>
      )}
    </svg>
  );
}

// ticker-layout.ts: lines of Archivo whose every glyph sits at its own weight and width, laid out without the DOM.
// CSS sets a letter's axes but can't say where the next letter goes, and scaleX doesn't reflow, so a word whose
// letters breathe needs each glyph's advance at its own axes, known before anything renders so a frame renders alone.
// archivo-metrics.ts holds Archivo's advances and kerning at its masters; between them the font is bilinear, so the
// interpolation here is exact. Runs without a browser.

import { ARCHIVO_METRICS } from '#models/type/archivo-metrics.ts';

type AxisMetrics = {
  min: number;
  default: number;
  max: number;
  /** The font's avar: fvar-normalised coordinates to the ones its masters sit at, as [from, to] points. */
  avar: readonly (readonly [number, number])[];
  /** Normalised coordinates where a variation region starts, peaks or ends: the masters the table samples. */
  stops: readonly number[];
};

/** A variable font's metrics at its masters, as archivo-metrics.py writes them; values are font units. */
export type VariableFontMetrics = {
  unitsPerEm: number;
  capHeight: number;
  ascender: number;
  descender: number;
  axes: { wght: AxisMetrics; wdth: AxisMetrics };
  /** Each character's advance at every combination of the stops, weight-major. */
  advance: Readonly<Record<string, readonly number[]>>;
  /** For each pair that kerns anywhere, how far kerning moves the second character, at the same masters. */
  kern: Readonly<Record<string, readonly number[]>>;
};

/**
 * Where a glyph sits in Archivo's design space: `wght` 100–900 and `wdth` 62–125 (%), as CSS's fontWeight and
 * fontStretch. `scaleX` squeezes it further as a transform, past the font's 62% floor; its advance scales with it.
 */
export type GlyphAxes = { wght: number; wdth: number; scaleX?: number };

const METRICS = ARCHIVO_METRICS;
const EM = METRICS.unitsPerEm;

/** Archivo's cap height in em, the same at every weight and width: font size = cap height / ARCHIVO_CAP_EM. */
export const ARCHIVO_CAP_EM = METRICS.capHeight / EM;

/**
 * Where CSS puts Archivo's baseline in a line box one em tall, in em from its top: the ascent and descent (0.878 +
 * 0.21) centred in the box.
 */
export const ARCHIVO_BASELINE_EM = (1 + (METRICS.ascender + METRICS.descender) / EM) / 2;

/** Archivo's advance for `char` at `axes`, in em, scaleX included. Throws for a character the table doesn't cover. */
export function archivoAdvance(char: string, axes: GlyphAxes): number {
  const values = METRICS.advance[char];
  if (!values) throw new Error(`Archivo's advance table has no ${JSON.stringify(char)}: add it to CHARS in lib/models/type/archivo-metrics.py and run it`);
  return (valueAt(values, cellOf(axes)) / EM) * (axes.scaleX ?? 1);
}

/** How far Archivo's kerning moves `right` after `left`, in em at `axes`, scaleX included: 0 for a pair that doesn't kern. */
export function archivoKern(left: string, right: string, axes: GlyphAxes): number {
  const values = METRICS.kern[left + right];
  return values ? (valueAt(values, cellOf(axes)) / EM) * (axes.scaleX ?? 1) : 0;
}

/**
 * One place along a line: a character at its own axes, with `tracking` em added before the next character, or a
 * `blank` px wide for something drawn there (a dot, a number, a gap). Tracking and kerning stop at a blank, and
 * tracking at a word space.
 */
export type GlyphLineSlot = { char: string; axes: GlyphAxes; tracking?: number } | { blank: number };

/** A laid-out line: each slot's left edge from the line's start and its own advance, and the whole line's width, px. */
export type GlyphLine = { x: number[]; advance: number[]; width: number };

/**
 * Lays a line of Archivo out at `size` px, each glyph at its own axes. A pair is kerned at the mean of its two
 * glyphs' axes, so a light letter beside a bold one sits as the font would set them if both met halfway.
 */
export function layoutGlyphLine(slots: readonly GlyphLineSlot[], size: number): GlyphLine {
  const x: number[] = [], advance: number[] = [];
  let pen = 0;
  slots.forEach((slot, i) => {
    x.push(pen);
    if ('blank' in slot) {
      advance.push(slot.blank);
      pen += slot.blank;
      return;
    }
    const own = archivoAdvance(slot.char, slot.axes) * size;
    advance.push(own);
    pen += own;
    const next = slots[i + 1];
    if (next && 'char' in next) pen += (archivoKern(slot.char, next.char, midAxes(slot.axes, next.axes)) + letterTracking(slot.char, next.char, slot.tracking ?? 0)) * size;
  });
  return { x, advance, width: pen };
}

// Tracking is letter-spacing: a word space keeps its own width, or the tight end of a breath closes "BUY MORE" up.
const letterTracking = (char: string, next: string, tracking: number) => (char === ' ' || next === ' ' ? 0 : tracking);

// ---------- a ticker row ----------

/** A glyph's axes and the `tracking` in em set after it. */
export type GlyphPose = { wght: number; wdth: number; scaleX: number; tracking: number };

/**
 * One end of a ticker's breath: a glyph pose, and `dot`, the width in em of the slot a separator dot sits centred in,
 * so the gap around the dot opens and closes with its neighbours.
 */
export type TickerPose = GlyphPose & { dot: number };

/** How a row breathes: every slot on one sinusoid of `period` seconds, each `lag` seconds behind the one to its left. */
export type TickerBreath = { period: number; lag: number };

/** A slot of a laid-out row: which one (`index` counts from the row's origin, `unit` within the repeat), and where. */
export type TickerSlot = {
  index: number;
  unit: number;
  /** Its character, or null for the separator dot. */
  char: string | null;
  /** Left edge along the band, and advance, px. */
  x: number;
  advance: number;
  /** Where it is in the breath: 0 light, 1 bold. */
  k: number;
  axes: GlyphAxes;
};

/** A repeating row's content and look: what repeats (`null` for the dot), at what size, breathing between two poses. */
export type TickerRowStyle = {
  unit: readonly (string | null)[];
  size: number;
  breath: TickerBreath;
  light: TickerPose;
  bold: TickerPose;
  /** Where this row's breath starts, in cycles: rows with their own phase don't breathe in step. */
  phase: number;
};

/** A slot's breath value at `t`: the rightward lag is what sends a bold wave travelling along the row. */
export const tickerBreathAt = (t: number, index: number, { period, lag }: TickerBreath, phase: number) =>
  0.5 - 0.5 * Math.cos(2 * Math.PI * ((t - index * lag) / period + phase));

/** `a` at 0, `b` at 1: every axis and the tracking move together. */
export const mixGlyphPose = (a: GlyphPose, b: GlyphPose, k: number): GlyphPose => ({
  wght: a.wght + (b.wght - a.wght) * k,
  wdth: a.wdth + (b.wdth - a.wdth) * k,
  scaleX: a.scaleX + (b.scaleX - a.scaleX) * k,
  tracking: a.tracking + (b.tracking - a.tracking) * k,
});

const tickerPoseAt = (light: TickerPose, bold: TickerPose, k: number): TickerPose => ({
  ...mixGlyphPose(light, bold, k),
  dot: light.dot + (bold.dot - light.dot) * k,
});

/**
 * The slots of an endless repeating row that cover `from`–`to` px along its band at `t`, each glyph at its own point
 * in the breath and every slot pushed along by the widths before it. `offset` is where slot 0 would rest: the drift.
 *
 * Laid from any one slot, the row would sway as a whole with the breath around that slot. Instead the row keeps its
 * mean displacement at zero over a window `anchor` px either side of `centre` (Hann-weighted, so slots slide in and
 * out of it smoothly): neighbours move in opposite directions and the drift reads linear, as the reference's. Keep
 * `centre` fixed on the band while `from`–`to` changes, or the row shifts with it.
 */
export function layoutTickerRow(t: number, style: TickerRowStyle, { offset, from, to, centre = (from + to) / 2, anchor = to - from }: {
  offset: number;
  from: number;
  to: number;
  centre?: number;
  anchor?: number;
}): TickerSlot[] {
  const { unit, size, breath, light, bold, phase } = style;
  const n = unit.length;
  const rest = restSteps(style);
  const unitLength = rest.reduce((a, b) => a + b, 0);
  const restPrefix = [0];
  for (const step of rest) restPrefix.push(restPrefix[restPrefix.length - 1] + step);
  const restAt = (index: number) => {
    const u = mod(index, n);
    return ((index - u) / n) * unitLength + restPrefix[u] + offset;
  };

  // The breath moves a slot a fraction of a unit either way; a unit and a half of margin covers it.
  const lo = Math.min(from, centre - anchor) - 1.5 * unitLength, hi = Math.max(to, centre + anchor) + 1.5 * unitLength;
  let first = Math.floor((lo - offset) / unitLength) * n;
  while (restAt(first + 1) <= lo) first++;
  let last = first;
  while (restAt(last) < hi) last++;

  const k: number[] = [], pose: TickerPose[] = [];
  for (let index = first; index <= last + 1; index++) {
    const kk = tickerBreathAt(t, index, breath, phase);
    k.push(kk);
    pose.push(tickerPoseAt(light, bold, kk));
  }
  const slots: TickerSlot[] = [];
  let pen = 0, weighted = 0, weights = 0;
  for (let index = first; index <= last; index++) {
    const i = index - first;
    const u = mod(index, n);
    const char = unit[u], next = unit[mod(index + 1, n)];
    const axes = { wght: pose[i].wght, wdth: pose[i].wdth, scaleX: pose[i].scaleX };
    const advance = (char === null ? pose[i].dot : archivoAdvance(char, axes)) * size;
    const step = char === null || next === null ? advance : advance + (archivoKern(char, next, midAxes(axes, pose[i + 1])) + letterTracking(char, next, pose[i].tracking)) * size;
    const restX = restAt(index);
    const displaced = pen - (restX - restAt(first));
    const w = hann((restX - centre) / anchor);
    weighted += w * displaced;
    weights += w;
    slots.push({ index, unit: u, char, x: restX + displaced, advance, k: k[i], axes });
    pen += step;
  }
  const sway = weights > 0 ? weighted / weights : 0;
  for (const slot of slots) slot.x -= sway;
  return slots.filter((s) => s.x + s.advance >= from && s.x <= to);
}

/** Each unit slot's mean step over a breath cycle, advance plus kerning and tracking: the row's rest spacing. */
function restSteps({ unit, size, light, bold }: TickerRowStyle): number[] {
  const key = `${unit.map((c) => c ?? '\u0000').join('')}|${size}|${JSON.stringify(light)}|${JSON.stringify(bold)}`;
  const known = restStepCache.get(key);
  if (known) return known;
  const samples = 24;
  const steps = unit.map(() => 0);
  for (let s = 0; s < samples; s++) {
    const pose = tickerPoseAt(light, bold, 0.5 - 0.5 * Math.cos((2 * Math.PI * (s + 0.5)) / samples));
    const axes = { wght: pose.wght, wdth: pose.wdth, scaleX: pose.scaleX };
    unit.forEach((char, u) => {
      const next = unit[(u + 1) % unit.length];
      const advance = char === null ? pose.dot : archivoAdvance(char, axes);
      steps[u] += ((char === null || next === null ? advance : advance + archivoKern(char, next, axes) + letterTracking(char, next, pose.tracking)) * size) / samples;
    });
  }
  restStepCache.set(key, steps);
  return steps;
}
const restStepCache = new Map<string, number[]>();

// ---------- interpolation ----------

type Cell = { w: number; fw: number; d: number; fd: number };

function cellOf({ wght, wdth }: GlyphAxes): Cell {
  const [w, fw] = locate(METRICS.axes.wght, wght);
  const [d, fd] = locate(METRICS.axes.wdth, wdth);
  return { w, fw, d, fd };
}

/** A user value's stop below it on the axis, and how far it is from there to the next stop. */
function locate(axis: AxisMetrics, user: number): [number, number] {
  const n = normalise(axis, user);
  const stops = axis.stops;
  let i = 0;
  while (i < stops.length - 2 && n > stops[i + 1]) i++;
  return [i, (n - stops[i]) / (stops[i + 1] - stops[i])];
}

/** fvar's normalisation (clamped to the axis), then avar's piecewise-linear map, as a font engine does. */
function normalise(axis: AxisMetrics, user: number): number {
  const v = Math.min(axis.max, Math.max(axis.min, user));
  const n = v < axis.default ? (v - axis.default) / (axis.default - axis.min) : v > axis.default ? (v - axis.default) / (axis.max - axis.default) : 0;
  const map = axis.avar;
  for (let i = 1; i < map.length; i++) {
    const [x0, y0] = map[i - 1], [x1, y1] = map[i];
    if (n <= x1) return y0 + ((y1 - y0) * (n - x0)) / (x1 - x0);
  }
  return n;
}

function valueAt(values: readonly number[], { w, fw, d, fd }: Cell): number {
  const cols = METRICS.axes.wdth.stops.length;
  const at = (i: number, j: number) => values[i * cols + j];
  return (1 - fw) * ((1 - fd) * at(w, d) + fd * at(w, d + 1)) + fw * ((1 - fd) * at(w + 1, d) + fd * at(w + 1, d + 1));
}

const midAxes = (a: GlyphAxes, b: GlyphAxes): GlyphAxes => ({
  wght: (a.wght + b.wght) / 2,
  wdth: (a.wdth + b.wdth) / 2,
  scaleX: ((a.scaleX ?? 1) + (b.scaleX ?? 1)) / 2,
});

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** 1 at the middle of a window running −1..1, falling to 0 at its ends. */
const hann = (u: number) => (Math.abs(u) >= 1 ? 0 : Math.cos((Math.PI / 2) * u) ** 2);

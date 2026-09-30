// glyph-layout.ts: lines of Archivo whose every glyph sits at its own weight and width, laid out without the DOM.
// CSS sets a letter's axes but can't say where the next letter goes, and scaleX doesn't reflow, so a word whose
// letters breathe needs each glyph's advance at its own axes, known before anything renders so a frame renders alone.
// archivo-metrics.ts holds Archivo's advances and kerning at its masters; between them the font is bilinear, so the
// interpolation here is exact. Runs without a browser.

import { ARCHIVO_METRICS } from './archivo-metrics.ts';

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
  if (!values) throw new Error(`Archivo's advance table has no ${JSON.stringify(char)}: add it to CHARS in lib/picture/type/models/archivo-metrics.py and run it`);
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
    if (next && 'char' in next) pen += (archivoKern(slot.char, next.char, midGlyphAxes(slot.axes, next.axes)) + letterTracking(slot.char, next.char, slot.tracking ?? 0)) * size;
  });
  return { x, advance, width: pen };
}

// Tracking is letter-spacing: a word space keeps its own width, or the tight end of a breath closes "BUY MORE" up.
export const letterTracking = (char: string, next: string, tracking: number) => (char === ' ' || next === ' ' ? 0 : tracking);

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
  const span = v < axis.default ? axis.default - axis.min : axis.max - axis.default;
  const n = v === axis.default ? 0 : (v - axis.default) / span;
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

/** Halfway between two glyphs' axes, where a pair of them is kerned. */
export const midGlyphAxes = (a: GlyphAxes, b: GlyphAxes): GlyphAxes => ({
  wght: (a.wght + b.wght) / 2,
  wdth: (a.wdth + b.wdth) / 2,
  scaleX: ((a.scaleX ?? 1) + (b.scaleX ?? 1)) / 2,
});

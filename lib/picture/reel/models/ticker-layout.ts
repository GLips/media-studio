// ticker-layout.ts: a ticker row of Archivo whose letters breathe between a light and a bold pose, laid out without
// the DOM from each glyph's advance at its own axes (lib/picture/type/models/glyph-layout.ts), so a frame renders
// alone. Runs without a browser.

import { archivoAdvance, archivoKern, letterTracking, midGlyphAxes, type GlyphAxes } from '#lib/picture/type/models/glyph-layout.ts';

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
 * The slots of an endless repeating row covering `from`–`to` px of its band at `t`; `offset` is the drift.
 *
 * Laid from one slot, the row would sway whole. Instead its mean displacement is zero over a Hann window `anchor` px
 * around `centre`, so neighbours move oppositely and the drift reads linear. Keep `centre` fixed as `from`–`to`
 * moves, or it shifts.
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
    const step = char === null || next === null ? advance : advance + (archivoKern(char, next, midGlyphAxes(axes, pose[i + 1])) + letterTracking(char, next, pose[i].tracking)) * size;
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

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** 1 at the middle of a window running −1..1, falling to 0 at its ends. */
const hann = (u: number) => (Math.abs(u) >= 1 ? 0 : Math.cos((Math.PI / 2) * u) ** 2);

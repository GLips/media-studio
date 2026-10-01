// stamp-wetness.ts: how wet the paper is where each of a wash's deposits lands, worked out once from the recipe, so a
// frame never depends on the frames before it. Painting time starts at 0 with each wash; only its waits advance it.
//
// Each wash keeps, per point of a coarse lattice (STAMP_WET_CELL), the level its water last went to and when; wetness
// follows in closed form. How much paint has set lives in the group's layer (its open share); the lattice keeps only
// the paper's `settled`, by which a landing sets that share to none.
//
// Negative space: washes share no water, water doesn't spread past its brush, and a clipped pass wets wherever its
// brush goes.

import type { PaintMedium, PaintWetting } from '#lib/paint/materials/models/paint-medium.ts';
import { stampPaintFieldAt } from './stamp-paint-field.ts';
import type { PlacedStamp } from '#lib/paint/brush/models/stamp-placement.ts';
import type { CompiledStampDeposit, CompiledStampGroup, CompiledStampMask, CompiledStampPaint, CompiledStampPass, StampPaintPaper, StampWashWait } from './stamp-paint-recipe.ts';
import type { StampGrid, StampPoint } from './stamp-region.ts';

/** A window of the lattice: its first point (px), spacing (STAMP_WET_CELL) and points across and down. */
export type StampWetWindow = Omit<StampGrid, 'values'>;

/**
 * The paper at a moment, per point of `window` (held at its border, as gridAt reads): `wetness`, 0 (dry) to 1 (a
 * standing wash); `workable`, 0 (set) to 1; `settled`, 1 where the paper has dried since it last took water, and at a
 * wash's start, as an earlier pass's paint has set.
 */
export type StampWetState = { window: StampWetWindow; wetness: Float32Array; workable: Float32Array; settled: Float32Array };

/** One of `state`'s values as a grid, for reading on the CPU (stampGridAt). */
export const stampWetGrid = (state: StampWetState, field: 'wetness' | 'workable' | 'settled'): StampGrid => ({ ...state.window, values: state[field] });

/**
 * A wash's deposit landing: `tau`, painting seconds into its wash; the paper `before` it and `after` its own water,
 * over the window its stamps reach and a cell round them; `water`, what its brush carries, 0..1 (0 for a lift); the
 * `medium` its group paints in, which the wet stages move its paint by.
 */
export type StampWetLanding = { tau: number; before: StampWetState; after: StampWetState; water: number; medium: PaintMedium };

/** A wash's record: how many painting seconds it took, its waits included, and the paper as it's left, over the whole lattice. */
export type StampWashRecord = { duration: number; end: StampWetState };

export type StampWetness = {
  landings: ReadonlyMap<CompiledStampDeposit, StampWetLanding>;
  washes: ReadonlyMap<CompiledStampPass, StampWashRecord>;
};

/** A paper's absorbency when it doesn't say. */
export const STAMP_PAPER_ABSORBENCY = 0.5;

/**
 * The lattice's spacing, px: a softening stroke 20 px wide keeps a band of its own, and a wash brush's water spans
 * many cells. At 16 the bilinear read left square halos round a drop. A deposit uploads only its window, so the fresh
 * landscape painted all in washes (527 deposits) uploads 3.1 MB.
 */
export const STAMP_WET_CELL = 8;

/** Samples per cell side a footprint is rasterised at (every 4 px) before it's averaged onto the lattice. */
const FOOTPRINT_SAMPLES = 2;

/**
 * How paper dries, from its medium and itself: water leaves at `rate` of a full wash a second, evenly, as standing
 * water evaporates and soaks in; `openTime` and `damp` are the medium's (PaintWetting).
 */
export type StampDrying = { rate: number; openTime: number; damp: number };

/** A soft, unsized paper drinks a wash sooner than a hard-sized one: at absorbency 0.5, a full wash dries in `drying` s. */
export function stampDrying(wetting: PaintWetting, paper: StampPaintPaper): StampDrying {
  return { rate: (0.5 + (paper.absorbency ?? STAMP_PAPER_ABSORBENCY)) / wetting.drying, openTime: wetting.openTime, damp: wetting.damp };
}

/** Wetness at painting time `tau` of paper wetted to `level` at `at`. */
export const stampWetnessAt = (level: number, at: number, tau: number, { rate }: StampDrying) => Math.max(0, level - rate * (tau - at));

/**
 * How workable paint is at `tau` on paper wetted to `level` at `at`: fully while the paper is wetter than damp, then
 * falling with its water. Paint sets `openTime` behind its water: it's as workable as the paper was that long before.
 */
export function stampWorkableAt(level: number, at: number, tau: number, { rate, openTime, damp }: StampDrying): number {
  return Math.min(1, Math.max(0, level - rate * Math.max(0, tau - at - openTime)) / damp);
}

/** A share of the painting's lattice: `columns` × `rows` points from point (i0, j0). */
type StampWetSpan = { i0: number; j0: number; columns: number; rows: number };

/**
 * A wash's paper on its lattice, per point: the level its water last went to, the painting time it went there, and
 * whether it had dried out since by the last time it was read (StampWetState's `settled`).
 */
type StampWashPaper = { lattice: StampWetSpan; level: Float64Array; at: Float64Array; settled: Uint8Array };

/**
 * Every wash deposit's landing in `painting`, `size` px, on `paper`, each group's paint in its `mediumOf`, each wash
 * starting from dry paper (or its preparation) at painting time 0. A landing's window reaches `margin(deposit,
 * medium)` px past what its water covers, and a cell more: as far as a stage reads round it (StampWetStage's `reach`).
 */
export function compileStampWetness(
  painting: CompiledStampPaint, mediumOf: (group: CompiledStampGroup) => PaintMedium, paper: StampPaintPaper, size: { width: number; height: number },
  margin: (deposit: CompiledStampDeposit, medium: PaintMedium) => number = () => 0,
): StampWetness {
  const lattice = { i0: 0, j0: 0, columns: Math.ceil(size.width / STAMP_WET_CELL) + 1, rows: Math.ceil(size.height / STAMP_WET_CELL) + 1 };
  const landings = new Map<CompiledStampDeposit, StampWetLanding>(), washes = new Map<CompiledStampPass, StampWashRecord>();
  for (const [group, pass] of painting.groups.flatMap((each) => each.passes.map((laid) => [each, laid] as const))) {
    if (pass.kind !== 'wash') continue;
    const medium = mediumOf(group), { wetting } = medium, drying = stampDrying(wetting, paper);
    const { preparation, schedule } = pass.wash;
    const points = lattice.columns * lattice.rows;
    // Paint an earlier pass left has set: washes share no water.
    const wash: StampWashPaper = { lattice, level: new Float64Array(points), at: new Float64Array(points), settled: new Uint8Array(points).fill(1) };
    if (preparation) {
      const cover = footprintCover(lattice, [], [preparation.polygon], pass.within, null);
      forSpan(wash, lattice, (k, w, x, y) => { wash.level[k] = cover[w] * stampPaintFieldAt(preparation.wetness, x, y); });
    }
    let tau = 0;
    for (const [index, step] of schedule.entries()) {
      if (step.kind === 'wait') {
        // A bloom's drop is the step after its wait, as the recipe's bloom lays them.
        const drop = 'under' in step ? schedule[index + 1] : undefined;
        tau += stampWashWaitSeconds(wash, tau, step.until, drying, drop?.kind === 'deposit' ? pointsUnder(wash, drop.deposit, pass.within) : null);
        continue;
      }
      const { deposit } = step, { action } = deposit;
      const water = action.kind === 'lift' ? 0 : action.water ?? wetting.brushWater;
      const span = depositSpan(deposit, lattice, margin(deposit, medium));
      const before = wetStateOver(wash, span, tau, drying);
      const cover = footprintCover(span, deposit.stamps, deposit.kind === 'flood' ? [deposit.flood.polygon] : [], pass.within, deposit.mask);
      forSpan(wash, span, (k, w) => {
        const now = stampWetnessAt(wash.level[k], wash.at[k], tau, drying), c = cover[w];
        // The landing set the paint here to none open where the paper had settled, so it starts afresh from what water does.
        wash.settled[k] = c > 0 && water > 0 && action.kind !== 'lift' ? 0 : settledAt(wash, k, tau, drying);
        // A brush leaves paper at least as wet as itself (the area it covers of the point's cell); a thirsty one soaks it up.
        const next = action.kind === 'lift' ? now * (1 - c * action.strength) : now + c * (Math.max(now, water) - now);
        if (next === now) return;
        wash.level[k] = next;
        wash.at[k] = tau;
      });
      landings.set(deposit, { tau, before, after: wetStateOver(wash, span, tau, drying), water, medium });
    }
    washes.set(pass, { duration: tau, end: wetStateOver(wash, lattice, tau, drying) });
  }
  return { landings, washes };
}

/**
 * Painting seconds from `tau` until `until`: 'damp' once the wettest paper is no wetter than damp, 'dry' once no paint
 * is workable (its open time run out too), over the lattice points `under` (a bloom's drop), or the whole wash when
 * null. Each point's moment comes in closed form; the wait lasts to the latest.
 */
function stampWashWaitSeconds(wash: StampWashPaper, tau: number, until: StampWashWait, { rate, openTime, damp }: StampDrying, under: readonly number[] | null): number {
  if (typeof until === 'object') return until.seconds;
  const floor = until === 'damp' ? damp : 0, lag = until === 'damp' ? 0 : openTime;
  let latest = tau;
  for (const k of under ?? wash.level.keys()) {
    if (wash.level[k] > floor) latest = Math.max(latest, wash.at[k] + lag + (wash.level[k] - floor) / rate);
  }
  return latest - tau;
}

/** The lattice points `deposit` wets any of, as its landing's cover reads them. */
function pointsUnder(wash: StampWashPaper, deposit: CompiledStampDeposit, within: readonly StampPoint[] | null): number[] {
  const span = depositSpan(deposit, wash.lattice, 0);
  const cover = footprintCover(span, deposit.stamps, deposit.kind === 'flood' ? [deposit.flood.polygon] : [], within, deposit.mask);
  const points: number[] = [];
  forSpan(wash, span, (k, w) => { if (cover[w] > 0) points.push(k); });
  return points;
}

/** Calls `visit` for each point of `span`: its index in the wash's lattice and in the span, and where it is, px. */
function forSpan(wash: StampWashPaper, span: StampWetSpan, visit: (k: number, w: number, x: number, y: number) => void) {
  for (let j = 0; j < span.rows; j++) {
    for (let i = 0; i < span.columns; i++) {
      visit((span.j0 + j) * wash.lattice.columns + span.i0 + i, j * span.columns + i, (span.i0 + i) * STAMP_WET_CELL, (span.j0 + j) * STAMP_WET_CELL);
    }
  }
}

/** Whether point `k`'s paper has dried out by `tau` since it last took water: once it's no longer workable, until water comes. */
const settledAt = (wash: StampWashPaper, k: number, tau: number, drying: StampDrying) =>
  (stampWorkableAt(wash.level[k], wash.at[k], tau, drying) <= 0 ? 1 : wash.settled[k]);

/** `wash`'s paper at `tau` over `span`. */
function wetStateOver(wash: StampWashPaper, span: StampWetSpan, tau: number, drying: StampDrying): StampWetState {
  const points = span.columns * span.rows;
  const state: StampWetState = {
    window: { x0: span.i0 * STAMP_WET_CELL, y0: span.j0 * STAMP_WET_CELL, cell: STAMP_WET_CELL, columns: span.columns, rows: span.rows },
    wetness: new Float32Array(points), workable: new Float32Array(points), settled: new Float32Array(points),
  };
  forSpan(wash, span, (k, w) => {
    state.wetness[w] = stampWetnessAt(wash.level[k], wash.at[k], tau, drying);
    state.workable[w] = stampWorkableAt(wash.level[k], wash.at[k], tau, drying);
    state.settled[w] = settledAt(wash, k, tau, drying);
  });
  return state;
}

/**
 * The window of `lattice` a deposit's water can reach: its stamps and a flood's body, `margin` px round them and a
 * cell more, so the GPU's reads past its stamps' edges (a blurred edge, a rim, a stage's reach) hold values from
 * beside them. At least 2 × 2, as gridAt reads.
 */
function depositSpan(deposit: CompiledStampDeposit, lattice: StampWetSpan, margin: number): StampWetSpan {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const stamps of [deposit.stamps, deposit.dualStamps]) {
    for (const { x, y, diameter } of stamps) {
      x0 = Math.min(x0, x - diameter / 2); y0 = Math.min(y0, y - diameter / 2); x1 = Math.max(x1, x + diameter / 2); y1 = Math.max(y1, y + diameter / 2);
    }
  }
  if (deposit.kind === 'flood') {
    const { box } = deposit.flood;
    x0 = Math.min(x0, box.x0); y0 = Math.min(y0, box.y0); x1 = Math.max(x1, box.x1); y1 = Math.max(y1, box.y1);
  }
  const cells = Math.ceil(margin / STAMP_WET_CELL) + 1;
  const cellsOver = (from: number, to: number, count: number) => {
    const first = Math.min(count - 2, Math.max(0, Math.floor(from / STAMP_WET_CELL) - cells));
    return [first, Math.max(first + 2, Math.min(count, Math.ceil(to / STAMP_WET_CELL) + 1 + cells)) - first] as const;
  };
  const [i0, columns] = cellsOver(x0, x1, lattice.columns), [j0, rows] = cellsOver(y0, y1, lattice.rows);
  return { i0, j0, columns, rows };
}

/**
 * How much of each point's cell of `span` is wetted, 0..1: the discs of `stamps` and the `polygons`, less what's
 * outside `within` or under the masking fluid `mask`, averaged from samples finer than the lattice. Hard-edged: a mask's
 * soft or ragged edge is finer than a cell.
 */
function footprintCover(span: StampWetSpan, stamps: readonly PlacedStamp[], polygons: readonly (readonly StampPoint[])[], within: readonly StampPoint[] | null, mask: CompiledStampMask | null): Float32Array {
  const step = STAMP_WET_CELL / FOOTPRINT_SAMPLES, columns = span.columns * FOOTPRINT_SAMPLES, rows = span.rows * FOOTPRINT_SAMPLES;
  // Sample (a, b) sits at the centre of its share of the cell round lattice point (i0 + a / 4, j0 + b / 4).
  const ox = (span.i0 - 0.5) * STAMP_WET_CELL + step / 2, oy = (span.j0 - 0.5) * STAMP_WET_CELL + step / 2;
  const fine = { columns, rows, ox, oy, step };
  const wet = new Float32Array(columns * rows);
  for (const { x, y, diameter } of stamps) stampDiscOnto(wet, fine, x, y, diameter / 2);
  for (const polygon of polygons) scanPolygon(polygon, fine, (s) => { wet[s] = 1; });
  if (within) {
    const inside = new Uint8Array(wet.length);
    scanPolygon(within, fine, (s) => { inside[s] = 1; });
    for (let s = 0; s < wet.length; s++) wet[s] *= inside[s];
  }
  const chain: CompiledStampMask[] = [];
  for (let op = mask; op; op = op.under) chain.unshift(op);
  if (chain.length) {
    const fluid = new Float32Array(wet.length);
    for (const op of chain) {
      if (op.kind === 'mask') scanPolygon(op.area.polygon, fine, (s) => { fluid[s] = 1; });
      else if (op.area) scanPolygon(op.area.polygon, fine, (s) => { fluid[s] *= 1 - op.amount; });
      else for (let s = 0; s < fluid.length; s++) fluid[s] *= 1 - op.amount;
    }
    for (let s = 0; s < wet.length; s++) wet[s] *= 1 - fluid[s];
  }
  const cover = new Float32Array(span.columns * span.rows);
  for (let b = 0; b < rows; b++) {
    for (let a = 0; a < columns; a++) cover[Math.floor(b / FOOTPRINT_SAMPLES) * span.columns + Math.floor(a / FOOTPRINT_SAMPLES)] += wet[b * columns + a] / FOOTPRINT_SAMPLES ** 2;
  }
  return cover;
}

/** A raster of samples `step` px apart, the first at (ox, oy). */
type StampWetRaster = { columns: number; rows: number; ox: number; oy: number; step: number };

/** Marks the samples within `radius` of (x, y); a disc too small to reach one lays its area's share on the nearest. */
function stampDiscOnto(wet: Float32Array, fine: StampWetRaster, x: number, y: number, radius: number) {
  const { columns, rows, ox, oy, step } = fine;
  const u = (x - ox) / step, v = (y - oy) / step, r = radius / step;
  if (r < 0.5) {
    const a = Math.round(u), b = Math.round(v);
    if (a >= 0 && a < columns && b >= 0 && b < rows) wet[b * columns + a] = Math.max(wet[b * columns + a], Math.min(1, Math.PI * r * r));
    return;
  }
  for (let b = Math.max(0, Math.ceil(v - r)); b <= Math.min(rows - 1, Math.floor(v + r)); b++) {
    const half = Math.sqrt(Math.max(0, r * r - (b - v) ** 2));
    for (let a = Math.max(0, Math.ceil(u - half)); a <= Math.min(columns - 1, Math.floor(u + half)); a++) wet[b * columns + a] = 1;
  }
}

/** Calls `visit` with each sample of `fine` inside `polygon`, by even-odd, row by row. */
function scanPolygon(polygon: readonly StampPoint[], fine: StampWetRaster, visit: (sample: number) => void) {
  const { columns, rows, ox, oy, step } = fine;
  const crossings: number[] = [];
  let top = Infinity, bottom = -Infinity;
  for (const { y } of polygon) {
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  for (let b = Math.max(0, Math.ceil((top - oy) / step)); b <= Math.min(rows - 1, Math.floor((bottom - oy) / step)); b++) {
    const y = oy + b * step;
    crossings.length = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const p = polygon[j], q = polygon[i];
      if ((p.y > y) !== (q.y > y)) crossings.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
    }
    crossings.sort((m, n) => m - n);
    for (let c = 0; c + 1 < crossings.length; c += 2) {
      const from = Math.max(0, Math.ceil((crossings[c] - ox) / step)), to = Math.min(columns - 1, Math.floor((crossings[c + 1] - ox) / step));
      for (let a = from; a <= to; a++) visit(b * columns + a);
    }
  }
}

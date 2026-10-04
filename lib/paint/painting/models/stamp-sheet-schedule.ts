// stamp-sheet-schedule.ts: the forward scheduler's decisions, in f64 on the CPU, from the GPU's reductions over an
// application's core: model time on a 1 ms grid anchored at each predecessor, the clock's policy (ENGINE 3.5).
//
// The laws, per texel wetted to ℓ at a, drying at rate r with open time o, sheen shiny h and damp d: wet while
// τ < U = a + (ℓ − h)/r; matte from L = a + (ℓ − d)/r; set from Z = a + o + ℓ/r; under `never` (r = 0), U and Z are
// +∞ where ℓ > 0, L −∞ where ℓ ≤ d, else +∞. `on` holds over 95% of the core's weight (`dry`, all). A `wet` that
// doesn't only warns: wetness only falls, so waiting can't help.

import { STAMP_BLOOM_SURPLUS } from './stamp-wet-bloom.ts';
import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { StampPixelBox } from './stamp-blur-region.ts';
import type { StampBox } from './stamp-region.ts';
import type { StampSheetClock, StampSheetEntry, StampSheetWash, StampSheetWetness } from './stamp-sheet-program.ts';
import { StampSheetRefusal } from './stamp-sheet-refusal.ts';
import { stampBoxUnion } from './stamp-stage.ts';
import type { StampWetting } from './stamp-wash-ledger.ts';
import { stampWetnessAt, stampWorkableAt, type StampDrying, type StampWashDrying, type StampWetLanding } from './stamp-wetness.ts';

/** The grid model time is decided on, s. */
export const STAMP_SHEET_STEP = 0.001;
/** The share of its core's weight `on: 'wet'` and `'damp'` hold over. */
export const STAMP_SHEET_SHARE = 0.95;
/** How many 1 ms steps verification may take past a decision before it's an engine fault: f32 rounding can't account for more. */
export const STAMP_SHEET_VERIFY_STEPS = 8;
/** A texel's weight at full contact: contact × 2¹⁶, at most 2¹⁶, so a workgroup's 256 texels sum under 2²⁴. */
export const STAMP_SHEET_WEIGHT = 65536;
/** The least contact a core texel has: the fringe below it weighs nothing. */
export const STAMP_SHEET_CORE_CONTACT = 0.5;
/** Px a side of a failure map's cells. */
export const STAMP_SHEET_FAILURE_CELL = 32;
/** The most boxes a failure names. */
export const STAMP_SHEET_FAILURE_BOXES = 4;
/** How far from the time base field times may stand, s, before a rebase: f32 spacing there is 2⁻¹⁰ s, under the grid. */
export const STAMP_SHEET_REBASE = 2 ** 13;
/** Water a bloom must bring over the paper's wetness to spread: the bloom stage's least surplus. */
export const STAMP_SHEET_BLOOM_SURPLUS = STAMP_BLOOM_SURPLUS.least;

/** A moment of a solve: model s, and the scene second it maps to (null off the sheet's clock: its unclocked run). */
export type StampSheetMoment = { tau: number; scene: number | null };

/**
 * When a core is damp over STAMP_SHEET_SHARE of the paper under it that holds water, as an entry left it: `from` the
 * first step that holds, `to` the first after the last; or never at once, at most `share` of it, at `at`.
 */
export type StampSheetDampWindow = { kind: 'damp'; from: StampSheetMoment; to: StampSheetMoment } | { kind: 'uneven'; share: number; at: StampSheetMoment };

/**
 * What a reporting solve read once an entry landed, where the paper dries by its laws: for its wash's last, when what
 * the wash wetted is damp (`damp`, null else); for a bloom, when its footprint is damp again (`rewet`, null else).
 */
export type StampSheetReport = { damp: StampSheetDampWindow | null; rewet: StampSheetDampWindow | null };

/**
 * What a solve decided for an entry: its wash's start, for the wash's first; τ0, the earliest it could land; when it
 * landed, and its scene second; whether a drying closed as its wash started and as it landed; for the wash's last,
 * when all it touched has set; its warnings; what a reporting solve read. Null where there's none.
 */
export type StampSheetDecision = {
  start: StampSheetMoment | null; tau0: number; tau: number; scene: number | null; closes: { start: boolean; landing: boolean };
  washSet: StampSheetMoment | null; warnings: readonly string[]; report: StampSheetReport | null;
};

/** The scene second model time `tau` maps to on a `scale` clock whose clocked run starts at model time `start` (τc). */
export const stampSheetSceneAt = (clock: Extract<StampSheetClock, { kind: 'scale' }>, start: number, tau: number) => clock.origin + (tau - start) * clock.scale;

/** The model time scene second `scene` maps to on a `scale` clock whose clocked run starts at model time `start`. */
export const stampSheetModelAt = (clock: Extract<StampSheetClock, { kind: 'scale' }>, start: number, scene: number) => start + (scene - clock.origin) / clock.scale;

/** The earliest time at or after `x` on the 1 ms grid anchored at `tau0`; `tau0` itself when `x` isn't past it. */
export function stampSheetGrid(tau0: number, x: number): number {
  if (!(x > tau0)) return tau0;
  return tau0 + STAMP_SHEET_STEP * Math.ceil((x - tau0) / STAMP_SHEET_STEP - 1e-9);
}

/**
 * A model time and its scene second where that's known exactly (a numeric origin, a fixed `at`, a predecessor's):
 * carried rather than mapped there and back, so a fixed `at` of 9 prints 9. Null to map it on the clock.
 */
export type StampSheetTimed = { tau: number; exact: number | null };

/** How an entry with order time `orderTime` (null in the unclocked run) dries as it's decided on `clock`. */
export function stampSheetRegimeOf(clock: StampSheetClock, orderTime: number | null): StampSheetRegime {
  if (clock.kind === 'never') return 'never';
  return clock.kind === 'instant' && orderTime !== null ? 'instant' : 'drying';
}

/**
 * The scene second an entry with order time `orderTime` lands at, landing `at` after `state`: null in the unclocked
 * run; its order time off a scale; on a scale, `at`'s exact second, else S + (τ − τc) × scale.
 */
export function stampSheetSceneOf(clock: StampSheetClock, state: StampSheetSolveState, orderTime: number | null, at: StampSheetTimed): number | null {
  if (orderTime === null) return null;
  if (clock.kind !== 'scale') return orderTime;
  return at.exact ?? stampSheetSceneAt(clock, state.clockStart!, at.tau);
}

/** When a wash can start, or why it can't: its layer's earlier water never sets, or is still wet past its origin. */
export type StampSheetWashStart = { kind: 'starts'; at: StampSheetTimed } | { kind: 'never-sets' } | { kind: 'still-wet'; origin: number; until: number };

/**
 * When a wash can start after `state` (ENGINE 3.5), its first entry `clocked` or not, `set` (Y) the latest its
 * layer's earlier wet washes set (null for none, +∞ for never): at Y on the grid, or on a scale at its numeric
 * origin, refused before Y. Direct washes hold no water to wait on.
 */
export function stampSheetWashStart(
  clock: StampSheetClock, state: StampSheetSolveState, { origin }: Pick<StampSheetWash, 'origin'>, clocked: boolean, set: number | null,
): StampSheetWashStart {
  if (set === Infinity) return { kind: 'never-sets' };
  if (clocked && clock.kind === 'scale' && typeof origin === 'number') {
    const from = stampSheetModelAt(clock, state.clockStart!, origin);
    if (set !== null && from < set) return { kind: 'still-wet', origin, until: stampSheetSceneAt(clock, state.clockStart!, set) };
    return { kind: 'starts', at: from > state.tau ? { tau: from, exact: origin } : { tau: state.tau, exact: state.scene } };
  }
  const tau = stampSheetGrid(state.tau, set ?? state.tau);
  return { kind: 'starts', at: { tau, exact: tau === state.tau ? state.scene : null } };
}

/**
 * Where `entry` may land from, τ0, after `from` (its wash's start or its predecessor's landing): under `instant`, a
 * clocked entry once `fieldSet`, when the sheet's paper has set (null for none wetted); on a scale, a fixed `at`'s
 * model time, refused before `from`. Direct entries too.
 */
export function stampSheetEntryFrom(
  clock: StampSheetClock, state: StampSheetSolveState, entry: Pick<StampSheetEntry, 'name' | 'orderTime' | 'at'>, from: StampSheetTimed, fieldSet: number | null,
): StampSheetTimed {
  const instant = stampSheetRegimeOf(clock, entry.orderTime) === 'instant';
  const settled: StampSheetTimed = instant && fieldSet !== null && fieldSet > from.tau ? { tau: stampSheetGrid(from.tau, fieldSet), exact: null } : from;
  if (entry.at === null || clock.kind !== 'scale') return settled;
  const fixed = stampSheetModelAt(clock, state.clockStart!, entry.at);
  if (fixed < settled.tau) throw new StampSheetRefusal(stampSheetAtTooEarly(entry.name, entry.at, stampSheetSceneOf(clock, state, entry.orderTime, settled)!));
  return { tau: fixed, exact: entry.at };
}

/**
 * A model time `tau` at or after an entry (`clocked` or not) landed as `state` says, as a moment: under `instant`, at
 * that landing's scene second, as all it wetted sets there; on a scale, `tau` mapped; else model time alone.
 */
export function stampSheetMomentAfter(clock: StampSheetClock, state: StampSheetSolveState, clocked: boolean, tau: number): StampSheetMoment {
  if (clock.kind === 'instant') return { tau, scene: state.scene };
  return { tau, scene: clock.kind === 'scale' && clocked ? stampSheetSceneAt(clock, state.clockStart!, tau) : null };
}

/** A wash's start as decided: its moment, and whether a drying closed there. */
export type StampSheetBegun = { start: StampSheetMoment; closes: boolean };

/** An entry's landing as decided: τ0, τ and its scene second, its warnings, and whether a drying closed as it landed. */
export type StampSheetLandingDecided = Pick<StampSheetDecision, 'tau0' | 'tau' | 'scene' | 'warnings'> & { closes: boolean };

/**
 * An entry's decision from its parts: its wash's start (null past the wash's first), its landing, its wash's set
 * moment, and what a reporting solve read after it (null for none).
 */
export const stampSheetDecisionOf = (begun: StampSheetBegun | null, landing: StampSheetLandingDecided, washSet: StampSheetMoment | null, report: StampSheetReport | null): StampSheetDecision => ({
  start: begun?.start ?? null, tau0: landing.tau0, tau: landing.tau, scene: landing.scene,
  closes: { start: begun?.closes ?? false, landing: landing.closes }, washSet, warnings: landing.warnings, report,
});

/** The wash start a remembered decision of its wash's first entry made. */
export const stampSheetBegunOf = ({ start, closes }: StampSheetDecision): StampSheetBegun => ({ start: start!, closes: closes.start });

/** The landing a remembered decision made. */
export const stampSheetLandingOf = ({ tau0, tau, scene, warnings, closes }: StampSheetDecision): StampSheetLandingDecided => ({ tau0, tau, scene, warnings, closes: closes.landing });

/** A two-word total as the GPU leaves it (low word, then high): exact in f64 up to 2⁵³. */
export const stampSheetWide = (words: Uint32Array, at: number) => words[at + 1] * 2 ** 32 + words[at];

const f32Bits = new DataView(new ArrayBuffer(4));

/** A u32 ordered as the f32 it encodes: the sign bit flipped for non-negative values, every bit inverted for negative. */
export function stampSheetOrderedWord(value: number): number {
  f32Bits.setFloat32(0, value);
  const bits = f32Bits.getUint32(0);
  return (bits & 0x80000000 ? ~bits : bits ^ 0x80000000) >>> 0;
}

/** The f32 an ordered word encodes; null for 0, which no time encodes (an atomic left as cleared). */
export function stampSheetOrderedValue(word: number): number | null {
  if (word === 0) return null;
  f32Bits.setUint32(0, (word & 0x80000000 ? word ^ 0x80000000 : ~word) >>> 0);
  return f32Bits.getFloat32(0);
}

/** Words of a totals record (STAMP_SHEET_TOTALS): six two-word sums, then the least matte time, the latest set and the box's latest set. */
export const STAMP_SHEET_TOTALS = { weight: 0, wet: 2, damp: 4, workable: 6, never: 8, bloom: 10, leastMatte: 12, latestSet: 13, boxLatestSet: 14, words: 16 } as const;

/**
 * An application's core at a probe time, from a totals record: its weight, the weight wet, damp, still workable,
 * never wetted and able to bloom there; the earliest any wetted texel turns matte and the latest it sets (null for
 * none); and the latest the asked-about box sets (null when nothing wetted it). Times absolute, model s.
 */
export type StampSheetTotals = {
  weight: number; wet: number; damp: number; workable: number; never: number; bloom: number;
  leastMatte: number | null; latestSet: number | null; boxLatestSet: number | null;
};

/** `words` read as totals, times after the base `base`; the least matte time is kept as its word's complement. */
export function stampSheetTotals(words: Uint32Array, base: number): StampSheetTotals {
  const T = STAMP_SHEET_TOTALS, at = (word: number) => {
    const value = stampSheetOrderedValue(word);
    return value === null ? null : base + value;
  };
  return {
    weight: stampSheetWide(words, T.weight), wet: stampSheetWide(words, T.wet), damp: stampSheetWide(words, T.damp),
    workable: stampSheetWide(words, T.workable), never: stampSheetWide(words, T.never), bloom: stampSheetWide(words, T.bloom),
    leastMatte: words[T.leastMatte] ? at((0xffffffff - words[T.leastMatte]) >>> 0) : null, latestSet: at(words[T.latestSet]), boxLatestSet: at(words[T.boxLatestSet]),
  };
}

/** The weight a rule holds over at a probe: `wet`'s or `damp`'s, and for `dry` the weight no longer workable. */
export function stampSheetHeld(on: StampSheetWetness, totals: StampSheetTotals): number {
  if (on === 'wet') return totals.wet;
  if (on === 'damp') return totals.damp;
  return totals.weight - totals.workable;
}

/** Whether `on` holds at a probe: over STAMP_SHEET_SHARE of the weight, or for `dry` over all of it. */
export function stampSheetHolds(on: StampSheetWetness, totals: StampSheetTotals): boolean {
  return on === 'dry' ? totals.workable === 0 : totals.weight > 0 && stampSheetHeld(on, totals) >= STAMP_SHEET_SHARE * totals.weight;
}

const boxArea = (b: StampBox) => (b.x1 - b.x0) * (b.y1 - b.y0);
const boxUnion = (a: StampBox, b: StampBox) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/**
 * The marked cells of a failure map (`columns` × `rows`, row by row, cells STAMP_SHEET_FAILURE_CELL px from `origin`,
 * document px): each connected run's box within the document (`limit`), merged two at a time (the pair growing least)
 * down to STAMP_SHEET_FAILURE_BOXES. A run wholly past the document (in a wrapped sheet's halo) has none.
 */
export function stampSheetFailureBoxes(cells: Uint32Array, columns: number, rows: number, origin: { x: number; y: number }, limit: { width: number; height: number }): StampBox[] {
  const seen = new Uint8Array(columns * rows), boxes: StampBox[] = [];
  for (let start = 0; start < columns * rows; start++) {
    if (!cells[start] || seen[start]) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const at = stack.pop()!, i = at % columns, j = Math.floor(at / columns);
      x0 = Math.min(x0, i); y0 = Math.min(y0, j); x1 = Math.max(x1, i); y1 = Math.max(y1, j);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj, next = nj * columns + ni;
        if (ni < 0 || nj < 0 || ni >= columns || nj >= rows || seen[next] || !cells[next]) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    const cell = STAMP_SHEET_FAILURE_CELL;
    const box = {
      x0: Math.max(0, origin.x + x0 * cell), y0: Math.max(0, origin.y + y0 * cell),
      x1: Math.min(limit.width, origin.x + (x1 + 1) * cell), y1: Math.min(limit.height, origin.y + (y1 + 1) * cell),
    };
    if (box.x1 > box.x0 && box.y1 > box.y0) boxes.push(box);
  }
  while (boxes.length > STAMP_SHEET_FAILURE_BOXES) {
    let best = { a: 0, b: 1, growth: Infinity };
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const growth = boxArea(boxUnion(boxes[a], boxes[b])) - boxArea(boxes[a]) - boxArea(boxes[b]);
        if (growth < best.growth) best = { a, b, growth };
      }
    }
    boxes[best.a] = boxUnion(boxes[best.a], boxes[best.b]);
    boxes.splice(best.b, 1);
  }
  return boxes.toSorted((p, q) => p.y0 - q.y0 || p.x0 - q.x0);
}

/**
 * What water a solve has laid, as the ledger keeps a wash's (stamp-wash-ledger.ts) for a whole sheet: every wetting
 * (a prewet's or a landing's), the entries landed by the wash law since the last drying with their landings, the
 * wettest the paper has stood since, and how many dryings have closed.
 */
export type StampSheetWater = {
  wettings: readonly StampWetting[]; since: readonly { entry: number; landing: StampWetLanding }[]; wettest: number; dryings: number;
};

/**
 * A solve's state between steps, all a checkpoint keeps beside its GPU state (ENGINE 4.5): the time base, the last τ
 * and its scene second; τc (null before the clocked run); each film's painted box, each wash's touched boxes, the box
 * water touched; the paper touched since the last drying, whether anything landed there, when it sets (-Infinity
 * unread); water.
 */
export type StampSheetSolveState = {
  base: number; tau: number; scene: number | null; clockStart: number | null;
  painted: readonly (StampPixelBox | null)[]; touched: readonly (readonly StampPixelBox[])[]; field: StampPixelBox | null;
  since: StampPixelBox | null; landedSince: boolean; knownSetAt: number; water: StampSheetWater;
};

/** A solve's state before anything lands: `films` films and `washes` washes, on dry paper at 0 s. */
export const stampSheetSolveStart = (films: number, washes: number): StampSheetSolveState => ({
  base: 0, tau: 0, scene: null, clockStart: null, painted: Array.from({ length: films }, () => null), touched: Array.from({ length: washes }, () => []), field: null,
  since: null, landedSince: false, knownSetAt: -Infinity, water: { wettings: [], since: [], wettest: 0, dryings: 0 },
});

/**
 * `state`, kept by a program sharing this one's prefix, for one of `films` films and `washes` washes: those the prefix
 * never reached unpainted and untouched.
 */
export const stampSheetStateResized = (state: StampSheetSolveState, films: number, washes: number): StampSheetSolveState => ({
  ...state, painted: Array.from({ length: films }, (_, f) => state.painted[f] ?? null), touched: Array.from({ length: washes }, (_, w) => state.touched[w] ?? []),
});

/** `state` entering its clocked run: its clock starting at its last τ, the end of its unclocked run, at scene `scene`. */
export const stampSheetClockStarted = (state: StampSheetSolveState, scene: number | null): StampSheetSolveState => ({ ...state, clockStart: state.tau, scene });

/** `state` with its time base moved up by whole seconds once `tau` is STAMP_SHEET_REBASE past it, and the move (0 for none). */
export function stampSheetRebased(state: StampSheetSolveState, tau: number): { state: StampSheetSolveState; shift: number } {
  if (tau - state.base < STAMP_SHEET_REBASE) return { state, shift: 0 };
  const shift = Math.floor(tau - state.base);
  return { state: { ...state, base: state.base + shift }, shift };
}

/** `state` with `moment` decided. */
export const stampSheetDecided = (state: StampSheetSolveState, { tau, scene }: StampSheetMoment): StampSheetSolveState => ({ ...state, tau, scene });

/** `state` once a direct application of wash `wash` has drawn over `box` (stage texels; null off the stage): no water. */
export const stampSheetDrawn = (state: StampSheetSolveState, wash: number, box: StampPixelBox | null): StampSheetSolveState =>
  (box ? { ...state, touched: state.touched.with(wash, [...state.touched[wash], box]) } : state);

/** `state` with film `film` painted over `box` too (null for nowhere). */
export const stampSheetPainted = (state: StampSheetSolveState, film: number, box: StampPixelBox | null): StampSheetSolveState =>
  (box ? { ...state, painted: state.painted.with(film, stampBoxUnion(state.painted[film], box)) } : state);

const pixelBoxOf = ({ x, y, w, h }: StampPixelBox): StampBox => ({ x0: x, y0: y, x1: x + w, y1: y + h });

const boxesMeet = (a: StampBox | null, b: StampBox) => !!a && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * What a landing at `tau` finds within `reach` px of its `support` (null for none): wet or workable paper by the
 * closed form over the water laid there, each wetting taken to wet all of its box.
 */
export function stampSheetLandingAt(
  water: StampSheetWater, tau: number, landing: { water: number; medium: PaintMedium; support: StampBox | null; reach: number }, drying: StampDrying,
): StampWetLanding {
  const { support, reach } = landing, within = support && { x0: support.x0 - reach, y0: support.y0 - reach, x1: support.x1 + reach, y1: support.y1 + reach };
  const under = within ? water.wettings.filter(({ box }) => boxesMeet(box, within)) : [];
  return {
    tau, water: landing.water, medium: landing.medium, drying,
    finds: { wet: under.some(({ level, at }) => stampWetnessAt(level, at, tau, drying) > 0), workable: under.some(({ level, at }) => stampWorkableAt(level, at, tau, drying) > 0) },
  };
}

/**
 * `state` once `entry` of wash `wash` has landed by the wash law as `landing` says: its water over `support` unless it
 * lifts, holding the paper as wet as `held` at most; `box`, its stage texels (null off the stage). What's known of
 * when the paper sets is forgotten: a lift can bring that sooner.
 */
export function stampSheetLanded(state: StampSheetSolveState, landed: {
  entry: number; wash: number; landing: StampWetLanding; support: StampBox | null; lifts: boolean; held: number; box: StampPixelBox | null;
}): StampSheetSolveState {
  const { entry, wash, landing, support, lifts, held, box } = landed, { water } = state, lays = landing.water > 0 && !lifts;
  return {
    ...state, knownSetAt: -Infinity,
    ...(box && { since: stampBoxUnion(state.since, box), landedSince: true, touched: state.touched.with(wash, [...state.touched[wash], box]), field: stampBoxUnion(state.field, box) }),
    water: {
      ...water, since: [...water.since, { entry, landing }],
      ...(lays && { wettings: [...water.wettings, { at: landing.tau, level: landing.water, box: support }], wettest: Math.max(water.wettest, Math.min(1, landing.water), held) }),
    },
  };
}

/** `state` once wash `wash`'s prewet has laid clean water as wet as `level` at `at` over `box` (stage texels). */
export function stampSheetPrewetted(state: StampSheetSolveState, prewet: { wash: number; at: number; level: number; box: StampPixelBox }): StampSheetSolveState {
  const { wash, at, level, box } = prewet, { water } = state;
  return {
    ...state, since: stampBoxUnion(state.since, box), touched: state.touched.with(wash, [...state.touched[wash], box]), field: stampBoxUnion(state.field, box),
    water: { ...water, wettings: [...water.wettings, { at, level, box: pixelBoxOf(box) }], wettest: Math.max(water.wettest, Math.min(1, level)) },
  };
}

/** Whether to read back when all landed since the last drying sets, to know if it has by `at`: once something has landed, and `at` could be past it. */
export const stampSheetMaySetBy = (state: StampSheetSolveState, at: number) => state.landedSince && at >= state.knownSetAt;

/** `state` knowing all landed since the last drying sets at `at` (null for nothing wetted there). */
export const stampSheetSetKnown = (state: StampSheetSolveState, at: number | null): StampSheetSolveState => ({ ...state, knownSetAt: at ?? -Infinity });

/**
 * A drying as a solve closes it: its ordinal among the sheet's, the entries landed in it with their landings, when
 * and why it closed, and the wettest its paper stood.
 */
export type StampSheetClosure = { ordinal: number; since: StampSheetWater['since']; at: number; closes: StampWashDrying['closes']; wettest: number };

/** `state` with the drying of all landed since the last closed at `at`, and that drying: null when nothing landed by the wash law. */
export function stampSheetClosed(state: StampSheetSolveState, at: number, closes: StampWashDrying['closes'], drying: StampDrying): { state: StampSheetSolveState; closed: StampSheetClosure | null } {
  const { water } = state, closed = water.since.length ? { ordinal: water.dryings, since: water.since, at, closes, wettest: water.wettest } : null;
  // The next drying starts from the wettest any water laid so far still stands.
  const standing = Math.min(1, Math.max(0, ...water.wettings.map(({ level, at: laid }) => stampWetnessAt(level, laid, at, drying))));
  return {
    state: { ...state, since: null, landedSince: false, knownSetAt: -Infinity, water: { ...water, since: [], wettest: standing, dryings: water.dryings + (closed ? 1 : 0) } },
    closed,
  };
}

/** A model time or a scene second as messages print it: to the millisecond. */
export const stampSheetSeconds = (tau: number) => `${Number(tau.toFixed(3))} s`;

/**
 * How the paper dries for an entry as it's decided: `drying`, by its laws; `instant`, set before each clocked entry;
 * `never`, not at all. An entry of the unclocked run dries by its laws under any clock but `never`.
 */
export type StampSheetRegime = 'drying' | 'instant' | 'never';

/** A rule's shortfall over a probe: its share of the core in whole percent, and where it failed as boxes. */
const shortfall = (at: { held: number; totals: Pick<StampSheetTotals, 'weight'> }, boxes: readonly StampBox[]) => ({
  share: Math.round((100 * at.held) / Math.max(1, at.totals.weight)), where: boxes.map(({ x0, y0, x1, y1 }) => `[${x0},${y0} → ${x1},${y1}]`).join(' '),
});

/**
 * Why `on` falls short over a core, and what to do about it, one clause: water it never met, its sheet's clock, or
 * its own rule. A `wet` under `never` falls short by its rule: the paper is as it was laid.
 */
function shortReason(on: StampSheetWetness, totals: Pick<StampSheetTotals, 'weight' | 'never'>, regime: StampSheetRegime): string {
  if (totals.never > (1 - STAMP_SHEET_SHARE) * totals.weight) {
    const dry = Math.round((100 * totals.never) / totals.weight);
    return `never wetted on this sheet: ${dry}% of its core met no water before it; lay it over a flood or prewet earlier on the sheet, or drop the \`on\``;
  }
  if (regime === 'instant') return 'settled before it (`instant`): give the sheet a numeric `dryingScale`, or drop the `on`';
  if (regime === 'never' && on !== 'wet') return "nothing dries (`never`): give the sheet a numeric `dryingScale`, or drop the `on` (under `never`, a bloom is `on: 'wet'`)";
  if (on === 'wet') return "not shiny at its predecessor's time: inset it from the flood's rim (feather it, or narrow its shape), flood wetter, or lay it before any lift it crosses";
  return 'sets before the rest turns matte: split it along the boxes, so each part lies on paper drying alike';
}

/**
 * An unreachable application's problem: its rule, the most of its core that held it (an upper bound), when, where it
 * failed, why (as the paper dries under `regime`) and what to do, and the applications of its sheet left unscheduled.
 */
export function stampSheetUnreachable(
  name: string, on: StampSheetWetness, at: { tau: number; held: number; totals: Pick<StampSheetTotals, 'weight' | 'never'> }, boxes: readonly StampBox[],
  unscheduled: readonly string[], regime: StampSheetRegime,
): string {
  const { share, where } = shortfall(at, boxes), left = unscheduled.length ? `. Unscheduled after it: ${unscheduled.join(', ')}` : '';
  return `${name}: unreachable from this committed prefix: on '${on}' held over at most ${share}% of its core (needs ${STAMP_SHEET_SHARE * 100}%), at model ${stampSheetSeconds(at.tau)} ${where}; ${shortReason(on, at.totals, regime)}${left}`;
}

/**
 * A `wet` that doesn't hold where its application lands (a warning: it can't move the landing): the share of its core
 * shiny there, where it isn't, why and what to do.
 */
export function stampSheetWetShort(name: string, at: { tau: number; held: number; totals: Pick<StampSheetTotals, 'weight' | 'never'> }, boxes: readonly StampBox[], regime: StampSheetRegime): string {
  const { share, where } = shortfall(at, boxes);
  return `${name}: on 'wet' holds over ${share}% of its core (needs ${STAMP_SHEET_SHARE * 100}%) at model ${stampSheetSeconds(at.tau)} ${where}; ${shortReason('wet', at.totals, regime)}. It lands there all the same: \`wet\` never delays`;
}

/** A wash whose numeric origin comes before its layer's earlier washes have set: scene seconds both. */
export const stampSheetStartsWet = (wash: string, origin: number, earlier: string, until: number) =>
  `${wash} starts at ${stampSheetSeconds(origin)} while ${earlier} is still wet until ${stampSheetSeconds(until)}`;

/** A wash after an earlier wash of its layer whose paper holds water, on a sheet that never dries. */
export const stampSheetNeverSets = (wash: string, earlier: string) => `${wash} follows ${earlier}, under which the sheet never dries`;

/** A fixed `at` before the scene second its program predecessor landed at. */
export const stampSheetAtTooEarly = (name: string, at: number, predecessor: number) =>
  `${name}: fixed at ${stampSheetSeconds(at)} precedes its predecessor at ${stampSheetSeconds(predecessor)}`;

/** A fixed `at` where its `on` (`damp` or `dry`) doesn't hold: the share of its core it holds over there, and what to do. */
export const stampSheetAtFails = (name: string, at: number, on: StampSheetWetness, share: number) =>
  `${name}: at ${stampSheetSeconds(at)}, on '${on}' holds over ${Math.round(100 * share)}% of its core there: move the \`at\` to where \`studio paint check --solve\` says its paper is ${on}, or drop the \`on\``;

export const stampSheetEmptyCore = (name: string) => `${name}: its core is empty: nothing of it reaches paper`;

export const stampSheetWontBloom = (name: string) => `${name} won't bloom: no open paint on workable paper under its core`;

export const stampSheetWithinRounding = (name: string, on: StampSheetWetness) => `${name}: decided within rounding of on '${on}'; another GPU may place it a step apart`;

/**
 * Whether a decision lies within rounding: verification had to step past where the reductions placed it, or the
 * share it holds over clears its need by under 10⁻⁴ of the core.
 */
export const stampSheetNearRounding = (on: StampSheetWetness, totals: StampSheetTotals, stepped: boolean) =>
  stepped || (on !== 'dry' && stampSheetHeld(on, totals) - STAMP_SHEET_SHARE * totals.weight < 1e-4 * totals.weight);

const pct = (share: number) => `${(100 * share).toFixed(2)}%`;

/** The engine fault of a decision verification can't confirm within STAMP_SHEET_VERIFY_STEPS: both shares, and where. */
export function stampSheetVerifyFault(name: string, on: StampSheetWetness, tau: number, decided: number, verified: number): string {
  return `stamp sheet: ${name}'s on '${on}' was decided at ${pct(decided)} of its core, and the field's own law holds ${pct(verified)} at model ${stampSheetSeconds(tau)}, ${STAMP_SHEET_VERIFY_STEPS} steps past; an engine fault, not the painting's`;
}

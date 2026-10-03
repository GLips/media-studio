// stamp-sheet-schedule.ts: the forward scheduler's decisions, in f64 on the CPU, from the GPU's reductions over an
// application's core. Model time runs on a 1 ms grid anchored at each
// application's predecessor. A solve's state (StampSheetSolveState) moves on by the transitions here.
//
// The laws, per texel wetted to level ℓ at a, drying at rate r with open time o, sheen shiny h and damp d: wet while
// τ < U = a + (ℓ − h)/r; matte from L = a + (ℓ − d)/r; set from Z = a + o + ℓ/r. `on` holds over 95% of the core's
// weight ('dry' over all of it), checked again by the field's own law at the decided time.
//
// Negative space: no clock. Under `never` (r = 0) nothing here is defined.

import { STAMP_BLOOM_SURPLUS } from './stamp-wet-bloom.ts';
import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { StampPixelBox } from './stamp-blur-region.ts';
import type { StampBox } from './stamp-region.ts';
import type { StampSheetWetness } from './stamp-sheet-program.ts';
import { stampBoxUnion } from './stamp-stage.ts';
import type { StampWetting } from './stamp-wash-ledger.ts';
import { stampWetnessAt, stampWorkableAt, type StampDrying, type StampWashDrying, type StampWetLanding } from './stamp-wetness.ts';

/** The grid model time is decided on, s. */
export const STAMP_SHEET_STEP = 0.001;
/** The share of its core's weight `on: 'wet'` and `'damp'` hold over. */
export const STAMP_SHEET_SHARE = 0.95;
/** How many 1 ms steps verification may take past a decision before it's an engine fault: f32 rounding can't account for more. */
export const STAMP_SHEET_VERIFY_STEPS = 8;
/** Bins a damp histogram pass sorts weight into. */
export const STAMP_SHEET_BINS = 4096;
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

/**
 * What a solve decided for an entry, model s: τ0, the earliest it could land; when it landed; whether a drying closed
 * as its wash started (before its prewet) and as it landed; for its wash's last, when all its wash wetted has set
 * (null for another entry, or a wash that wetted nothing); and what its author should hear.
 */
export type StampSheetDecision = {
  tau0: number; tau: number; closes: { start: boolean; landing: boolean }; washSet: number | null; warnings: readonly string[];
};

/** The earliest time at or after `x` on the 1 ms grid anchored at `tau0`; `tau0` itself when `x` isn't past it. */
export function stampSheetGrid(tau0: number, x: number): number {
  if (!(x > tau0)) return tau0;
  return tau0 + STAMP_SHEET_STEP * Math.ceil((x - tau0) / STAMP_SHEET_STEP - 1e-9);
}

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

/**
 * A damp histogram: bins `width` 1 ms steps wide from step `start` (steps counted from τ0), the weight turning matte
 * (`matte`) and set (`set`) in each, and the weight that had before `start`.
 */
export type StampDampHistogram = { start: number; width: number; matte: Float64Array; set: Float64Array; matteBefore: number; setBefore: number };

/** A histogram pass's words read as one: two words a bin, matte's then set's, then before-start's two each. */
export function stampDampHistogram(words: Uint32Array, start: number, width: number): StampDampHistogram {
  const bins = STAMP_SHEET_BINS, matte = new Float64Array(bins), set = new Float64Array(bins);
  for (let b = 0; b < bins; b++) {
    matte[b] = stampSheetWide(words, 2 * b);
    set[b] = stampSheetWide(words, 2 * (bins + b));
  }
  return { start, width, matte, set, matteBefore: stampSheetWide(words, 4 * bins), setBefore: stampSheetWide(words, 4 * bins + 2) };
}

/** The words a histogram pass leaves. */
export const STAMP_DAMP_HISTOGRAM_WORDS = 4 * STAMP_SHEET_BINS + 4;

/**
 * Each bin's most damp weight: what's matte by its end less what's set by its start. For bins a step wide it's exact
 * at that step, less what sets at it too.
 */
export function stampDampBinBounds(histogram: StampDampHistogram): Float64Array {
  const bounds = new Float64Array(STAMP_SHEET_BINS);
  let matte = histogram.matteBefore, set = histogram.setBefore;
  for (let b = 0; b < STAMP_SHEET_BINS; b++) {
    matte += histogram.matte[b];
    if (histogram.width === 1) set += histogram.set[b];
    bounds[b] = matte - set;
    if (histogram.width !== 1) set += histogram.set[b];
  }
  return bounds;
}

/** The first histogram over steps 0..`last`: bins wide enough that 4096 of them reach it. */
export const stampDampFirstWidth = (last: number) => Math.max(1, Math.ceil((last + 1) / STAMP_SHEET_BINS));

/** A bin's refinement: its steps, binned 4096 ways. */
export const stampDampRefined = (histogram: StampDampHistogram, bin: number) => ({ start: histogram.start + bin * histogram.width, width: Math.ceil(histogram.width / STAMP_SHEET_BINS) });

/** The step of `kL` or `kZ` from a time, `tau0` and the time both after the same base: its first 1 ms step at or past it, at least 0. */
export const stampDampStep = (time: number, tau0: number) => Math.max(0, Math.ceil((time - tau0) / STAMP_SHEET_STEP - 1e-9));

/**
 * The search for `damp`'s first step, a bin at a time: each bin whose bound reaches `need`, in order, refined until
 * its bins are a step wide; `refine` reads a bin's refinement off the GPU. Resolves the first step reaching `need`,
 * or null, and the most damp weight it saw anywhere (an upper bound) and at which step.
 */
export async function stampDampFirstStep(
  first: StampDampHistogram, need: number, refine: (at: { start: number; width: number }) => Promise<StampDampHistogram>,
): Promise<{ step: number | null; most: { weight: number; step: number } }> {
  const most = { weight: 0, step: first.start };
  const search = async (histogram: StampDampHistogram): Promise<number | null> => {
    const bounds = stampDampBinBounds(histogram);
    for (let b = 0; b < STAMP_SHEET_BINS; b++) {
      if (bounds[b] > most.weight) Object.assign(most, { weight: bounds[b], step: histogram.start + b * histogram.width });
    }
    // Bins are searched in order, each refined before the next is looked at: the first reaching step is the answer.
    const from = async (after: number): Promise<number | null> => {
      const bin = bounds.findIndex((bound, b) => b >= after && bound >= need);
      if (bin < 0) return null;
      if (histogram.width === 1) return histogram.start + bin;
      return (await search(await refine(stampDampRefined(histogram, bin)))) ?? from(bin + 1);
    };
    return from(0);
  };
  return { step: await search(first), most };
}

const boxArea = (b: StampBox) => (b.x1 - b.x0) * (b.y1 - b.y0);
const boxUnion = (a: StampBox, b: StampBox) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/**
 * The marked cells of a failure map (`columns` × `rows`, row by row, cells STAMP_SHEET_FAILURE_CELL px from (x, y)):
 * each connected run's box in document px, merged two at a time (the pair growing least) down to
 * STAMP_SHEET_FAILURE_BOXES.
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
    boxes.push({
      x0: Math.max(0, origin.x + x0 * cell), y0: Math.max(0, origin.y + y0 * cell),
      x1: Math.min(limit.width, origin.x + (x1 + 1) * cell), y1: Math.min(limit.height, origin.y + (y1 + 1) * cell),
    });
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
 * A solve's state between steps, all a checkpoint keeps beside its films and clip bases (ENGINE 4.5): the field's
 * time base and the last decided τ (model s); each film's painted box and each wash's wetted boxes (stage texels);
 * the paper touched since the last drying, whether anything landed there, and when it sets (-Infinity unread); its water.
 */
export type StampSheetSolveState = {
  base: number; tau: number; painted: readonly (StampPixelBox | null)[]; wetted: readonly (readonly StampPixelBox[])[];
  since: StampPixelBox | null; landedSince: boolean; knownSetAt: number; water: StampSheetWater;
};

/** A solve's state before anything lands: `films` films and `washes` washes, on dry paper at 0 s. */
export const stampSheetSolveStart = (films: number, washes: number): StampSheetSolveState => ({
  base: 0, tau: 0, painted: Array.from({ length: films }, () => null), wetted: Array.from({ length: washes }, () => []),
  since: null, landedSince: false, knownSetAt: -Infinity, water: { wettings: [], since: [], wettest: 0, dryings: 0 },
});

/** `state` with its time base moved up by whole seconds once `tau` is STAMP_SHEET_REBASE past it, and the move (0 for none). */
export function stampSheetRebased(state: StampSheetSolveState, tau: number): { state: StampSheetSolveState; shift: number } {
  if (tau - state.base < STAMP_SHEET_REBASE) return { state, shift: 0 };
  const shift = Math.floor(tau - state.base);
  return { state: { ...state, base: state.base + shift }, shift };
}

/** `state` with `tau` decided. */
export const stampSheetDecided = (state: StampSheetSolveState, tau: number): StampSheetSolveState => ({ ...state, tau });

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
    ...(box && { since: stampBoxUnion(state.since, box), landedSince: true, wetted: state.wetted.with(wash, [...state.wetted[wash], box]) }),
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
    ...state, since: stampBoxUnion(state.since, box), wetted: state.wetted.with(wash, [...state.wetted[wash], box]),
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

/** A model time as messages print it: to the millisecond. */
export const stampSheetSeconds = (tau: number) => `${Number(tau.toFixed(3))} s`;

/** Why an application can't be reached, the one clause its failure gives: water it never met, or its rule's own. */
function unreachableReason(on: StampSheetWetness, totals: Pick<StampSheetTotals, 'weight' | 'never'>): string {
  if (totals.never > (1 - STAMP_SHEET_SHARE) * totals.weight) return 'never wetted on this sheet';
  return on === 'wet' ? "not shiny at its predecessor's time" : 'sets before the rest turns matte';
}

/**
 * An unreachable application's problem: its rule, the most of its core that held it (an upper bound), when, where it
 * failed, why, and the applications of its sheet left unscheduled.
 */
export function stampSheetUnreachable(
  name: string, on: StampSheetWetness, at: { tau: number; held: number; totals: Pick<StampSheetTotals, 'weight' | 'never'> }, boxes: readonly StampBox[], unscheduled: readonly string[],
): string {
  const share = Math.round((100 * at.held) / Math.max(1, at.totals.weight));
  const where = boxes.map(({ x0, y0, x1, y1 }) => `[${x0},${y0} → ${x1},${y1}]`).join(' ');
  const left = unscheduled.length ? `. Unscheduled after it: ${unscheduled.join(', ')}` : '';
  return `${name}: unreachable from this committed prefix: on '${on}' held over at most ${share}% of its core (needs ${STAMP_SHEET_SHARE * 100}%), at model ${stampSheetSeconds(at.tau)} ${where}; ${unreachableReason(on, at.totals)}${left}`;
}

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

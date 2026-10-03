// stamp-sheet-wrap.ts: how a sheet's solve paints it (stampSheetSolvePlan), a wrapped one (`wrap: 'x'`) banded: a
// halo past the frame, every mark copied a wrap left and right as far as it reaches, so paint by one edge meets what
// lies past the other; only the frame is kept. A copy reads noise, grain and fields as its stamp (`rest`, `wrapFrom`).
//
// Negative space: y doesn't wrap. A deposit wider than the wrap reads its fields within the one wrap round its
// middle, so a field jumps where that ends. The halo bounds one entry's reach: at the stage's edge a flow meets a
// wall, so a long chain of wet-in-wet entries across the seam may drift into a faint seam.

import { stampBristleTipSpan } from '#lib/paint/brush/models/stamp-bristle-tip.ts';
import type { StampBrush, StampBrushLayer } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampFrozenMarks, type FrozenStampMarks } from '#lib/paint/brush/models/stamp-placement.ts';
import { stampAreaBox } from './stamp-area.ts';
import { stampBrushedMasksUnder } from './stamp-brushed-mask.ts';
import { stampActiveLayers } from './stamp-deposit-stages.ts';
import { stampDepositWater } from './stamp-paint-action.ts';
import type { CompiledStampDeposit, CompiledStampMask } from './stamp-paint-recipe-compile.ts';
import type { StampSheetProgram, StampSheetPrewet } from './stamp-sheet-program.ts';
import { stampCanonicalJson } from './stamp-sheet-state-key.ts';
import { stampStage, type StampStage } from './stamp-stage.ts';
import { stampSheetWetReach } from './stamp-wet-reach.ts';

/**
 * How far one of `marks`' stamps may lay paint from its place, px, drawn with `brush`'s tip (its dual's for a dual's):
 * its tip's square, span wide, turned any way about a place near its middle.
 */
function stampMarksTipReach(marks: FrozenStampMarks, brush: Pick<StampBrushLayer, 'tip'>): number {
  const { tip } = brush;
  let most = 0;
  for (const { diameter } of marks) most = Math.max(most, 0.75 * diameter * ('bristles' in tip ? stampBristleTipSpan(tip.bristles, diameter) : tip.span ?? 1));
  return most;
}

/** How far past its stamps' places `marks` (a deposit's or a brushed mask's) may lay paint, its edges' blur included, px. */
function stampMarksReach(marks: { brush: StampBrush; diameter: number; stamps: FrozenStampMarks; dualStamps: FrozenStampMarks }): number {
  const sigma = stampActiveLayers(marks.brush, marks.diameter).edgeSigma;
  const tips = Math.max(stampMarksTipReach(marks.stamps, marks.brush), marks.brush.dual ? stampMarksTipReach(marks.dualStamps, marks.brush.dual) : 0);
  return tips + (sigma > 0 ? 3 * sigma : 2);
}

/** The least halo a wrapped sheet is solved with, px. */
const STAMP_SHEET_LEAST_HALO = 16;

const halos = new WeakMap<StampSheetProgram, number>();

/**
 * The halo a wrapped `program` is solved with, px: the farthest any mark may lay paint or carry water past its place
 * (stampSheetWetReach), rounded up to a power of two. It's in K₀: rounding keeps an edit or pose widening the widest
 * reach a little from re-keying the sheet; one past a power of two re-keys it.
 */
export function stampSheetWrapHalo(program: StampSheetProgram): number {
  const known = halos.get(program);
  if (known !== undefined) return known;
  const media = [...new Set(program.films.map(({ medium }) => medium))];
  let most = 0;
  for (const { deposit, medium, wash } of program.entries) {
    const water = stampDepositWater(deposit, program.films[program.washes[wash].film].medium);
    most = Math.max(most, stampMarksReach(deposit) + stampSheetWetReach(media, deposit, medium, water));
  }
  const masks = [...program.entries.map(({ deposit }) => deposit.mask), ...program.washes.map(({ prewet }) => prewet?.held)];
  for (const brushed of stampBrushedMasksUnder(masks)) for (const mark of brushed.marks) most = Math.max(most, stampMarksReach(mark));
  const halo = Math.max(STAMP_SHEET_LEAST_HALO, 2 ** Math.ceil(Math.log2(Math.max(1, most))));
  halos.set(program, halo);
  return halo;
}

/**
 * `marks` with each stamp followed by its copies a whole number of wraps (`wrap` px) away whose places lie within
 * `reach` px of the frame: twice the halo, as far as a stamp on the stage's edge may lay paint from. A copy keeps
 * its stamp's rest, where its tip noise and rolling grain are read.
 */
export function stampMarksWrapped(marks: FrozenStampMarks, wrap: number, reach: number): FrozenStampMarks {
  const copied: FrozenStampMarks[number][] = [];
  for (const stamp of marks) {
    copied.push(stamp);
    const rest = stamp.rest ?? Object.freeze({ x: stamp.x, y: stamp.y });
    const first = Math.ceil((-reach - stamp.x) / wrap), last = Math.floor((wrap + reach - stamp.x) / wrap);
    for (let k = first; k <= last; k++) if (k !== 0) copied.push({ ...stamp, x: stamp.x + k * wrap, rest });
  }
  return stampFrozenMarks(copied);
}

/** The x a deposit planned over `x0..x1` reads its fields within a wrap of: the wrap centred on it. */
const stampWrapFrom = (x0: number, x1: number, wrap: number) => (Number.isFinite(x0) ? (x0 + x1) / 2 - wrap / 2 : 0);

/** The least and most x of `marks`' places, folded into `into`. */
function stampMarksSpan(marks: FrozenStampMarks, into: [number, number]) {
  for (const { x } of marks) {
    into[0] = Math.min(into[0], x);
    into[1] = Math.max(into[1], x);
  }
}

/**
 * How `program` is solved: on `stage`, its states keyed from `head` (K₀'s text), painting `painted()`'s marks. A sheet
 * that doesn't wrap is solved as it is; one that wraps, banded on a stage its halo past each side, keyed apart from
 * any other halo's. `painted` is made only when the sheet is painted, not when its films are known.
 */
export type StampSheetSolvePlan = { readonly stage: StampStage; readonly head: string; readonly painted: () => StampSheetProgram };

export function stampSheetSolvePlan(program: StampSheetProgram): StampSheetSolvePlan {
  if (program.wrap !== 'x') return { stage: stampStage(program), head: program.head, painted: () => program };
  const halo = stampSheetWrapHalo(program);
  return { stage: stampStage(program, halo, 'x'), head: stampSheetWrapHead(program, halo), painted: () => stampSheetBanded(program, halo) };
}

/** K₀'s text for wrapped `program` solved with `halo`: its states keyed apart from any other halo's. */
const stampSheetWrapHead = (program: StampSheetProgram, halo: number) => stampCanonicalJson({ wrapped: program.head, halo });

const banded = new WeakMap<StampSheetProgram, StampSheetProgram>();

/**
 * `program` (one that wraps) as its solve paints it, `halo` (its stampSheetWrapHalo) px past each side: its marks
 * copied round the seam, each deposit and prewet reading its fields within a wrap of where it was planned. Made once a
 * program, so what loading remembers by its marks is met again; its head is the plan's.
 */
function stampSheetBanded(program: StampSheetProgram, halo: number): StampSheetProgram {
  const known = banded.get(program);
  if (known) return known;
  const wrap = program.width, reach = 2 * halo;
  const wrapped = new Map<CompiledStampMask, CompiledStampMask>();
  const fluid = (mask: CompiledStampMask | null): CompiledStampMask | null => {
    if (!mask) return null;
    const seen = wrapped.get(mask);
    if (seen) return seen;
    const under = fluid(mask.under);
    const next: CompiledStampMask = mask.kind === 'brushed'
      ? { ...mask, under, brushed: { ...mask.brushed, marks: mask.brushed.marks.map((mark) => ({ ...mark, stamps: stampMarksWrapped(mark.stamps, wrap, reach), dualStamps: stampMarksWrapped(mark.dualStamps, wrap, reach) })) } }
      : { ...mask, under };
    wrapped.set(mask, next);
    return next;
  };
  const deposit = (planned: CompiledStampDeposit): CompiledStampDeposit => {
    const span: [number, number] = [Infinity, -Infinity];
    stampMarksSpan(planned.stamps, span);
    stampMarksSpan(planned.dualStamps, span);
    if (planned.kind === 'flood') {
      const { x0, x1 } = stampAreaBox(planned.flood.barrier);
      span[0] = Math.min(span[0], x0);
      span[1] = Math.max(span[1], x1);
    }
    return {
      ...planned, stamps: stampMarksWrapped(planned.stamps, wrap, reach), dualStamps: stampMarksWrapped(planned.dualStamps, wrap, reach),
      mask: fluid(planned.mask), wrapFrom: stampWrapFrom(span[0], span[1], wrap),
    };
  };
  const prewet = (planned: StampSheetPrewet): StampSheetPrewet => {
    const { x0, x1 } = stampAreaBox(planned.area);
    return { ...planned, held: fluid(planned.held), anchored: new Set([...planned.anchored].map((mask) => fluid(mask)!)), wrapFrom: stampWrapFrom(x0, x1, wrap) };
  };
  const made: StampSheetProgram = {
    ...program,
    washes: program.washes.map((wash) => ({ ...wash, prewet: wash.prewet && prewet(wash.prewet) })),
    entries: program.entries.map((entry) => ({ ...entry, deposit: deposit(entry.deposit) })),
    head: stampSheetWrapHead(program, halo),
  };
  banded.set(program, made);
  return made;
}

// stamp-sheet-wrap.ts: how a sheet's solve paints it (stampSheetSolvePlan), a wrapped one banded: a halo past the
// frame, every mark copied whole periods along each axis that wraps (across the corner when both do) as far as it
// reaches, so paint by one edge meets what lies past the other; only the frame is kept. A copy reads noise, grain
// and fields as its stamp (`rest`, `wrapFrom`).
//
// Negative space (docs/brush-engine.md): a deposit longer than a period reads its fields within one wrap; the halo
// bounds one entry's reach, so a long wet-in-wet chain across a seam may drift; an axis that doesn't wrap has the
// halo too, so water runs off its edges.

import { stampBristleTipSpan } from '#lib/paint/brush/models/stamp-bristle-tip.ts';
import type { StampBrush, StampBrushLayer } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampFrozenMarks, type FrozenStampMarks } from '#lib/paint/brush/models/stamp-placement.ts';
import { stampAreaBox } from './stamp-area.ts';
import type { StampBox } from './stamp-region.ts';
import { stampBrushedMasksUnder } from './stamp-brushed-mask.ts';
import { stampActiveLayers } from './stamp-deposit-stages.ts';
import { stampDepositWater } from './stamp-paint-action.ts';
import type { CompiledStampDeposit, CompiledStampMask } from './stamp-paint-recipe-compile.ts';
import type { StampSheetProgram, StampSheetPrewet } from './stamp-sheet-program.ts';
import { stampCanonicalJson } from './stamp-canonical.ts';
import { stampStage, stampWrapOffsets, type StampStage, type StampWrapFrom, type StampWrapPeriods } from './stamp-stage.ts';
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
export function stampMarksReach(marks: { brush: StampBrush; diameter: number; stamps: FrozenStampMarks; dualStamps: FrozenStampMarks }): number {
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
 * `marks` with each stamp followed by its copies whole periods away on each axis that wraps (`periods`), the corner's
 * too, whose places lie within `reach` px of the frame: twice the halo, as far as a stamp on the stage's edge may lay
 * paint from. A copy keeps its stamp's rest, where tip noise and rolling grain are read.
 */
function stampMarksWrapped(marks: FrozenStampMarks, periods: StampWrapPeriods, reach: number): FrozenStampMarks {
  const copied: FrozenStampMarks[number][] = [];
  for (const stamp of marks) {
    copied.push(stamp);
    const rest = stamp.rest ?? Object.freeze({ x: stamp.x, y: stamp.y });
    const at = { x0: stamp.x, y0: stamp.y, x1: stamp.x, y1: stamp.y };
    for (const [dx, dy] of stampWrapOffsets(periods, at, reach)) if (dx || dy) copied.push({ ...stamp, x: stamp.x + dx, y: stamp.y + dy, rest });
  }
  return stampFrozenMarks(copied);
}

/** Where along an axis repeating every `period` px a deposit spanning `low..high` starts the wrap centred on it; 0 unread. */
const stampWrapFromAlong = (low: number, high: number, period: number) => (period && Number.isFinite(low) ? (low + high) / 2 - period / 2 : 0);

/**
 * Where a deposit planned over `box` reads its fields within a wrap of, on each axis `periods` wraps: the wrap centred
 * on it; 0 on an axis that doesn't, and for a deposit of nothing.
 */
const stampWrapFrom = (box: StampBox, periods: StampWrapPeriods): StampWrapFrom =>
  ({ x: stampWrapFromAlong(box.x0, box.x1, periods.x), y: stampWrapFromAlong(box.y0, box.y1, periods.y) });

/** `marks`' places folded into `into`. */
function stampMarksSpan(marks: FrozenStampMarks, into: StampBox) {
  for (const { x, y } of marks) {
    into.x0 = Math.min(into.x0, x);
    into.y0 = Math.min(into.y0, y);
    into.x1 = Math.max(into.x1, x);
    into.y1 = Math.max(into.y1, y);
  }
}

/**
 * How `program` is solved: on `stage`, its states keyed from `head` (K₀'s text), painting `painted()`'s marks. A sheet
 * that doesn't wrap is solved as it is; one that wraps, banded on a stage its halo past each side, keyed apart from
 * any other halo's. `painted` is made only when the sheet is painted, not when its films are known.
 */
export type StampSheetSolvePlan = { readonly stage: StampStage; readonly head: string; readonly painted: () => StampSheetProgram };

export function stampSheetSolvePlan(program: StampSheetProgram): StampSheetSolvePlan {
  if (program.wrap === null) return { stage: stampStage(program), head: program.head, painted: () => program };
  const halo = stampSheetWrapHalo(program), stage = stampStage(program, halo, program.wrap);
  return { stage, head: stampSheetWrapHead(program, halo), painted: () => stampSheetBanded(program, stage) };
}

/** K₀'s text for wrapped `program` solved with `halo`: its states keyed apart from any other halo's. */
const stampSheetWrapHead = (program: StampSheetProgram, halo: number) => stampCanonicalJson({ wrapped: program.head, halo });

const banded = new WeakMap<StampSheetProgram, StampSheetProgram>();

/**
 * `program` (one that wraps) as its solve paints it on `stage` (its plan's, its halo the margin): its marks copied
 * round each seam, each deposit and prewet reading its fields within a wrap of where it was planned. Made once a
 * program, so what loading remembers by its marks is met again; its head is the plan's.
 */
function stampSheetBanded(program: StampSheetProgram, stage: StampStage): StampSheetProgram {
  const known = banded.get(program);
  if (known) return known;
  const periods = stage.wrapPeriods, reach = 2 * stage.margin;
  const copiedRound = (marks: FrozenStampMarks) => stampMarksWrapped(marks, periods, reach);
  const wrapped = new Map<CompiledStampMask, CompiledStampMask>();
  const fluid = (mask: CompiledStampMask | null): CompiledStampMask | null => {
    if (!mask) return null;
    const seen = wrapped.get(mask);
    if (seen) return seen;
    const under = fluid(mask.under);
    const next: CompiledStampMask = mask.kind === 'brushed'
      ? { ...mask, under, brushed: { ...mask.brushed, marks: mask.brushed.marks.map((mark) => ({ ...mark, stamps: copiedRound(mark.stamps), dualStamps: copiedRound(mark.dualStamps) })) } }
      : { ...mask, under };
    wrapped.set(mask, next);
    return next;
  };
  const deposit = (planned: CompiledStampDeposit): CompiledStampDeposit => {
    const span: StampBox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    stampMarksSpan(planned.stamps, span);
    stampMarksSpan(planned.dualStamps, span);
    if (planned.kind === 'flood') {
      const barrier = stampAreaBox(planned.flood.barrier);
      Object.assign(span, { x0: Math.min(span.x0, barrier.x0), y0: Math.min(span.y0, barrier.y0), x1: Math.max(span.x1, barrier.x1), y1: Math.max(span.y1, barrier.y1) });
    }
    return {
      ...planned, stamps: copiedRound(planned.stamps), dualStamps: copiedRound(planned.dualStamps), mask: fluid(planned.mask), wrapFrom: stampWrapFrom(span, periods),
    };
  };
  const prewet = (planned: StampSheetPrewet): StampSheetPrewet => ({
    ...planned, held: fluid(planned.held), anchored: new Set([...planned.anchored].map((mask) => fluid(mask)!)), wrapFrom: stampWrapFrom(stampAreaBox(planned.area), periods),
  });
  const made: StampSheetProgram = {
    ...program,
    washes: program.washes.map((wash) => ({ ...wash, prewet: wash.prewet && prewet(wash.prewet) })),
    entries: program.entries.map((entry) => ({ ...entry, deposit: deposit(entry.deposit) })),
    head: stampSheetWrapHead(program, stage.margin),
  };
  banded.set(program, made);
  return made;
}

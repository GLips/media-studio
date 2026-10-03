// stamp-gate-clocks-page.ts: the gate page's clocked sheets (stamp-gate-clocks.ts), schedule/clocks: each solved on a
// device of its own, its decisions, films and refusals read back; and two playbacks, each prefix shown at a scene
// second drawn as a still and held to a fresh solve of that prefix, drawn on a surface of its own.

import { paintingSolveLines } from '#lib/paint/document/models/painting-solve-report.ts';
import type { StampSheetProgram } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { stampSheetEmptyCore, stampSheetGrid } from '#lib/paint/painting/models/stamp-sheet-schedule.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { drawStampSheetsStill, type StampSheetsComposite } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import type { StampSheetFilmKept } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import { solveStampSheet, type StampSheetSolveOptions } from '#lib/paint/painting/studio/stamp-sheet-solver.ts';
import {
  checkStampGateMoments, STAMP_GATE_CLOCKED, STAMP_GATE_DRAWING, STAMP_GATE_DRAWING_PLAYBACK, STAMP_GATE_DRAWN, STAMP_GATE_FIXED_TOO_EARLY, STAMP_GATE_FORWARD_SCALED,
  STAMP_GATE_INSTANT_REFUSAL, STAMP_GATE_INTERLEAVE, STAMP_GATE_INTERLEAVED, STAMP_GATE_NEVER_REFUSAL, STAMP_GATE_POND_ALONE, STAMP_GATE_SET_ORIGIN, STAMP_GATE_SET_PLAYBACK,
  STAMP_GATE_STRAY, STAMP_GATE_STRAY_MOMENT, stampGateClockedMoments, stampGateFixedTooEarlyMessage,
} from '../models/stamp-gate-clocks.ts';
import { stampGateFrameDifference, stampGateFramePasses } from '../models/stamp-gate-frames.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { stampGateFilmsEqual, stampGateForwardTimes, stampGateSheetProgram } from '../models/stamp-gate-sheets.ts';
import { withGateSurface } from './stamp-gate-page-surface.ts';
import { stampGateRejection, stampGateSheetImageUrl, stampGateSolvedFilms, withStampGateSheetOwner } from './stamp-gate-sheet-owner.ts';

const ID = 'schedule/clocks';
const namesOf = ({ entries }: StampSheetProgram) => entries.map(({ name }) => name);
/** A root sheet's kept `films` as a composite of it alone, at rest on its paper. */
const aloneOnPaper = (program: StampSheetProgram, films: readonly StampSheetFilmKept[]): StampSheetsComposite =>
  ({ sheets: [{ program, films, place: null }], steps: program.films.map((_, film) => ({ kind: 'film', sheet: 0, film }) as const) });
const refusedAs = (refused: string | null, { starts, ends }: { starts: string; ends: string }) => !!refused && refused.startsWith(starts) && refused.endsWith(ends);

/** The pool on a scale: every moment its closed form's, scene seconds from τc. */
async function checkScale(owner: StampPaintGpuOwner): Promise<StampGateWashCheck> {
  const program = stampGateSheetProgram(STAMP_GATE_CLOCKED);
  const { decisions } = await solveStampSheet(owner, program);
  return checkStampGateMoments(`${ID}: scale`, decisions, stampGateClockedMoments(), namesOf(program));
}

/**
 * The pool at `instant`: each clocked application after the first closes a drying as it lands, later than the one
 * before, at its order time; a charge `on: 'wet'` over the flood is refused.
 */
async function checkInstant(owner: StampPaintGpuOwner): Promise<StampGateWashCheck> {
  const refused = await stampGateRejection(solveStampSheet(owner, stampGateSheetProgram(STAMP_GATE_CLOCKED, { drying: 'instant' })));
  const plain = stampGateSheetProgram(STAMP_GATE_CLOCKED, { drying: 'instant', rules: false }), names = namesOf(plain);
  const { decisions } = await solveStampSheet(owner, plain);
  const first = plain.entries.findIndex(({ orderTime }) => orderTime !== null);
  const closing = decisions.flatMap(({ tau, closes }, k) => (k > first && !(closes.landing && tau > decisions[k - 1].tau) ? [names[k]] : []));
  const offClock = decisions.flatMap(({ scene }, k) => (scene === plain.entries[k].orderTime ? [] : [names[k]]));
  return {
    id: `${ID}: instant`, passed: !closing.length && !offClock.length && refusedAs(refused, STAMP_GATE_INSTANT_REFUSAL),
    detail: `${closing.length ? `no drying closed before ${closing.join(', ')}` : 'a drying closed before each'}; ${offClock.length ? `off their order times: ${offClock.join(', ')}` : 'each at its order time'}; ${refused ?? 'the charge solved'}`,
  };
}

/** The pool at `never`: a bloom `on: 'damp'` over the flood refused at τ0; the prefix before it all at model 0 s. */
async function checkNever(owner: StampPaintGpuOwner): Promise<StampGateWashCheck> {
  const program = stampGateSheetProgram(STAMP_GATE_CLOCKED, { drying: 'never' });
  const refused = await stampGateRejection(solveStampSheet(owner, program));
  const { decisions } = await solveStampSheet(owner, program, { through: 3 });
  const moments = checkStampGateMoments(`${ID}: never`, decisions, [{ tau: 0, scene: null }, { tau: 0, scene: 2 }, { tau: 0, scene: 2 }], namesOf(program).slice(0, 3));
  return { ...moments, passed: moments.passed && refusedAs(refused, STAMP_GATE_NEVER_REFUSAL), detail: `${moments.detail}; ${refused ?? 'the bloom solved'}` };
}

/**
 * The `'set'` wash: it starts once the first has set, the time printed for both the same; its prewet laid at its
 * start, closing the drying, and read by its charge `on: 'wet'`, landing there.
 */
async function checkSetOrigin(owner: StampPaintGpuOwner): Promise<StampGateWashCheck> {
  const program = stampGateSheetProgram(STAMP_GATE_SET_ORIGIN);
  const { decisions } = await solveStampSheet(owner, program);
  const [first, charge] = decisions, lines = paintingSolveLines(program, decisions);
  const printed = (pattern: RegExp) => lines.map((line) => pattern.exec(line)?.[1]).find((scene) => scene !== undefined) ?? null;
  const setBy = printed(/^ {2}first: set by scene (\S+ s)/), startsAt = printed(/^second \(.+\): starts at scene (\S+ s)/);
  const starts = !!first.washSet && !!charge.start && charge.start.tau === stampSheetGrid(0, first.washSet.tau);
  return {
    id: `${ID}: set origin`, passed: starts && setBy !== null && setBy === startsAt && charge.tau === charge.start!.tau && charge.closes.start && !charge.warnings.length,
    detail: lines.join(' | '),
  };
}

/** Two layers' washes in their order times, a tie in document order; the water's film the same without the reeds between its ripples. */
async function checkInterleave(owner: StampPaintGpuOwner): Promise<StampGateWashCheck> {
  const program = stampGateSheetProgram(STAMP_GATE_INTERLEAVE), names = namesOf(program);
  const reeds = await stampGateSolvedFilms(owner, program), alone = await stampGateSolvedFilms(owner, stampGateSheetProgram(STAMP_GATE_INTERLEAVE, { reeds: false }));
  const ordered = names.join() === STAMP_GATE_INTERLEAVED.map(({ name }) => name).join(), same = stampGateFilmsEqual(reeds.films[0], alone.films[0]);
  const moments = checkStampGateMoments(`${ID}: interleave`, reeds.solved.decisions, STAMP_GATE_INTERLEAVED, names);
  return { ...moments, passed: moments.passed && ordered && same, detail: `${moments.detail}; the water's film ${same ? 'the same' : 'changed'} without the reeds` };
}

/** A fixed `at` before its predecessor's landing refused to the letter; one on an empty core landing at its `at`, warned. */
async function checkFixedAt(owner: StampPaintGpuOwner): Promise<StampGateWashCheck[]> {
  const refused = await stampGateRejection(solveStampSheet(owner, stampGateSheetProgram(STAMP_GATE_FIXED_TOO_EARLY))), message = stampGateFixedTooEarlyMessage();
  const { decisions } = await solveStampSheet(owner, stampGateSheetProgram(STAMP_GATE_STRAY)), stray = decisions[1];
  const lands = stray.tau === STAMP_GATE_STRAY_MOMENT.tau && stray.scene === STAMP_GATE_STRAY_MOMENT.scene && stray.warnings.includes(stampSheetEmptyCore('stray'));
  return [
    { id: `${ID}: fixed at too early`, passed: refused === message, detail: refused ?? 'solved' },
    { id: `${ID}: empty core`, passed: lands, detail: `stray at ${stray.tau} s, scene ${stray.scene}; warned: ${stray.warnings.join('; ') || 'nothing'}` },
  ];
}

/** Crayon lines landing at their `at`s beside the pond, whose film and decisions are the same without them. */
async function checkDrawing(owner: StampPaintGpuOwner): Promise<StampGateWashCheck> {
  const program = stampGateSheetProgram(STAMP_GATE_DRAWING), lone = stampGateSheetProgram(STAMP_GATE_DRAWING, { drawing: false });
  const drawn = await stampGateSolvedFilms(owner, program), pond = await stampGateSolvedFilms(owner, lone);
  const moments = checkStampGateMoments(`${ID}: drawing`, drawn.solved.decisions, STAMP_GATE_DRAWN, namesOf(program));
  const alone = checkStampGateMoments(`${ID}: drawing`, pond.solved.decisions, STAMP_GATE_POND_ALONE, namesOf(lone));
  const ponds = program.entries.flatMap(({ wash }, k) => (program.washes[wash].wetHistory ? [drawn.solved.decisions[k]] : []));
  const same = stampGateFilmsEqual(drawn.films[0], pond.films[0]) && JSON.stringify(ponds) === JSON.stringify(pond.solved.decisions);
  return { ...moments, passed: moments.passed && alone.passed && same, detail: `${moments.detail}; the pond ${same ? 'the same' : 'changed'} without the drawing` };
}

/** The forward sheet at a scale with no clocked wash: its unclocked closed forms in model seconds, no clock. */
async function checkUnclockedScale(owner: StampPaintGpuOwner): Promise<StampGateWashCheck> {
  const program = stampGateSheetProgram(STAMP_GATE_FORWARD_SCALED);
  const { decisions } = await solveStampSheet(owner, program);
  const moments = checkStampGateMoments(`${ID}: unclocked at a scale`, decisions, stampGateForwardTimes().map((tau) => ({ tau, scene: null })), namesOf(program));
  return { ...moments, passed: moments.passed && program.clock.kind === 'none', detail: `${moments.detail}; clock ${program.clock.kind}` };
}

/** `program` solved as `options` say on a surface of its own, its still drawn and read back, and how many entries it shows. */
async function stillOf(program: StampSheetProgram, options: StampSheetSolveOptions) {
  return withGateSurface(program, stampGateSheetImageUrl, async (surface, frame) => {
    const solved = await solveStampSheet(surface.owner, program, options);
    await drawStampSheetsStill(surface, aloneOnPaper(program, solved.films));
    await surface.owner.device.queue.onSubmittedWorkDone();
    return { through: solved.through, frame: frame() };
  });
}

/**
 * `program` played forward on one surface at each `at` in `plan`: each prefix showing its `through` entries, its still
 * passing against a fresh solve of them, finished, and, `appears`, moved from the still before it.
 */
async function checkPlayback(name: string, program: StampSheetProgram, plan: readonly { at: number; through: number }[], appears: boolean): Promise<StampGateWashCheck> {
  const shown = await withGateSurface(program, stampGateSheetImageUrl, (surface, frame) => plan.reduce<Promise<{ through: number; frame: Uint8ClampedArray }[]>>(async (done, { at }) => {
    const list = await done, solved = await solveStampSheet(surface.owner, program, { at });
    await drawStampSheetsStill(surface, aloneOnPaper(program, solved.films));
    await surface.owner.device.queue.onSubmittedWorkDone();
    list.push({ through: solved.through, frame: frame() });
    return list;
  }, Promise.resolve([])));
  const fresh = await plan.reduce<Promise<Uint8ClampedArray[]>>(async (done, { through }) => [...await done, (await stillOf(program, { through, finish: true })).frame], Promise.resolve([]));
  const steps = plan.map(({ at, through }, i) => {
    const { max, mean } = stampGateFrameDifference(shown[i].frame, fresh[i]);
    const moved = i === 0 || !stampGateFramePasses(stampGateFrameDifference(shown[i].frame, shown[i - 1].frame));
    return { passed: shown[i].through === through && stampGateFramePasses({ max, mean, overTwo: 0 }) && (!appears || moved), text: `at ${at} s: ${shown[i].through} of ${through} entries, max ${max}, mean ${mean.toFixed(4)}${appears && !moved ? ', unchanged' : ''}` };
  });
  return { id: `${ID}: playback ${name}`, passed: steps.every(({ passed }) => passed), detail: steps.map(({ text }) => text).join('; ') };
}

/** schedule/clocks' checks. */
export async function checkStampGateClocks(): Promise<StampGateWashCheck[]> {
  const solved = await withStampGateSheetOwner(async (owner) => [
    await checkScale(owner), await checkInstant(owner), await checkNever(owner), await checkSetOrigin(owner), await checkInterleave(owner),
    ...await checkFixedAt(owner), await checkDrawing(owner), await checkUnclockedScale(owner),
  ]);
  return [
    ...solved,
    await checkPlayback('set', stampGateSheetProgram(STAMP_GATE_SET_ORIGIN), STAMP_GATE_SET_PLAYBACK, false),
    await checkPlayback('drawing', stampGateSheetProgram(STAMP_GATE_DRAWING), STAMP_GATE_DRAWING_PLAYBACK, true),
  ];
}

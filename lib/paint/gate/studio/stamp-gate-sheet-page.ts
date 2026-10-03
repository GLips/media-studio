// stamp-gate-sheet-page.ts: the gate page's sheet solves (stamp-gate-sheets.ts): documents compiled with the gate's
// brushes and solved on devices of their own, their decisions and kept films read back; their stills for the solved
// baselines; and the reductions run alone over textures written here.

import * as meadowSource from '#lib/paint/document/models/meadow.painting.ts';
import { compilePaintingSelection, type PaintingSelectionCompiled } from '#lib/paint/document/models/painting-document-compile.ts';
import { painting, type PaintingEvaluation } from '#lib/paint/document/models/painting-source.ts';
import { stampFilmCoverage } from '#lib/paint/document/studio/painting-film-readback.ts';
import { solvePaintingSheets, type PaintingSheetsSolved } from '#lib/paint/document/studio/painting-sheets-solve.ts';
import { createStampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import type { StampSheetProgram } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { STAMP_SHEET_REBASE } from '#lib/paint/painting/models/stamp-sheet-schedule.ts';
import { createStampPaintGpuOwner, type StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { readStampFilmCoverage } from '#lib/paint/painting/studio/stamp-film-readback.ts';
import { drawStampSheetsStill, readStampSheetsPicture } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import { readStampSheetFilm } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import { solveStampSheet, type StampSheetSolved, type StampSheetSolveOptions } from '#lib/paint/painting/studio/stamp-sheet-solver.ts';
import type { StampGateLayer, StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import {
  STAMP_GATE_HERON_MOVE, STAMP_GATE_HERON_TURNED, STAMP_GATE_PAPER_HERON, stampGateCoveredWithin, stampGateCoverageMass, stampGateHighPass, stampGatePaperHeronMoved, stampGatePaperHeronPoses,
  stampGatePeakShift, stampGatePosedPoint,
} from '../models/stamp-gate-paper-heron.ts';
import {
  checkStampGateTimes, STAMP_GATE_FAR_SHALLOWS, STAMP_GATE_FOOT_BOX, STAMP_GATE_FORWARD, STAMP_GATE_HERON_AWAY, STAMP_GATE_HERON_POSE, STAMP_GATE_NEVER_WETTED, STAMP_GATE_NEVER_WETTED_MESSAGE, STAMP_GATE_REBASE, STAMP_GATE_SHEET_IDS,
  STAMP_GATE_SHEET_IMAGES, STAMP_GATE_WET_CONTACT, stampGateFilmCentre, stampGateFilmDifference, stampGateFilmsEqual, stampGateForwardTimes, stampGateHeronPosed, stampGateRebaseTimes, stampGateSheetBrushOf,
  stampGateSheetProgram, stampGateSolvedStill, stampGateWetContactTimes, type StampGateFilm,
  type StampGateSheetId, type StampGateSolvedId,
} from '../models/stamp-gate-sheets.ts';
import { imageUrl, withGateSurface } from './stamp-gate-page-surface.ts';
import { checkStampGateReductions } from './stamp-gate-reductions-page.ts';

const urls = new Map<string, string>();
/** A sheet case's image by file, drawn as a data URL once. */
const sheetImageUrl = ({ file }: { file: string }) => {
  if (!urls.has(file)) urls.set(file, imageUrl(STAMP_GATE_SHEET_IMAGES[file]));
  return urls.get(file)!;
};

/** `use` with a device owner of its own, the sheet cases' images served; disposed after. */
async function withSheetOwner<T>(use: (owner: StampPaintGpuOwner) => Promise<T>): Promise<T> {
  const owner = await createStampPaintGpuOwner(sheetImageUrl);
  try {
    return await use(owner);
  } finally {
    owner.dispose();
  }
}

/** A solve's films read back, each with the box it covers. */
const filmsOf = (owner: StampPaintGpuOwner, solved: StampSheetSolved) => Promise.all(solved.films.map(async (film): Promise<StampGateFilm> => ({
  box: film.box, layer: await readStampSheetFilm(owner, film) satisfies StampGateLayer | null,
})));

/** `program` solved as `options` say on `owner`, its films read back. */
async function solvedFilms(owner: StampPaintGpuOwner, program: StampSheetProgram, options: StampSheetSolveOptions = {}) {
  const solved = await solveStampSheet(owner, program, options);
  return { solved, films: await filmsOf(owner, solved) };
}

/** The message `solve` rejects with, or null when it resolves. */
const rejection = (solve: Promise<StampSheetSolved>) => solve.then(() => null, (error: Error) => error.message);

/**
 * schedule/forward: each decision on its closed form; the meadow's treeline reaching `wet`; damp over never-wetted
 * paper refused to the letter; and every prefix's films the same, texel for texel, with an application appended after.
 */
async function checkForward(): Promise<StampGateWashCheck[]> {
  const id = 'schedule/forward', program = stampGateSheetProgram(STAMP_GATE_FORWARD), appended = stampGateSheetProgram(STAMP_GATE_FORWARD, { appended: true });
  const names = program.entries.map(({ name }) => name);
  return withSheetOwner(async (owner) => {
    const { decisions } = await solveStampSheet(owner, program);
    const meadow = stampGateSheetProgram(meadowSource);
    const treeline = await solveStampSheet(owner, meadow, { through: 2, finish: false });
    const refused = await rejection(solveStampSheet(owner, stampGateSheetProgram(STAMP_GATE_NEVER_WETTED)));
    // The appended program's prefixes solve on a device of their own: on one device a prefix's key would find the
    // other's films kept, and nothing would be painted twice to compare.
    const prefixes = await withSheetOwner((other) => names.reduce<Promise<{ through: number; same: boolean }[]>>(async (done, _name, k) => {
      const list = await done, through = k + 1, options = { through, finish: false };
      const [shorter, longer] = [await solvedFilms(owner, program, options), await solvedFilms(other, appended, options)];
      list.push({ through, same: shorter.films.every((film, f) => stampGateFilmsEqual(film, longer.films[f])) });
      return list;
    }, Promise.resolve([])));
    const [flood, wet] = treeline.decisions;
    return [
      checkStampGateTimes(`${id}: closed forms`, decisions, stampGateForwardTimes(), names),
      { id: `${id}: treeline wet`, passed: wet.tau === flood.tau && !wet.warnings.length, detail: `${meadow.entries[1].name} at ${wet.tau} s, its flood at ${flood.tau} s${wet.warnings.length ? `; ${wet.warnings.join('; ')}` : ''}` },
      { id: `${id}: never wetted`, passed: refused === STAMP_GATE_NEVER_WETTED_MESSAGE, detail: refused ?? 'solved' },
      {
        id: `${id}: appending`, passed: prefixes.every(({ same }) => same),
        detail: prefixes.map(({ through, same }) => `through ${through}: ${same ? 'same' : 'changed'}`).join(', '),
      },
    ];
  });
}

/** The program of the sheet `owner` owns in the wet-contact document with its layers apart, the heron there or not. */
function apartSheet(heron: boolean, owner: string): StampSheetProgram {
  const compiled = compilePaintingSelection(painting(STAMP_GATE_WET_CONTACT, { heron, apart: true }), stampGateSheetBrushOf);
  return compiled.sheets.find(({ sheet }) => sheet.owner === owner)!.program;
}

/**
 * sheet/wet-contact: the foot's charge reaches the wet shallows' film under it and nowhere far from it (against the
 * foot lifted clear); the glaze waits until all under it has set; a second pose moves the foot's paint, the flood's
 * decision reused; on own sheets the shallows are as they are alone (solved on another device, so not a kept solve).
 */
async function checkWetContact(): Promise<StampGateWashCheck[]> {
  const id = 'sheet/wet-contact', program = stampGateSheetProgram(STAMP_GATE_WET_CONTACT), names = program.entries.map(({ name }) => name);
  const charged = { through: 2, finish: false }, costs = createStampPaintCostTally();
  return withSheetOwner(async (owner) => {
    const rest = await solvedFilms(owner, program);
    const posed = await solvedFilms(owner, stampGateHeronPosed(STAMP_GATE_HERON_POSE), { costs });
    const reused = costs.take().counts.get('decisions reused') ?? 0;
    const touching = await solvedFilms(owner, program, charged), away = await solvedFilms(owner, stampGateHeronPosed(STAMP_GATE_HERON_AWAY), charged);
    const under = stampGateFilmDifference(touching.films[0], away.films[0], STAMP_GATE_FOOT_BOX), far = stampGateFilmDifference(touching.films[0], away.films[0], STAMP_GATE_FAR_SHALLOWS);
    const [from, to] = [stampGateFilmCentre(rest.films[1], 0), stampGateFilmCentre(posed.films[1], 0)];
    const moved = from && to && { x: to.x - from.x, y: to.y - from.y };
    const shifted = !!moved && Math.hypot(moved.x - STAMP_GATE_HERON_POSE.kx, moved.y - STAMP_GATE_HERON_POSE.ky) <= 0.25;
    const beside = await solvedFilms(owner, apartSheet(true, 'shallows')), alone = await withSheetOwner((other) => solvedFilms(other, apartSheet(false, 'shallows')));
    const heronSheet = apartSheet(true, 'heron'), same = stampGateFilmsEqual(beside.films[0], alone.films[0]);
    return [
      { id: `${id}: mingles`, passed: under > 0.01 && far === 0, detail: `the shallows' film moved by up to ${under.toFixed(4)} under the foot, ${far} far from it` },
      checkStampGateTimes(`${id}: glaze set`, rest.solved.decisions, stampGateWetContactTimes(), names),
      checkStampGateTimes(`${id}: posed`, posed.solved.decisions, stampGateWetContactTimes(), names),
      {
        id: `${id}: pose`, passed: shifted && reused === 1,
        detail: `the foot's paint moved ${moved ? `${moved.x.toFixed(3)}, ${moved.y.toFixed(3)}` : 'nowhere'} px, posed ${STAMP_GATE_HERON_POSE.kx}, ${STAMP_GATE_HERON_POSE.ky}; ${reused} decision reused`,
      },
      {
        id: `${id}: apart`, passed: same && heronSheet.films.length === 1,
        detail: `on own sheets the shallows' film is ${same ? 'the same, texel for texel,' : 'changed'} with the heron as without it; the heron's sheet paints ${heronSheet.films.map(({ name }) => name).join(', ')}`,
      },
    ];
  });
}

const shiftText = ({ x, y, r }: { x: number; y: number; r: number }) => `${x}, ${y} (r ${r.toFixed(3)})`;

/** Where `layer` of the paper heron lies in its compiled selection: its sheet's index and its film's there. */
function paperHeronFilm(evaluation: PaintingEvaluation, compiled: PaintingSelectionCompiled, layer: string) {
  const at = evaluation.tree.layers.findIndex(({ node }) => node.key === layer), sheet = compiled.sheets.findIndex(({ layers }) => layers.includes(at));
  return { sheet, film: compiled.sheets[sheet].layers.indexOf(at) };
}

/**
 * paper/heron (ENGINE test 6, its sheets): the heron moved, the paper's grain inside the body's paint stays where it
 * was and inside the wing's it goes with the wing; turned and grown, the body's paint lands where the pose puts it, its
 * area grown by the pose's scale squared; a coverage read twice is read back once.
 */
async function checkPaperHeron(): Promise<StampGateWashCheck[]> {
  const id = 'paper/heron', evaluation = painting(STAMP_GATE_PAPER_HERON), compiled = compilePaintingSelection(evaluation, stampGateSheetBrushOf);
  const { widthPx: width, heightPx: height } = evaluation.document, whole = { x: 0, y: 0, w: width, h: height };
  const body = paperHeronFilm(evaluation, compiled, 'body');
  return withSheetOwner(async (owner) => {
    const costs = createStampPaintCostTally(), reader = { owner, brushOf: stampGateSheetBrushOf, costs }, selection = { painting: evaluation };
    const rest = await solvePaintingSheets(owner, evaluation, compiled);
    const moved = await solvePaintingSheets(owner, evaluation, compiled, { poses: stampGatePaperHeronMoved() });
    const turned = await solvePaintingSheets(owner, evaluation, compiled, { poses: stampGatePaperHeronPoses(STAMP_GATE_HERON_TURNED) });
    const coverage = async (values: Promise<Float32Array>) => ({ width, height, values: await values });
    const filmCoverage = (solved: PaintingSheetsSolved, { sheet, film }: { sheet: number; film: number }) => coverage(readStampFilmCoverage(owner, solved.composite.sheets[sheet], film));
    const [restBody, movedBody, turnedBody] = await Promise.all([rest, moved, turned].map((solved) => filmCoverage(solved, body)));
    costs.take();
    const restVane = await coverage(stampFilmCoverage(reader, selection, 'vane'));
    await stampFilmCoverage(reader, selection, 'vane');
    const read = costs.take().counts;
    const [before, after] = await Promise.all([rest, moved].map(({ composite }) => readStampSheetsPicture(owner, composite, whole, true)));
    const [a, b] = [before, after].map(({ rgba }) => stampGateHighPass(rgba, width, height));
    const bodyWindow = stampGateCoveredWithin({ width, height, values: restBody.values.map((v, i) => Math.min(v, movedBody.values[i])) }, 0.95, 3);
    const bodyShift = stampGatePeakShift(a, b, bodyWindow), wingShift = stampGatePeakShift(a, b, stampGateCoveredWithin(restVane, 0.95, 3));
    const [from, to] = [stampGateCoverageMass(restBody), stampGateCoverageMass(turnedBody)];
    const wanted = from.centre && stampGatePosedPoint(STAMP_GATE_HERON_TURNED, from.centre), grown = to.total / from.total;
    const off = wanted && to.centre ? Math.hypot(to.centre.x - wanted.x, to.centre.y - wanted.y) : Infinity, scale = Math.hypot(STAMP_GATE_HERON_TURNED.ma, STAMP_GATE_HERON_TURNED.mb);
    return [
      {
        id: `${id}: grain`, passed: bodyShift.x === 0 && bodyShift.y === 0 && wingShift.x === STAMP_GATE_HERON_MOVE.x && wingShift.y === STAMP_GATE_HERON_MOVE.y,
        detail: `moved ${STAMP_GATE_HERON_MOVE.x}, ${STAMP_GATE_HERON_MOVE.y}: the paper inside the body's paint matches best at ${shiftText(bodyShift)} (0, 0 wanted), inside the wing's at ${shiftText(wingShift)}`,
      },
      {
        id: `${id}: turned`, passed: off <= 0.5 && Math.abs(grown / scale ** 2 - 1) <= 0.05,
        detail: `the body's paint centred ${off.toFixed(3)} px from where the pose puts it (past 0.5 fails); its area grown ×${grown.toFixed(3)}, the pose's scale squared ×${(scale ** 2).toFixed(3)} (past 5% off fails)`,
      },
      {
        id: `${id}: readbacks kept`, passed: read.get('readbacks') === 1 && read.get('picture hits') === 1,
        detail: `the vane's coverage read twice: ${read.get('readbacks') ?? 0} readback, ${read.get('picture hits') ?? 0} kept`,
      },
    ];
  });
}

/** schedule/reductions' solve past 2¹³ s: every decision the f64 reference's, the last after the time base moved. */
async function checkRebase(): Promise<StampGateWashCheck> {
  const program = stampGateSheetProgram(STAMP_GATE_REBASE), times = stampGateRebaseTimes();
  const { decisions } = await withSheetOwner((owner) => solveStampSheet(owner, program));
  const check = checkStampGateTimes('schedule/reductions: rebased', decisions, times, program.entries.map(({ name }) => name));
  return { ...check, passed: check.passed && times.at(-1)! > STAMP_SHEET_REBASE };
}

/** Sheet case `id`'s checks. */
export async function checkStampGateSheetCase(id: StampGateSheetId): Promise<StampGateWashCheck[]> {
  if (id === 'schedule/forward') return checkForward();
  if (id === 'sheet/wet-contact') return checkWetContact();
  if (id === 'schedule/reductions') return [...await checkStampGateReductions(), await checkRebase()];
  if (id === 'paper/heron') return checkPaperHeron();
  throw new Error(`stamp gate: no sheet case ${JSON.stringify(id)}; the gate has ${STAMP_GATE_SHEET_IDS.join(', ')}`);
}

/** Solved baseline `id`'s document, its still drawn, its sheets posed as it holds them: RGB bytes row by row, in base64. */
export function paintStampGateSolved(id: StampGateSolvedId): Promise<string> {
  const { evaluation, compiled, poses } = stampGateSolvedStill(id), { widthPx: width, heightPx: height } = evaluation.document;
  return withGateSurface({ width, height }, sheetImageUrl, async (surface, frame) => {
    const { composite } = await solvePaintingSheets(surface.owner, evaluation, compiled, { poses });
    await drawStampSheetsStill(surface, composite);
    await surface.owner.device.queue.onSubmittedWorkDone();
    const rgba = frame(), rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
    let binary = '';
    for (let i = 0; i < rgb.length; i += 0x8000) binary += String.fromCharCode(...rgb.subarray(i, i + 0x8000));
    return btoa(binary);
  });
}

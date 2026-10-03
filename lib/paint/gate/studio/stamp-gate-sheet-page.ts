// stamp-gate-sheet-page.ts: the gate page's sheet solves (stamp-gate-sheets.ts): documents compiled with the gate's
// brushes and solved on devices of their own, their decisions and kept films read back; their stills for the solved
// baselines; and the reductions run alone over textures written here.

import * as meadowSource from '#lib/paint/document/models/meadow.painting.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import type { StampSheetProgram } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { STAMP_SHEET_REBASE } from '#lib/paint/painting/models/stamp-sheet-schedule.ts';
import { createStampPaintGpuOwner, type StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { drawStampSheetStill, readStampSheetFilm } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import { solveStampSheet, type StampSheetSolved, type StampSheetSolveOptions } from '#lib/paint/painting/studio/stamp-sheet-solver.ts';
import type { StampGateLayer, StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import {
  checkStampGateTimes, STAMP_GATE_FAR_SHALLOWS, STAMP_GATE_FOOT_BOX, STAMP_GATE_FORWARD, STAMP_GATE_HERON_AWAY, STAMP_GATE_HERON_POSE, STAMP_GATE_NEVER_WETTED, STAMP_GATE_NEVER_WETTED_MESSAGE, STAMP_GATE_REBASE, STAMP_GATE_SHEET_IDS,
  STAMP_GATE_SHEET_IMAGES, STAMP_GATE_WET_CONTACT, stampGateFilmCentre, stampGateFilmDifference, stampGateFilmsEqual, stampGateForwardTimes, stampGateRebaseTimes, stampGateSheetProgram,
  stampGateSolvedProgram, stampGateWetContactTimes, type StampGateFilm,
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
    const prefixes = await names.reduce<Promise<{ through: number; same: boolean }[]>>(async (done, _name, k) => {
      const list = await done, through = k + 1, options = { through, finish: false };
      const [shorter, longer] = [await solvedFilms(owner, program, options), await solvedFilms(owner, appended, options)];
      list.push({ through, same: shorter.films.every((film, f) => stampGateFilmsEqual(film, longer.films[f])) });
      return list;
    }, Promise.resolve([]));
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

/**
 * sheet/wet-contact: the foot's charge reaches the wet shallows' film under it and nowhere far from it (against the
 * foot lifted clear of them); the glaze waits until all under it has set; a second pose moves the foot's paint by the
 * pose, the flood's decision remembered.
 */
async function checkWetContact(): Promise<StampGateWashCheck[]> {
  const id = 'sheet/wet-contact', program = stampGateSheetProgram(STAMP_GATE_WET_CONTACT), names = program.entries.map(({ name }) => name);
  const heron = painting(STAMP_GATE_WET_CONTACT).tree.groups.findIndex(({ node }) => node.key === 'heron');
  const charged = { through: 2, finish: false };
  return withSheetOwner(async (owner) => {
    const rest = await solvedFilms(owner, program);
    const posed = await solvedFilms(owner, program, { poses: new Map([[heron, STAMP_GATE_HERON_POSE]]) });
    const touching = await solvedFilms(owner, program, charged), away = await solvedFilms(owner, program, { ...charged, poses: new Map([[heron, STAMP_GATE_HERON_AWAY]]) });
    const under = stampGateFilmDifference(touching.films[0], away.films[0], STAMP_GATE_FOOT_BOX), far = stampGateFilmDifference(touching.films[0], away.films[0], STAMP_GATE_FAR_SHALLOWS);
    const [from, to] = [stampGateFilmCentre(rest.films[1], 0), stampGateFilmCentre(posed.films[1], 0)];
    const moved = from && to && { x: to.x - from.x, y: to.y - from.y };
    const shifted = !!moved && Math.hypot(moved.x - STAMP_GATE_HERON_POSE.x, moved.y - STAMP_GATE_HERON_POSE.y) <= 0.25;
    return [
      { id: `${id}: mingles`, passed: under > 0.01 && far === 0, detail: `the shallows' film moved by up to ${under.toFixed(4)} under the foot, ${far} far from it` },
      checkStampGateTimes(`${id}: glaze set`, rest.solved.decisions, stampGateWetContactTimes(), names),
      checkStampGateTimes(`${id}: posed`, posed.solved.decisions, stampGateWetContactTimes(), names),
      {
        id: `${id}: pose`, passed: shifted && posed.solved.stats.remembered === 1,
        detail: `the foot's paint moved ${moved ? `${moved.x.toFixed(3)}, ${moved.y.toFixed(3)}` : 'nowhere'} px, posed ${STAMP_GATE_HERON_POSE.x}, ${STAMP_GATE_HERON_POSE.y}; ${posed.solved.stats.remembered} decision remembered`,
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
  throw new Error(`stamp gate: no sheet case ${JSON.stringify(id)}; the gate has ${STAMP_GATE_SHEET_IDS.join(', ')}`);
}

/** Solved baseline `id`'s document, its still drawn: RGB bytes row by row, in base64. */
export function paintStampGateSolved(id: StampGateSolvedId): Promise<string> {
  const program = stampGateSolvedProgram(id);
  return withGateSurface(program, sheetImageUrl, async (surface, frame) => {
    const solved = await solveStampSheet(surface.owner, program);
    await drawStampSheetStill(surface, program, solved.films);
    await surface.owner.device.queue.onSubmittedWorkDone();
    const rgba = frame(), rgb = new Uint8Array(program.width * program.height * 3);
    for (let i = 0; i < program.width * program.height; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
    let binary = '';
    for (let i = 0; i < rgb.length; i += 0x8000) binary += String.fromCharCode(...rgb.subarray(i, i + 0x8000));
    return btoa(binary);
  });
}

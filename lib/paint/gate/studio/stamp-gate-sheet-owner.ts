// stamp-gate-sheet-owner.ts: how the gate page solves a sheet case: on a device owner of its own with the sheet
// cases' images, its films read back, a refusal read as its message.

import type { StampSheetProgram } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { createStampPaintGpuOwner, type StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { readStampSheetFilm } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import { solveStampSheet, type StampSheetSolved, type StampSheetSolveOptions } from '#lib/paint/painting/studio/stamp-sheet-solver.ts';
import type { StampGateLayer } from '../models/stamp-gate-layer.ts';
import { STAMP_GATE_SHEET_IMAGES, type StampGateFilm } from '../models/stamp-gate-sheets.ts';
import { imageUrl } from './stamp-gate-page-surface.ts';

const urls = new Map<string, string>();
/** A sheet case's image by file, drawn as a data URL once. */
export const stampGateSheetImageUrl = ({ file }: { file: string }) => {
  if (!urls.has(file)) urls.set(file, imageUrl(STAMP_GATE_SHEET_IMAGES[file]));
  return urls.get(file)!;
};

/** `use` with a device owner of its own, the sheet cases' images served; disposed after. */
export async function withStampGateSheetOwner<T>(use: (owner: StampPaintGpuOwner) => Promise<T>): Promise<T> {
  const owner = await createStampPaintGpuOwner(stampGateSheetImageUrl);
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
export async function stampGateSolvedFilms(owner: StampPaintGpuOwner, program: StampSheetProgram, options: StampSheetSolveOptions = {}) {
  const solved = await solveStampSheet(owner, program, options);
  return { solved, films: await filmsOf(owner, solved) };
}

/** The message `solve` rejects with, or null when it resolves. */
export const stampGateRejection = (solve: Promise<StampSheetSolved>) => solve.then(() => null, (error: Error) => error.message);

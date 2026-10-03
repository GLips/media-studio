// painting-film-readback.ts: a selected layer's film, at rest through the selection's prefix, read back as the rig and
// tools read it (ENGINE 5.1): `paintingFilmCoverage` and `paintingFilmPicture`. The selection compiles to the programs
// its sheets run; the layer's sheet is solved (a prefix already solved, its films kept, paints nothing) and its films
// held while its film is read back through painting's readbacks (stamp-film-readback.ts), kept per device by what
// makes its pixels.

import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { readStampFilmCoverage, readStampFilmPicture, type StampFilmBacking } from '#lib/paint/painting/studio/stamp-film-readback.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import type { StampSheetKeptFilms, StampSheetsPicture } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import { holdStampSheetFilms } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import { solveStampSheet } from '#lib/paint/painting/studio/stamp-sheet-solver.ts';
import { compilePaintingSelection } from '../models/painting-document-compile.ts';
import type { PaintingBrushOf } from '../models/painting-deposit-compile.ts';
import type { LayerKey } from '../models/painting-document.ts';
import type { LayerSelection } from '../models/painting-selection.ts';

/**
 * Where a selection's films are solved and read: the device, the brushes the document names (one held for the
 * evaluation's life: PaintingBrushOf), and where costs count.
 */
export type PaintingFilmReader = { readonly owner: StampPaintGpuOwner; readonly brushOf: PaintingBrushOf; readonly costs?: StampPaintCostTally };

/**
 * `read` of `layer`'s film in `selection`, its sheet solved at rest through the selection's `at` (finished, all of it
 * when left out) and its films held until the read resolves. Throws on a layer the selection doesn't hold.
 */
async function readPaintingFilm<T>(
  { owner, brushOf, costs }: PaintingFilmReader, { painting, layers, at }: LayerSelection, layer: LayerKey, read: (sheet: StampSheetKeptFilms, film: number) => Promise<T>,
): Promise<T> {
  const place = painting.tree.byKey.get(layer);
  if (!place || place.kind !== 'layer') throw new Error(`painting: ${painting.source} has no layer ${layer}`);
  const ordinal = painting.tree.layers.indexOf(place), compiled = compilePaintingSelection(painting, brushOf, { layers }).sheets.find((each) => each.layers.includes(ordinal));
  if (!compiled) throw new Error(`painting: ${layer} isn't among the layers selected from ${painting.source}`);
  const { films } = await solveStampSheet(owner, compiled.program, { costs, ...(at !== undefined && { at }) });
  const release = holdStampSheetFilms(owner, films);
  try {
    return await read({ program: compiled.program, films }, compiled.layers.indexOf(ordinal));
  } finally {
    release();
  }
}

/** `layer`'s finished coverage in `selection`, document-sized, row by row: what a rig's skin is built over. */
export function paintingFilmCoverage(reader: PaintingFilmReader, selection: LayerSelection, layer: LayerKey): Promise<Float32Array> {
  return readPaintingFilm(reader, selection, layer, (sheet, film) => readStampFilmCoverage(reader.owner, sheet, film, reader.costs));
}

/**
 * `layer`'s finished film in `selection` as a premultiplied linear picture (a PaintRigPicture's shape) on `backing`:
 * clear, over its paint; or on its sheet's paper and edge.
 */
export function paintingFilmPicture(reader: PaintingFilmReader, selection: LayerSelection, layer: LayerKey, backing: StampFilmBacking): Promise<StampSheetsPicture> {
  return readPaintingFilm(reader, selection, layer, (sheet, film) => readStampFilmPicture(reader.owner, sheet, film, backing, reader.costs));
}

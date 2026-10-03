// painting-film-readback.ts: a selected layer's film, finished at rest, read back as the rig and tools read it (ENGINE
// 5.1): `stampFilmCoverage` and `stampFilmPicture`. The selection compiles to the programs its sheets run; the layer's
// sheet is solved (a kept solve is reused) and its film read back through painting's readbacks, kept per device by
// what makes its pixels.
//
// Negative space: no prefix. Every wash is unclocked so far, so a selection shows every application.

import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { readStampFilmCoverage, readStampFilmPicture, type StampFilmBacking } from '#lib/paint/painting/studio/stamp-film-readback.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import type { StampSheetLaid, StampSheetsPicture } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import { solveStampSheet } from '#lib/paint/painting/studio/stamp-sheet-solver.ts';
import { compilePaintingSelection } from '../models/painting-document-compile.ts';
import type { PaintingBrushOf } from '../models/painting-deposit-compile.ts';
import type { LayerKey, NodeKey } from '../models/painting-document.ts';
import type { PaintingEvaluation } from '../models/painting-source.ts';
import type { PaintingSheet } from '../models/painting-tree.ts';

/** What determines a film's program: the evaluation, and the layers and groups selected with it (all when left out). */
export type PaintingSelection = { readonly painting: PaintingEvaluation; readonly layers?: readonly NodeKey[] };

/** Where a selection's films are solved and read: the device, the brushes the document names, and where costs count. */
export type PaintingFilmReader = { readonly owner: StampPaintGpuOwner; readonly brushOf: PaintingBrushOf; readonly costs?: StampPaintCostTally };

/** `layer`'s sheet in `selection`, solved finished at rest, and its film's index there. Throws on a layer it doesn't select. */
async function paintingFilmSolved({ owner, brushOf, costs }: PaintingFilmReader, { painting, layers }: PaintingSelection, layer: LayerKey): Promise<{ sheet: PaintingSheet; laid: StampSheetLaid; film: number }> {
  const place = painting.tree.byKey.get(layer);
  if (!place || place.kind !== 'layer') throw new Error(`painting: ${painting.source} has no layer ${layer}`);
  const at = painting.tree.layers.indexOf(place), compiled = compilePaintingSelection(painting, brushOf, layers).sheets.find((each) => each.layers.includes(at));
  if (!compiled) throw new Error(`painting: ${layer} isn't among the layers selected from ${painting.source}`);
  const solved = await solveStampSheet(owner, compiled.program, { costs });
  return { sheet: compiled.sheet, laid: { program: compiled.program, films: solved.films, place: null }, film: compiled.layers.indexOf(at) };
}

/** `layer`'s finished coverage in `selection`, document-sized, row by row: what a rig's skin is built over. */
export async function stampFilmCoverage(reader: PaintingFilmReader, selection: PaintingSelection, layer: LayerKey): Promise<Float32Array> {
  const { laid, film } = await paintingFilmSolved(reader, selection, layer);
  return readStampFilmCoverage(reader.owner, laid, film, reader.costs);
}

/**
 * `layer`'s finished film in `selection` as a premultiplied linear picture (a PaintRigPicture's shape) on `backing`:
 * clear, over its paint; or on its sheet's paper and edge.
 */
export async function stampFilmPicture(reader: PaintingFilmReader, selection: PaintingSelection, layer: LayerKey, backing: StampFilmBacking): Promise<StampSheetsPicture> {
  const { sheet, laid, film } = await paintingFilmSolved(reader, selection, layer);
  return readStampFilmPicture(reader.owner, laid, film, { backing, edge: sheet.edge }, reader.costs);
}

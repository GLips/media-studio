// painting-still-page.ts: a painting source's still, the browser side of engine/painting-still.ts (through
// withBrowserModulePage). The source, bundled in as `@painting-source`, is evaluated at the values handed in, every
// sheet compiled with the brushes Node resolved from the styles, each solved on the GPU, and laid as one painting on
// the root's paper, each own sheet's card under its films; then, when asked, each film's picture on its sheet's paper
// and edge (stampFilmPicture). Images are served at /files/ (stamp-paint-pack-urls.ts).

import * as paintingSource from '@painting-source';
import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampPaintPackAssetUrl } from '#lib/paint/brush-packs/models/stamp-paint-pack-urls.ts';
import { linearToSrgb } from '#lib/paint/materials/models/paint-spectrum.ts';
import { createStampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { StampSheetRefusal } from '#lib/paint/painting/models/stamp-sheet-refusal.ts';
import { createStampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { drawStampSheetsStill, type StampSheetsPicture } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import { compilePaintingSelection } from '../models/painting-document-compile.ts';
import type { BrushRef } from '../models/painting-document.ts';
import { paintingValuesFromText } from '../models/painting-properties.ts';
import { paintingSolveCostsLine, paintingSolveLines } from '../models/painting-solve-report.ts';
import type { PaintingStill, PaintingStillOutcome, PaintingStillRequest } from '../models/painting-still-request.ts';
import { painting } from '../models/painting-source.ts';
import { paintingSheetName } from '../models/painting-tree.ts';
import { stampFilmPicture } from './painting-film-readback.ts';
import { solvePaintingSheets } from './painting-sheets-solve.ts';

/** `picture` (premultiplied linear light) as an sRGB PNG data URL `width` × `height`, clear where it doesn't reach. */
function paintingPicturePng(picture: StampSheetsPicture, width: number, height: number): string {
  const canvas = Object.assign(document.createElement('canvas'), { width, height }), context = canvas.getContext('2d')!;
  if (picture.w > 0) {
    const image = context.createImageData(picture.w, picture.h);
    for (let i = 0; i < picture.w * picture.h; i++) {
      const alpha = picture.rgba[i * 4 + 3];
      for (let c = 0; c < 3; c++) image.data[i * 4 + c] = alpha > 0 ? Math.round(255 * linearToSrgb(Math.min(1, picture.rgba[i * 4 + c] / alpha))) : 0;
      image.data[i * 4 + 3] = Math.round(255 * alpha);
    }
    context.putImageData(image, picture.x0, picture.y0);
  }
  return canvas.toDataURL('image/png');
}

/** The source's still, as `request` asks for it. Throws what a solve refuses: an application it can't land. */
async function paintingStillOf({ texts, brushes, packUrls, films }: PaintingStillRequest): Promise<PaintingStill> {
  const evaluation = painting(paintingSource, paintingValuesFromText(paintingSource.properties ?? {}, texts));
  const brushOf = ({ style, brush }: BrushRef): StampBrush => {
    const key = `${style}/${brush}`;
    if (!Object.hasOwn(brushes, key)) throw new Error(`painting still: ${key} wasn't resolved for the page`);
    return brushes[key];
  };
  const compiled = compilePaintingSelection(evaluation, brushOf);
  const { width, height } = compiled.sheets[0].program;
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const copy = Object.assign(document.createElement('canvas'), { width, height });
  const owner = await createStampPaintGpuOwner((asset) => stampPaintPackAssetUrl(packUrls, asset));
  try {
    const surface = await createStampPaintSurface(owner, { canvas, width, height });
    try {
      const costs = createStampPaintCostTally(), { solved, composite } = await solvePaintingSheets(owner, evaluation, compiled, { costs });
      await drawStampSheetsStill(surface, composite);
      copy.getContext('2d')!.drawImage(canvas, 0, 0);
      const png = copy.toDataURL('image/png');
      const reader = { owner, brushOf, costs }, layers = films ? evaluation.tree.layers.map(({ node }) => node.key) : [];
      const filmPngs = await Promise.all(layers.map(async (layer) => ({ name: layer, png: paintingPicturePng(await stampFilmPicture(reader, { painting: evaluation }, layer, 'sheet'), width, height) })));
      const several = compiled.sheets.filter(({ program }) => program.entries.length > 0).length > 1;
      const lines = compiled.sheets.flatMap(({ sheet, program }, s) => {
        if (program.entries.length === 0) return [];
        const solveLines = paintingSolveLines(program, solved[s].decisions);
        return several ? [`${paintingSheetName(sheet)}:`].concat(solveLines.map((line) => `  ${line}`)) : solveLines;
      });
      return { png, films: filmPngs, lines, costs: paintingSolveCostsLine(costs.take()) };
    } finally {
      surface.dispose();
    }
  } finally {
    owner.dispose();
  }
}

/** The source's still, or the solve's refusal; anything else it throws is an engine fault, thrown on. */
async function drawPaintingStill(request: PaintingStillRequest): Promise<PaintingStillOutcome> {
  try {
    return { still: await paintingStillOf(request) };
  } catch (error) {
    if (error instanceof StampSheetRefusal) return { refused: error.message };
    throw error;
  }
}

Object.assign(globalThis, { drawPaintingStill });

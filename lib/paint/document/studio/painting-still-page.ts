// painting-still-page.ts: a painting source's still, the browser side of engine/painting-still.ts (through
// withBrowserModulePage). The source, bundled in as `@painting-source`, is evaluated at the values handed in, every
// sheet compiled with the brushes Node resolved from the styles, each solved on the GPU, and laid as one painting on
// the root's paper, each own sheet's card under its films; then each film alone over the paper, when asked. Images
// are served at /files/ (stamp-paint-pack-urls.ts).

import * as paintingSource from '@painting-source';
import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampPaintPackAssetUrl } from '#lib/paint/brush-packs/models/stamp-paint-pack-urls.ts';
import { createStampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { StampSheetRefusal } from '#lib/paint/painting/models/stamp-sheet-refusal.ts';
import { createStampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { drawStampSheetsStill, type StampSheetsComposite } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import { compilePaintingSelection } from '../models/painting-document-compile.ts';
import { paintingValuesFromText } from '../models/painting-properties.ts';
import { paintingSolveCostsLine, paintingSolveLines } from '../models/painting-solve-report.ts';
import type { PaintingStill, PaintingStillOutcome, PaintingStillRequest } from '../models/painting-still-request.ts';
import { painting } from '../models/painting-source.ts';
import { paintingSheetName } from '../models/painting-tree.ts';
import { solvePaintingSheets } from './painting-sheets-solve.ts';

/** The source's still, as `request` asks for it. Throws what a solve refuses: an application it can't land. */
async function paintingStillOf({ texts, brushes, packUrls, films }: PaintingStillRequest): Promise<PaintingStill> {
  const evaluation = painting(paintingSource, paintingValuesFromText(paintingSource.properties ?? {}, texts));
  const compiled = compilePaintingSelection(evaluation, ({ style, brush }): StampBrush => {
    const key = `${style}/${brush}`;
    if (!Object.hasOwn(brushes, key)) throw new Error(`painting still: ${key} wasn't resolved for the page`);
    return brushes[key];
  });
  const { width, height } = compiled.sheets[0].program;
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const copy = Object.assign(document.createElement('canvas'), { width, height });
  const owner = await createStampPaintGpuOwner((asset) => stampPaintPackAssetUrl(packUrls, asset));
  try {
    const surface = await createStampPaintSurface(owner, { canvas, width, height });
    try {
      const costs = createStampPaintCostTally(), { solved, composite } = await solvePaintingSheets(owner, evaluation, compiled, { costs });
      /** `steps` of the composite laid on the surface, as a PNG: copied out before anything draws again. */
      const shown = async (steps: StampSheetsComposite['steps']) => {
        await drawStampSheetsStill(surface, { ...composite, steps });
        const context = copy.getContext('2d')!;
        context.clearRect(0, 0, width, height);
        context.drawImage(canvas, 0, 0);
        return copy.toDataURL('image/png');
      };
      const png = await shown(composite.steps);
      // Each film alone over the paper, on its own sheet's card when it has one; one at a time, each drawn on the
      // one surface and copied out before the next.
      const alone = films ? composite.steps.flatMap((step) => (step.kind === 'film' ? [step] : [])) : [];
      const filmPngs = await alone.reduce<Promise<{ name: string; png: string }[]>>(async (done, step) => {
        const pngs = await done, card = composite.steps.filter((other) => other.kind === 'card' && other.sheet === step.sheet);
        pngs.push({ name: compiled.sheets[step.sheet].program.films[step.film].name, png: await shown([...card, step]) });
        return pngs;
      }, Promise.resolve([]));
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

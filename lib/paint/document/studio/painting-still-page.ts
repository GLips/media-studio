// painting-still-page.ts: a painting source's still, the browser side of engine/painting-still.ts (through
// withBrowserModulePage). The source, bundled in as `@painting-source`, is evaluated at the values handed in, its
// root sheet compiled with the brushes Node resolved from the styles, solved on the GPU and laid on its paper; then
// each film alone over the paper, when asked. Images are served at /files/ (stamp-paint-pack-urls.ts).

import * as paintingSource from '@painting-source';
import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampPaintPackAssetUrl } from '#lib/paint/brush-packs/models/stamp-paint-pack-urls.ts';
import { StampSheetRefusal } from '#lib/paint/painting/models/stamp-sheet-schedule.ts';
import { createStampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { drawStampSheetStill, type StampSheetFilmKept } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import { solveStampSheet } from '#lib/paint/painting/studio/stamp-sheet-solver.ts';
import { compilePaintingRootSheet } from '../models/painting-document-compile.ts';
import { paintingValuesFromText } from '../models/painting-properties.ts';
import { paintingSolveLines, type PaintingStill, type PaintingStillOutcome, type PaintingStillRequest } from '../models/painting-solve-report.ts';
import { painting } from '../models/painting-source.ts';

/** The source's still, as `request` asks for it. Throws what the solve refuses: an application it can't land. */
async function paintingStillOf({ texts, brushes, packUrls, films }: PaintingStillRequest): Promise<PaintingStill> {
  const evaluation = painting(paintingSource, paintingValuesFromText(paintingSource.properties ?? {}, texts));
  const program = compilePaintingRootSheet(evaluation, ({ style, brush }): StampBrush => {
    const key = `${style}/${brush}`;
    if (!Object.hasOwn(brushes, key)) throw new Error(`painting still: ${key} wasn't resolved for the page`);
    return brushes[key];
  });
  const { width, height } = program;
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const copy = Object.assign(document.createElement('canvas'), { width, height });
  const owner = await createStampPaintGpuOwner((asset) => stampPaintPackAssetUrl(packUrls, asset));
  try {
    const surface = await createStampPaintSurface(owner, { canvas, width, height });
    try {
      const solved = await solveStampSheet(owner, program);
      /** `kept` laid on the surface, as a PNG: copied out before anything draws again. */
      const shown = async (kept: readonly StampSheetFilmKept[]) => {
        await drawStampSheetStill(surface, program, kept);
        const context = copy.getContext('2d')!;
        context.clearRect(0, 0, width, height);
        context.drawImage(canvas, 0, 0);
        return copy.toDataURL('image/png');
      };
      const png = await shown(solved.films);
      /** Film `f` alone: every other kept with no box, so it lays nothing. */
      const only = (f: number) => solved.films.map((kept, g): StampSheetFilmKept => (g === f ? kept : { ...kept, box: null }));
      // One at a time: each is drawn on the one surface and copied out before the next.
      const filmPngs = await (films ? program.films : []).reduce<Promise<{ name: string; png: string }[]>>(async (done, { name }, f) => {
        const pngs = await done;
        pngs.push({ name, png: await shown(only(f)) });
        return pngs;
      }, Promise.resolve([]));
      return { png, films: filmPngs, lines: paintingSolveLines(program, solved.decisions) };
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

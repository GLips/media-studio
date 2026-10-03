// narrow-fill-sheet-page.ts: the narrow-fill sheet's browser side, run by engine/narrow-fill-sheet.ts through
// withBrowserModulePage. It paints one brush's sheet (models/narrow-fills.ts) on the style's paper, with each column's
// diameter above it and each row's shape beside it, twice: as painted, and with each shape's outline over it in red.
// Images are served at /files/ (brush-fidelity-pack-urls.ts).

import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { createStampPaintRenderer } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { createStampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { stampPaintPackAssetUrl } from '#lib/paint/brush-packs/models/stamp-paint-pack-urls.ts';
import { NARROW_FILL_CELL, NARROW_FILL_COLUMNS, NARROW_FILL_SHAPES, narrowFillRecipe, type NarrowFillPainted, type NarrowFillSheetMedium } from '../models/narrow-fills.ts';

const TOP = 36, LEFT = 150;

/** `name`'s sheet in `medium`, as painted and outlined, or why it couldn't be painted. */
async function drawNarrowFillSheet(name: string, { brushes, paper, mixing, packUrls }: NarrowFillSheetMedium): Promise<NarrowFillPainted[]> {
  const { width: W, height: H } = NARROW_FILL_CELL;
  const width = W * NARROW_FILL_COLUMNS.length, height = H * NARROW_FILL_SHAPES.length;
  const paintCanvas = Object.assign(document.createElement('canvas'), { width, height });
  const copy = Object.assign(document.createElement('canvas'), { width, height });
  const sheet = (outlined: boolean) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: LEFT + width, height: TOP + height });
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(copy, LEFT, TOP);
    context.fillStyle = '#111111';
    context.font = 'bold 15px -apple-system, Helvetica, sans-serif';
    NARROW_FILL_COLUMNS.forEach((label, column) => context.fillText(label, LEFT + column * W + 10, 24, W - 16));
    context.font = '14px -apple-system, Helvetica, sans-serif';
    NARROW_FILL_SHAPES.forEach(({ title, outline }, row) => {
      title.split(', ').forEach((line, k) => context.fillText(line, 10, TOP + row * H + 24 + 18 * k, LEFT - 16));
      if (!outlined) return;
      context.strokeStyle = 'rgba(220, 30, 30, 0.75)';
      context.lineWidth = 1;
      NARROW_FILL_COLUMNS.forEach((_, column) => {
        context.beginPath();
        outline.forEach(({ x, y }, k) => context[k ? 'lineTo' : 'moveTo'](LEFT + column * W + x, TOP + row * H + y));
        context.closePath();
        context.stroke();
      });
    });
    return canvas.toDataURL('image/png');
  };
  try {
    const brush = brushes[name];
    const painting = compileStampPaintRecipe(narrowFillRecipe(brush, paper, mixing));
    const owner = await createStampPaintGpuOwner((asset) => stampPaintPackAssetUrl(packUrls, asset));
    try {
      const surface = await createStampPaintSurface(owner, { canvas: paintCanvas, width, height });
      // Copied before the surface is disposed, which unconfigures its canvas and clears it.
      try {
        const renderer = await createStampPaintRenderer(surface, painting);
        await renderer.draw({ kind: 'once', t: 0 });
        copy.getContext('2d')!.drawImage(paintCanvas, 0, 0);
      } finally {
        surface.dispose();
      }
    } finally {
      owner.dispose();
    }
    return [{ brush: name, png: sheet(false) }, { brush: `${name}-outlined`, png: sheet(true) }];
  } catch (error) {
    return [{ brush: name, refused: error instanceof Error ? error.message : String(error) }];
  }
}

Object.assign(globalThis, { drawNarrowFillSheet });

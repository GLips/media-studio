// stamp-stroke-hand-sheet-page.ts: the stroke hand sheet's browser side, run by
// lib/picture/brush-fidelity/engine/stamp-stroke-hand-sheet.ts through withBrowserModulePage. It paints one path, a wave
// that ends in a sharp turn, under each way of authoring its pressure (stamp-stroke-hand.ts), one row each with a
// constant-pressure stroke first to compare against, and plots each row's pressure beside it. Brush images are under the
// styles folder, served at /files/, at the URLs Node resolved (brush-fidelity-pack-urls.ts).

import type { StampBrush } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { compileStampPaintRecipe, stampPaintRecipe } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import type { StampStrokePoint } from '#lib/picture/stamp-paint/models/stamp-placement.ts';
import { handStampStroke, type StampStrokeHand } from '#lib/picture/stamp-paint/models/stamp-stroke-hand.ts';
import { createStampPaintRenderer } from '#lib/picture/stamp-paint/studio/stamp-paint-renderer.ts';
import { createStampPaintSurface } from '#lib/picture/stamp-paint/studio/stamp-paint-surface.ts';
import { brushFidelityAssetUrl, type BrushFidelityPackUrls } from '../models/brush-fidelity-pack-urls.ts';

const ROW = 200, LABEL = 250, PAINT = 900, PLOT = 220;

const VARIANTS: readonly { label: string; hand?: StampStrokeHand }[] = [
  { label: 'constant pressure' },
  { label: 'taper', hand: { profile: 'taper' } },
  { label: 'pressFlick', hand: { profile: 'pressFlick' } },
  { label: 'swell', hand: { profile: 'swell' } },
  { label: 'drag', hand: { profile: 'drag' } },
  { label: 'curvature 0.4 alone', hand: { curvature: 0.4 } },
  { label: 'taper + curvature 0.4', hand: { profile: 'taper', curvature: 0.4 } },
  { label: 'taper + curvature + wobble', hand: { profile: 'taper', curvature: 0.4, wobble: { pressure: 0.12, position: 0.15 } } },
];

/** A wave, then a hairpin back up and a sharp turn into a straight run: gentle bends, tight ones and a straight. */
function sheetPath(top: number): StampStrokePoint[] {
  const wave = Array.from({ length: 41 }, (_, i) => ({ x: 60 + i * 13, y: top + 90 - 45 * Math.sin((i / 40) * Math.PI * 1.5) }));
  return [...wave, { x: 560, y: top + 25 }, { x: 860, y: top + 55 }];
}

/** The sheet for `brush` at `diameter`, its images from `packUrls`: a row per variant, as a PNG data URL. */
async function drawStampStrokeHandSheet(brush: StampBrush, diameter: number, packUrls: BrushFidelityPackUrls): Promise<string> {
  const width = LABEL + PAINT + PLOT, height = ROW * VARIANTS.length;
  const material = { kind: 'color', color: '#1d2a44' } as const;
  const painting = compileStampPaintRecipe(stampPaintRecipe((paint) => VARIANTS.forEach(({ hand }, row) => paint.group(`row-${row}`, { composite: 'glaze', opacity: 1 }, (group) => group.pass('stroke', {}, (pass) => {
    pass.stroke('stroke', { brush, material, diameter, path: sheetPath(row * ROW), hand });
  })))));
  const paintCanvas = Object.assign(document.createElement('canvas'), { width: PAINT, height });
  const surface = await createStampPaintSurface({ canvas: paintCanvas, width: PAINT, height }, (asset) => brushFidelityAssetUrl(packUrls, asset));
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  // Copied before the surface is disposed, which unconfigures its canvas and clears it.
  try {
    const renderer = await createStampPaintRenderer(surface, painting, { color: '#ffffff' }, { kind: 'flat' });
    await renderer.draw(0);
    context.drawImage(paintCanvas, LABEL, 0);
  } finally {
    surface.dispose();
  }
  VARIANTS.forEach(({ label, hand }, row) => {
    const top = row * ROW;
    context.fillStyle = '#dddddd';
    context.fillRect(0, top, width, 1);
    context.fillStyle = '#111111';
    context.font = 'bold 20px -apple-system, Helvetica, sans-serif';
    context.fillText(label, 14, top + 34, LABEL - 20);
    context.font = '14px -apple-system, Helvetica, sans-serif';
    context.fillStyle = '#666666';
    context.fillText(`${brush.name}, d ${diameter}`, 14, top + 58, LABEL - 20);
    // The pressure along the stroke, 0 at the bottom of the plot and 1 at its top, as handStampStroke gives it.
    const points = hand ? handStampStroke(sheetPath(top), hand, diameter, `row-${row}/stroke/stroke|hand`) : sheetPath(top);
    const x0 = LABEL + PAINT + 10, w = PLOT - 24, y0 = top + ROW - 30, h = ROW - 60;
    context.strokeStyle = '#cccccc';
    context.strokeRect(x0, y0 - h, w, h);
    context.strokeStyle = '#c0392b';
    context.lineWidth = 2;
    context.beginPath();
    points.forEach((point, i) => context[i ? 'lineTo' : 'moveTo'](x0 + (i / Math.max(1, points.length - 1)) * w, y0 - (point.pressure ?? 1) * h));
    context.stroke();
    context.lineWidth = 1;
    context.fillStyle = '#999999';
    context.fillText('pressure', x0, y0 + 18);
  });
  return canvas.toDataURL('image/png');
}

Object.assign(globalThis, { drawStampStrokeHandSheet });

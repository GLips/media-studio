// stamp-fill-sheet-page.ts: the fill sheet's browser side, run by lib/picture/brush-fidelity/engine/stamp-fill-sheet.ts
// through withBrowserModulePage. It fills one region, a blob with a notch and a narrow neck, flooded and in each
// strokes pattern (StampFillApplication), a column each: laid whole in the top row, half drawn in the bottom one, each
// labelled with how many stamps it cost. Brush images are served at /files/ (brush-fidelity-pack-urls.ts).

import type { StampBrush } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { stampSmoothRegion, type StampFillApplication } from '#lib/picture/stamp-paint/models/stamp-fill.ts';
import { compileStampPaintRecipe, stampPassDeposits } from '#lib/picture/stamp-paint/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import { createStampPaintRenderer } from '#lib/picture/stamp-paint/studio/stamp-paint-renderer.ts';
import { createStampPaintSurface } from '#lib/picture/stamp-paint/studio/stamp-paint-surface.ts';
import { brushFidelityAssetUrl, type BrushFidelityPackUrls } from '../models/brush-fidelity-pack-urls.ts';

const CELL = { width: 330, height: 300 }, LABEL = 56, DRAWN_OVER = 2;

const APPLICATIONS: readonly { label: string; application: StampFillApplication }[] = [
  { label: 'flood', application: { kind: 'flood' } },
  { label: 'zigzag', application: { kind: 'strokes', pattern: { kind: 'zigzag' } } },
  { label: 'back and forth', application: { kind: 'strokes', pattern: { kind: 'backAndForth' } } },
  { label: 'hatch', application: { kind: 'strokes', pattern: { kind: 'hatch' } } },
  { label: 'cross-hatch', application: { kind: 'strokes', pattern: { kind: 'crossHatch' } } },
  { label: 'scribble', application: { kind: 'strokes', pattern: { kind: 'scribble' } } },
  { label: 'shading', application: { kind: 'strokes', pattern: { kind: 'shading' } } },
];

/** Each row's fills start drawing at `appliedAt`; the sheet is drawn at DRAWN_OVER, when the first row's are laid. */
const ROWS = [{ label: 'laid', appliedAt: 0 }, { label: 'half drawn', appliedAt: DRAWN_OVER / 2 }];

/** The region in the cell at (`left`, `top`): a blob with a notch in its top and a neck to a lobe on its right. */
const cellRegion = (left: number, top: number) => stampSmoothRegion([
  [40, 90], [95, 40], [140, 95], [180, 45], [235, 70], [250, 120], [300, 115], [305, 165], [250, 170], [230, 230], [120, 260], [45, 200],
].map(([x, y]) => ({ x: left + x - 10, y: top + y })));

/** The sheet for `brush` at `diameter`, its images from `packUrls`, as a PNG data URL. */
async function drawStampFillSheet(brush: StampBrush, diameter: number, packUrls: BrushFidelityPackUrls): Promise<string> {
  const width = CELL.width * APPLICATIONS.length, height = (LABEL + CELL.height) * ROWS.length;
  const material = { kind: 'color', color: '#1d2a44' } as const;
  const top = (row: number) => row * (LABEL + CELL.height) + LABEL;
  const painting = compileStampPaintRecipe(stampPaintRecipe((paint) => ROWS.forEach(({ appliedAt }, row) => APPLICATIONS.forEach(({ application }, column) => paint.group(`r${row}c${column}`, { composite: 'glaze', opacity: 1 }, (group) => group.pass('p', {}, (pass) => {
    pass.fill('fill', { brush, material, diameter, application, direction: 0.35, region: cellRegion(column * CELL.width, top(row)), appliedAt, drawnOver: DRAWN_OVER });
  }))))));
  const stamps = painting.groups.map(({ passes }) => stampPassDeposits(passes[0])[0].stamps.length);
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const context = canvas.getContext('2d')!;
  const paintCanvas = Object.assign(document.createElement('canvas'), { width, height });
  const surface = await createStampPaintSurface({ canvas: paintCanvas, width, height }, (asset) => brushFidelityAssetUrl(packUrls, asset));
  // Copied before the surface is disposed, which unconfigures its canvas and clears it.
  try {
    const renderer = await createStampPaintRenderer(surface, painting, { color: '#ffffff' }, { kind: 'flat' });
    await renderer.draw(DRAWN_OVER);
    context.drawImage(paintCanvas, 0, 0);
  } finally {
    surface.dispose();
  }
  ROWS.forEach(({ label }, row) => APPLICATIONS.forEach(({ label: applied }, column) => {
    const x = column * CELL.width, y = top(row) - LABEL;
    context.fillStyle = '#dddddd';
    context.fillRect(x, y, CELL.width, 1);
    context.fillRect(x, y, 1, LABEL + CELL.height);
    context.fillStyle = '#111111';
    context.font = 'bold 20px -apple-system, Helvetica, sans-serif';
    context.fillText(`${applied}, ${label}`, x + 12, y + 26, CELL.width - 20);
    context.font = '14px -apple-system, Helvetica, sans-serif';
    context.fillStyle = '#666666';
    context.fillText(`${brush.name.replace(/^Kyle's [^-]+- /, '')}, d ${diameter} · ${stamps[row * APPLICATIONS.length + column].toLocaleString()} stamps`, x + 12, y + 46, CELL.width - 20);
  }));
  return canvas.toDataURL('image/png');
}

Object.assign(globalThis, { drawStampFillSheet });

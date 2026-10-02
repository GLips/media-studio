// stamp-fill-sheet-page.ts: the fill sheet's browser side, run by lib/paint/studies/engine/stamp-fill-sheet.ts
// through withBrowserModulePage. It fills one region, a blob with a notch and a narrow neck, flooded and in each
// strokes pattern (StampFillApplication), a column each, labelled with how many stamps it cost. Brush images are served at /files/ (stamp-paint-pack-urls.ts).

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampSmoothRegion, type StampFillApplication } from '#lib/paint/painting/models/stamp-fill.ts';
import { compileStampPaintRecipe, stampPassDeposits } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { createStampPaintRenderer } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { createStampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { stampPaintPackAssetUrl, type StampPaintPackUrls } from '#lib/paint/brush-packs/models/stamp-paint-pack-urls.ts';

const CELL = { width: 330, height: 300 }, LABEL = 56;

const APPLICATIONS: readonly { label: string; application: StampFillApplication }[] = [
  { label: 'flood', application: { kind: 'flood' } },
  { label: 'zigzag', application: { kind: 'strokes', pattern: { kind: 'zigzag' } } },
  { label: 'back and forth', application: { kind: 'strokes', pattern: { kind: 'backAndForth' } } },
  { label: 'hatch', application: { kind: 'strokes', pattern: { kind: 'hatch' } } },
  { label: 'cross-hatch', application: { kind: 'strokes', pattern: { kind: 'crossHatch' } } },
  { label: 'scribble', application: { kind: 'strokes', pattern: { kind: 'scribble' } } },
  { label: 'shading', application: { kind: 'strokes', pattern: { kind: 'shading' } } },
];

/** The region in the cell at (`left`, `top`): a blob with a notch in its top and a neck to a lobe on its right. */
const cellRegion = (left: number, top: number) => stampSmoothRegion([
  [40, 90], [95, 40], [140, 95], [180, 45], [235, 70], [250, 120], [300, 115], [305, 165], [250, 170], [230, 230], [120, 260], [45, 200],
].map(([x, y]) => ({ x: left + x - 10, y: top + y })));

/** The sheet for `brush` at `diameter`, its images from `packUrls`, as a PNG data URL. */
async function drawStampFillSheet(brush: StampBrush, diameter: number, packUrls: StampPaintPackUrls): Promise<string> {
  const width = CELL.width * APPLICATIONS.length, height = LABEL + CELL.height;
  const material = { kind: 'color', color: '#1d2a44' } as const;
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: { color: '#ffffff' }, mixing: { kind: 'flat' } }, (paint) => APPLICATIONS.forEach(({ application }, column) => paint.group(`r0c${column}`, { composite: 'glaze', opacity: 1 }, (group) => group.passage('p', {}, (pass) => {
    pass.fill('fill', { brush, well: { paint: material }, size: diameter, application, direction: 0.35, region: cellRegion(column * CELL.width, LABEL) });
  })))));
  const stamps = painting.groups.map(({ passes }) => stampPassDeposits(passes[0])[0].stamps.length);
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const context = canvas.getContext('2d')!;
  const paintCanvas = Object.assign(document.createElement('canvas'), { width, height });
  const owner = await createStampPaintGpuOwner((asset) => stampPaintPackAssetUrl(packUrls, asset));
  try {
    const surface = await createStampPaintSurface(owner, { canvas: paintCanvas, width, height });
    // Copied before the surface is disposed, which unconfigures its canvas and clears it.
    try {
      const renderer = await createStampPaintRenderer(surface, painting);
      await renderer.draw({ kind: 'once', t: 0 });
      context.drawImage(paintCanvas, 0, 0);
    } finally {
      surface.dispose();
    }
  } finally {
    owner.dispose();
  }
  APPLICATIONS.forEach(({ label: applied }, column) => {
    const x = column * CELL.width;
    context.fillStyle = '#dddddd';
    context.fillRect(x, 0, CELL.width, 1);
    context.fillRect(x, 0, 1, LABEL + CELL.height);
    context.fillStyle = '#111111';
    context.font = 'bold 20px -apple-system, Helvetica, sans-serif';
    context.fillText(applied, x + 12, 26, CELL.width - 20);
    context.font = '14px -apple-system, Helvetica, sans-serif';
    context.fillStyle = '#666666';
    context.fillText(`${brush.name.replace(/^Kyle's [^-]+- /, '')}, d ${diameter} · ${stamps[column].toLocaleString()} stamps`, x + 12, 46, CELL.width - 20);
  });
  return canvas.toDataURL('image/png');
}

Object.assign(globalThis, { drawStampFillSheet });

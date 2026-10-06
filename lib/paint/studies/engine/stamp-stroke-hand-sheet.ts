// stamp-stroke-hand-sheet.ts: the stroke hand sheet, one path painted under each way of authoring its pressure
// (stamp-stroke-hand.ts) beside a constant-pressure stroke, a PNG per brush. The painting is the studio's GPU renderer's,
// drawn by stamp-stroke-hand-sheet-page.ts. `npm run brushes:hand` runs it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowserModulePage } from '#lib/platform/browser/engine/browser-module-page.ts';
import { resolveStampPaintPackBrushes } from '#lib/paint/brush-packs/models/stamp-paint-pack.ts';
import { stampPaintPackKey } from '#lib/paint/brush-packs/models/stamp-paint-pack-urls.ts';
import { readServedStampPaintPack } from '#lib/paint/brush-packs/engine/stamp-paint-pack-files.ts';
import { readProfiledStampPaintPack } from '#lib/paint/brush-packs/engine/stamp-brush-profile-store.ts';
import { readStampPaintStyleProbeMedium } from '#lib/paint/style/engine/style-probe-medium.ts';

const SHEET_PAGE = fileURLToPath(new URL('../studio/stamp-stroke-hand-sheet-page.ts', import.meta.url));

/** Draws the sheet for each of `brushes` (by name, from `pack` of `style`) at `diameter` into `out`; returns the PNGs' paths. */
export async function writeStampStrokeHandSheet({ stylesDir, style, pack, brushes, diameter, out }: {
  stylesDir: string; style: string; pack: string; brushes: readonly string[]; diameter: number; out: string;
}): Promise<string[]> {
  const served = readServedStampPaintPack(stylesDir, style, pack), packUrls = { [stampPaintPackKey(style, pack)]: served.url };
  const painted = resolveStampPaintPackBrushes(readProfiledStampPaintPack({ stylesDir, style, pack }, served, (await readStampPaintStyleProbeMedium(stylesDir, style)).key, brushes));
  const missing = brushes.filter((name) => !painted[name]);
  if (missing.length) throw new Error(`stroke hand sheet: ${pack} has no brush ${missing.map((name) => JSON.stringify(name)).join(', ')}`);
  mkdirSync(out, { recursive: true });
  return withBrowserModulePage({ entry: SHEET_PAGE, filesDir: stylesDir }, async (call) => {
    const written: string[] = [];
    for (const name of brushes) {
      const png = await call<string>('drawStampStrokeHandSheet', painted[name], diameter, packUrls);
      const file = join(out, `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`);
      writeFileSync(file, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
      written.push(file);
    }
    return written;
  });
}

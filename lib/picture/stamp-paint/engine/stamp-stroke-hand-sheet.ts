// stamp-stroke-hand-sheet.ts: the stroke hand sheet, one path painted under each way of authoring its pressure
// (stamp-stroke-hand.ts) beside a constant-pressure stroke, a PNG per brush. The painting is the studio's GPU renderer's,
// drawn by stamp-stroke-hand-sheet-page.ts. `npm run brushes:hand` runs it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowserModulePage } from '#lib/output/render/engine/browser-module-page.ts';
import { STAMP_PAINT_PACK_MANIFEST, type StampPaintPackManifest } from '../models/style.ts';

const SHEET_PAGE = fileURLToPath(new URL('../studio/stamp-stroke-hand-sheet-page.ts', import.meta.url));

/** Draws the sheet for each of `brushes` (by name, from `pack` of `style`) at `diameter` into `out`; returns the PNGs' paths. */
export async function writeStampStrokeHandSheet({ stylesDir, style, pack, brushes, diameter, out }: {
  stylesDir: string; style: string; pack: string; brushes: readonly string[]; diameter: number; out: string;
}): Promise<string[]> {
  const manifestFile = join(stylesDir, style, 'brushes', pack, STAMP_PAINT_PACK_MANIFEST);
  if (!existsSync(manifestFile)) throw new Error(`stroke hand sheet: ${pack} isn't imported into ${join(stylesDir, style, 'brushes')}`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as StampPaintPackManifest;
  const missing = brushes.filter((name) => !manifest.brushes[name]);
  if (missing.length) throw new Error(`stroke hand sheet: ${pack} has no brush ${missing.map((name) => JSON.stringify(name)).join(', ')}`);
  mkdirSync(out, { recursive: true });
  return withBrowserModulePage({ entry: SHEET_PAGE, filesDir: stylesDir }, async (call) => {
    const written: string[] = [];
    for (const name of brushes) {
      const png = await call<string>('drawStampStrokeHandSheet', manifest.brushes[name], diameter);
      const file = join(out, `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`);
      writeFileSync(file, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
      written.push(file);
    }
    return written;
  });
}

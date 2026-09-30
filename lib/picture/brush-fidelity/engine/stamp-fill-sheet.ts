// stamp-fill-sheet.ts: the fill sheet, one region filled as a wash and in each strokes pattern (StampFillApplication),
// laid and half drawn, a PNG per brush: how a brush fills, before choosing its application. The painting is the
// studio's GPU renderer's, drawn by stamp-fill-sheet-page.ts. `npm run brushes:fills` runs it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowserModulePage } from '#lib/output/render/engine/browser-module-page.ts';
import { resolveStampPaintPackBrushes } from '#lib/picture/stamp-styles/models/stamp-paint-pack.ts';
import { brushFidelityPackKey } from '../models/brush-fidelity-pack-urls.ts';
import { readBrushFidelityPack } from './brush-fidelity-targets.ts';

const SHEET_PAGE = fileURLToPath(new URL('../studio/stamp-fill-sheet-page.ts', import.meta.url));

/** Draws the sheet for each of `brushes` (by name, from `pack` of `style`) at `diameter` into `out`; returns the PNGs' paths. */
export async function writeStampFillSheet({ stylesDir, style, pack, brushes, diameter, out }: {
  stylesDir: string; style: string; pack: string; brushes: readonly string[]; diameter: number; out: string;
}): Promise<string[]> {
  const { manifest, url } = readBrushFidelityPack(stylesDir, style, pack), packUrls = { [brushFidelityPackKey(style, pack)]: url };
  const painted = resolveStampPaintPackBrushes(manifest);
  const missing = brushes.filter((name) => !painted[name]);
  if (missing.length) throw new Error(`fill sheet: ${pack} has no brush ${missing.map((name) => JSON.stringify(name)).join(', ')}`);
  mkdirSync(out, { recursive: true });
  // One brush at a time: each holds the GPU for its sheet.
  return withBrowserModulePage({ entry: SHEET_PAGE, filesDir: stylesDir }, (call) => brushes.reduce<Promise<string[]>>(async (done, name) => {
    const written = await done;
    const png = await call<string>('drawStampFillSheet', painted[name], diameter, packUrls);
    const file = join(out, `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`);
    writeFileSync(file, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
    return [...written, file];
  }, Promise.resolve([])));
}

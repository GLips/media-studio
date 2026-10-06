// narrow-fill-sheet.ts: the narrow-fill sheet (vid-119): narrow shapes flooded at several diameters by a wet
// workspace style's brushes, on the GPU by studio/narrow-fill-sheet-page.ts, a PNG a brush and another with the shapes'
// outlines over it. `npm run brushes:narrow-fills` runs it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowserModulePage } from '#lib/platform/browser/engine/browser-module-page.ts';
import type { NarrowFillPainted, NarrowFillSheetMedium } from '../models/narrow-fills.ts';
import { readWorkspacePigmentStyle } from '#lib/paint/style/engine/workspace-pigment-style.ts';

const SHEET_PAGE = fileURLToPath(new URL('../studio/narrow-fill-sheet-page.ts', import.meta.url));

/** `name`, a workspace style in `stylesDir` painting in pigment, with `brushes` (its brushes' names) to flood with. */
async function narrowFillMedium(stylesDir: string, name: string, brushes: readonly string[]): Promise<NarrowFillSheetMedium> {
  const { brushOf, paper, mixing, packUrls } = await readWorkspacePigmentStyle(stylesDir, name, 'narrow fills');
  return { brushes: Object.fromEntries(brushes.map((brush) => [brush, brushOf(brush)])), paper, mixing, packUrls };
}

/** Draws the sheet for each of `brushes` of `style` into `out` as <brush>.png and <brush>-outlined.png. Returns the files written. */
export async function writeNarrowFillSheet({ stylesDir, style, brushes, out }: { stylesDir: string; style: string; brushes: readonly string[]; out: string }): Promise<string[]> {
  const medium = await narrowFillMedium(stylesDir, style, brushes);
  mkdirSync(out, { recursive: true });
  // One brush at a time: each holds the GPU for its sheet.
  const painted = await withBrowserModulePage({ entry: SHEET_PAGE, filesDir: stylesDir }, (call) => brushes.reduce<Promise<NarrowFillPainted[]>>(async (done, brush) => [
    ...await done, ...await call<NarrowFillPainted[]>('drawNarrowFillSheet', brush, medium),
  ], Promise.resolve([])));
  return painted.map((each) => {
    if ('refused' in each) throw new Error(`narrow fills: ${each.brush} was refused: ${each.refused}`);
    const file = join(out, `${style}-${each.brush}.png`);
    writeFileSync(file, Buffer.from(each.png.slice(each.png.indexOf(',') + 1), 'base64'));
    return file;
  });
}

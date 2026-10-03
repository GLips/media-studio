// dry-passage-sheet.ts: the dry passage sheet (vid-124): every passage in models/dry-passages.ts drawn in a dry
// workspace style's own brushes, paper and pigments, on the GPU by studio/dry-passage-sheet-page.ts, written as one
// PNG a passage. `npm run dry:passages` runs it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowserModulePage } from '#lib/platform/browser/engine/browser-module-page.ts';
import { DRY_PASSAGE_CELL, DRY_PASSAGE_PAINTING_WIDTH, type DryPassageBrushes, type DryPassagePainted, type DryPassageSheetMedium } from '../models/dry-passages.ts';
import { readWorkspacePigmentStyle } from '#lib/paint/style/engine/workspace-pigment-style.ts';

const SHEET_PAGE = fileURLToPath(new URL('../studio/dry-passage-sheet-page.ts', import.meta.url));

/** `name`, a workspace style in `stylesDir` painting in pigment, with `roles` naming its brush for each of the kit's. */
async function dryPassageMedium(stylesDir: string, name: string, roles: Readonly<Record<keyof DryPassageBrushes, string>>): Promise<DryPassageSheetMedium> {
  const { brushOf, paper, mixing, packUrls } = await readWorkspacePigmentStyle(stylesDir, name, 'dry passages');
  const { grain } = paper;
  return {
    brushes: { stick: brushOf(roles.stick), side: brushOf(roles.side) },
    paper: { ...paper, ...(grain && { grain: { ...grain, scale: (grain.scale * DRY_PASSAGE_PAINTING_WIDTH) / DRY_PASSAGE_CELL.width } }) },
    mixing, packUrls,
  };
}

/** Draws the sheet in `style` (its brushes `stick` and `side`) into `out` as <passage>.png. Returns the files written. */
export async function writeDryPassageSheet({ stylesDir, style, out }: { stylesDir: string; style: string; out: string }): Promise<string[]> {
  const medium = await dryPassageMedium(stylesDir, style, { stick: 'stick', side: 'side' });
  mkdirSync(out, { recursive: true });
  const painted = await withBrowserModulePage({ entry: SHEET_PAGE, filesDir: stylesDir }, (call) => call<DryPassagePainted[]>('drawDryPassages', medium));
  return painted.map((each) => {
    if ('refused' in each) throw new Error(`dry passages: ${each.passage} was refused: ${each.refused}`);
    const file = join(out, `${each.passage}.png`);
    writeFileSync(file, Buffer.from(each.png.slice(each.png.indexOf(',') + 1), 'base64'));
    return file;
  });
}

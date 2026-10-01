// dry-passage-sheet.ts: the dry passage sheet (vid-124): every passage in models/dry-passages.ts drawn in a dry
// workspace style's own brushes, paper and pigments, on the GPU by studio/dry-passage-sheet-page.ts, written as one
// PNG a passage. `npm run dry:passages` runs it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withBrowserModulePage } from '#lib/output/render/engine/browser-module-page.ts';
import { resolveStampPaintStyle, type StampPaintStyle } from '#lib/picture/stamp-styles/models/style.ts';
import { brushFidelityPackKey } from '../models/brush-fidelity-pack-urls.ts';
import { DRY_PASSAGE_CELL, DRY_PASSAGE_PAINTING_WIDTH, type DryPassageBrushes, type DryPassagePainted, type DryPassageSheetMedium } from '../models/dry-passages.ts';
import { readBrushFidelityPack } from './brush-fidelity-targets.ts';

const SHEET_PAGE = fileURLToPath(new URL('../studio/dry-passage-sheet-page.ts', import.meta.url));

/** `name`, a workspace style in `stylesDir` painting in pigment, with `roles` naming its brush for each of the kit's. */
async function dryPassageMedium(stylesDir: string, name: string, roles: Readonly<Record<keyof DryPassageBrushes, string>>): Promise<DryPassageSheetMedium> {
  // SAFETY: a workspace style's style.ts default-exports a StampPaintStyle (`satisfies StampPaintStyle`), which the workspace typecheck holds.
  const style = (await import(pathToFileURL(join(stylesDir, name, 'style.ts')).href) as { default: StampPaintStyle }).default;
  const packs = Object.keys(style.packs).map((pack) => {
    const { manifest, url } = readBrushFidelityPack(stylesDir, name, pack);
    return { pack, manifest, url };
  });
  const resolved = resolveStampPaintStyle(name, style, Object.fromEntries(packs.map(({ pack, manifest }) => [pack, manifest])));
  if (resolved.mixing.kind !== 'pigment') throw new Error(`dry passages: ${name} paints in flat colour, and the passages are drawn in pigment`);
  const brushOf = (role: string) => {
    const brush = resolved.brushes[role];
    if (!brush) throw new Error(`dry passages: ${name} has no brush ${role}`);
    return brush;
  };
  const { grain } = resolved.paper;
  return {
    brushes: { stick: brushOf(roles.stick), side: brushOf(roles.side) },
    paper: { ...resolved.paper, ...(grain && { grain: { ...grain, scale: (grain.scale * DRY_PASSAGE_PAINTING_WIDTH) / DRY_PASSAGE_CELL.width } }) },
    mixing: resolved.mixing,
    packUrls: Object.fromEntries(packs.map(({ pack, url }) => [brushFidelityPackKey(name, pack), url])),
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

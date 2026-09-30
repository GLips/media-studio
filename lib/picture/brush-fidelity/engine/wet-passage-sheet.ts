// wet-passage-sheet.ts: the reference-passages sheet (vid-117): every passage in models/wet-passages.ts painted in
// watercolour, gouache and a dry medium, each in its workspace style's own brushes, paper and pigments, on the GPU by
// studio/wet-passage-sheet-page.ts; then the page for the person judging them (wet-passage-sheet-html.ts), with the
// notes kept beside it. `npm run wet:passages` runs it.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withBrowserModulePage } from '#lib/output/render/engine/browser-module-page.ts';
import { resolveStampPaintStyle, type StampPaintStyle } from '#lib/picture/stamp-styles/models/style.ts';
import { brushFidelityPackKey } from '../models/brush-fidelity-pack-urls.ts';
import { wetPassageSheetHtml, type WetPassageSheetColumn, type WetPassageSheetNotes } from '../models/wet-passage-sheet-html.ts';
import type { WetPassageBrushes, WetPassagePainted, WetPassageSheetMedium } from '../models/wet-passages.ts';
import { readBrushFidelityPack } from './brush-fidelity-targets.ts';

const SHEET_PAGE = fileURLToPath(new URL('../studio/wet-passage-sheet-page.ts', import.meta.url));

/** Each medium's column: the workspace style painting in it, and which of its brushes a painter reaches for in each role. */
const WET_PASSAGE_MEDIA: readonly { label: string; style: string; brushes: Readonly<Record<keyof WetPassageBrushes, string>> }[] = [
  { label: 'Watercolour', style: 'watercolor', brushes: { fill: 'wash', drop: 'wet', water: 'blend', lift: 'shadow' } },
  { label: 'Gouache', style: 'gouache', brushes: { fill: 'wash', drop: 'round', water: 'round', lift: 'flat' } },
  { label: 'Crayon', style: 'crayon', brushes: { fill: 'side', drop: 'stick', water: 'tooth', lift: 'chalk' } },
];

const isText = (value: unknown): value is string => typeof value === 'string';
const isOptionalText = (value: unknown): value is string | undefined => value === undefined || isText(value);

/** Whether `value`, a parsed notes.json, is notes: each field text or left out, and passages' text by ID. */
function isWetPassageSheetNotes(value: unknown): value is WetPassageSheetNotes {
  if (typeof value !== 'object' || value === null) return false;
  const fields = new Map<string, unknown>(Object.entries(value)), passages = fields.get('passages');
  const passagesHeld = passages === undefined || (typeof passages === 'object' && passages !== null && Object.values(passages).every(isText));
  return passagesHeld && ['intro', 'animation', 'landscape'].every((name) => isOptionalText(fields.get(name)));
}

/** A medium's style, read from `stylesDir`, as the page paints with it. */
async function wetPassageMedium(stylesDir: string, { style: name, brushes: roles }: (typeof WET_PASSAGE_MEDIA)[number]): Promise<WetPassageSheetMedium> {
  // SAFETY: a workspace style's style.ts default-exports a StampPaintStyle (`satisfies StampPaintStyle`), which the workspace typecheck holds.
  const style = (await import(pathToFileURL(join(stylesDir, name, 'style.ts')).href) as { default: StampPaintStyle }).default;
  const packs = Object.keys(style.packs).map((pack) => {
    const { manifest, url } = readBrushFidelityPack(stylesDir, name, pack);
    return { pack, manifest, url };
  });
  const resolved = resolveStampPaintStyle(name, style, Object.fromEntries(packs.map(({ pack, manifest }) => [pack, manifest])));
  if (resolved.mixing.kind !== 'pigment') throw new Error(`wet passages: ${name} paints in flat colour, and a wash is pigment's`);
  const brushOf = (role: string) => {
    const brush = resolved.brushes[role];
    if (!brush) throw new Error(`wet passages: ${name} has no brush ${role}`);
    return brush;
  };
  return {
    brushes: { fill: brushOf(roles.fill), drop: brushOf(roles.drop), water: brushOf(roles.water), lift: brushOf(roles.lift) },
    paper: resolved.paper, mixing: resolved.mixing,
    packUrls: Object.fromEntries(packs.map(({ pack, url }) => [brushFidelityPackKey(name, pack), url])),
  };
}

/**
 * Paints the sheet into `out`: passages/<passage>-<style>.png and index.html, which shows the images of `landscape/`
 * in `out` in name order (a leading `<n>-` orders them, left out of the caption) and links each of `references` by its
 * absolute path. Reads `out`/notes.json (WetPassageSheetNotes) when there is one. Returns the files written.
 */
export async function writeWetPassageSheet({ stylesDir, out, references }: { stylesDir: string; out: string; references: readonly string[] }): Promise<string[]> {
  const inputs = await Promise.all(WET_PASSAGE_MEDIA.map((medium) => wetPassageMedium(stylesDir, medium)));
  mkdirSync(join(out, 'passages'), { recursive: true });
  const written: string[] = [];
  /** A medium's column, each passage it painted written as passages/<passage>-<style>.png. */
  const column = ({ label, style }: (typeof WET_PASSAGE_MEDIA)[number], painted: readonly WetPassagePainted[]): WetPassageSheetColumn => {
    const passages: WetPassageSheetColumn['passages'] = {};
    for (const each of painted) {
      if ('refused' in each) {
        passages[each.passage] = { refused: each.refused };
        continue;
      }
      const file = `passages/${each.passage}-${style}.png`;
      writeFileSync(join(out, file), Buffer.from(each.png.slice(each.png.indexOf(',') + 1), 'base64'));
      written.push(join(out, file));
      passages[each.passage] = { file };
    }
    return { label, passages };
  };
  // One medium at a time: each passage holds the GPU while it paints.
  const columns = await withBrowserModulePage({ entry: SHEET_PAGE, filesDir: stylesDir }, (call) => WET_PASSAGE_MEDIA.reduce<Promise<WetPassageSheetColumn[]>>(async (done, medium, m) => {
    const before = await done;
    return [...before, column(medium, await call<WetPassagePainted[]>('drawWetPassages', inputs[m]))];
  }, Promise.resolve([])));
  const notesFile = join(out, 'notes.json');
  const notes: unknown = existsSync(notesFile) ? JSON.parse(readFileSync(notesFile, 'utf8')) : {};
  if (!isWetPassageSheetNotes(notes)) throw new Error(`wet passages: ${notesFile} isn't notes: an object of intro, animation and landscape text and passages' text by ID`);
  const landscapeDir = join(out, 'landscape');
  const landscape = existsSync(landscapeDir)
    ? readdirSync(landscapeDir).filter((file) => file.endsWith('.png')).toSorted().map((file) => ({ file: `landscape/${file}`, caption: file.replace(/\.png$/, '').replace(/^\d+-/, '').replace(/-/g, ' ') }))
    : [];
  writeFileSync(join(out, 'index.html'), wetPassageSheetHtml(columns, notes, { landscape, references }));
  return [...written, join(out, 'index.html')];
}

// stamp-brush-sheet.ts: `studio brushes sheet`, the brush fidelity sheet. Each brush of an imported pack is painted by
// the studio's GPU renderer along the stroke its Procreate preview was drawn with, beside that preview, at the diameter
// whose thickness matches the preview's, and the two are measured alike (procreate-preview-stroke.ts). Writes, in
// brushes/<pack>/fidelity/ unless told otherwise: a row per brush (rows/<brush>.png), the rows stacked at half size
// (sheet.jpg), and report.json with each brush's diameter, measures and label from the style's fidelity.ts.
//
// The sheet embeds the pack's previews, so it stays under brushes/, which git ignores; an import replaces the pack's
// folder and so clears a sheet drawn from the brushes it replaced.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runFfmpeg } from '#lib/output/ffmpeg/engine/ffmpeg.ts';
import { withBrowserModulePage } from '#lib/output/render/engine/browser-module-page.ts';
import { compareStrokeProfiles, type StrokeCoverageProfile, type StrokeProfileComparison } from '../models/procreate-preview-stroke.ts';
import type { StampBrush } from '../models/stamp-brush.ts';
import { STAMP_PAINT_PACK_MANIFEST, type StampBrushFidelity, type StampPaintPackManifest, type StampPaintStyleFidelity } from '../models/style.ts';

const SHEET_PAGE = fileURLToPath(new URL('../studio/stamp-brush-sheet-page.ts', import.meta.url));
/** Rounds of fitting the diameter to the preview's thickness; thickness follows diameter closely, so two land within a few percent. */
const DIAMETER_FITS = 3;
/** The diameter a brush is first painted at, before it's fitted: about a mid-sized preview's thickness. */
const FIRST_DIAMETER = 120;

export type StampBrushSheetEntry = {
  brush: string;
  row: string;
  diameter: number;
  comparison?: StrokeProfileComparison;
  fidelity?: StampBrushFidelity;
};

export type StampBrushSheet = { dir: string; sheet: string; entries: StampBrushSheetEntry[]; unlabelled: string[] };

const slugOf = (preview: string | undefined, name: string) => (preview ? basename(preview, '.png') : name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
const pct = (n: number) => `${Math.round(n * 100)}%`;

async function readStyleFidelity(styleDir: string): Promise<StampPaintStyleFidelity> {
  const file = join(styleDir, 'fidelity.ts');
  return existsSync(file) ? (await import(pathToFileURL(file).href) as { default: StampPaintStyleFidelity }).default : {};
}

function describeBrush(brush: StampBrush): string {
  const grain = brush.grain ? `grain ${brush.grain.mode} ×${brush.grain.scale.toFixed(2)} depth ${brush.grain.depth.toFixed(2)}` : 'no grain';
  const edges = [brush.wetEdge && `wet ${brush.wetEdge.strength.toFixed(2)}`, brush.burntEdge && `burnt ${brush.burntEdge.strength.toFixed(2)}`].filter(Boolean).join(' ');
  const dual = brush.dual ? `dual ${brush.dual.blend} ×${brush.dual.scale.toFixed(2)}` : '';
  return [grain, edges, dual, brush.accumulation, `taper ${brush.taper.start.toFixed(2)}/${brush.taper.end.toFixed(2)}`].filter(Boolean).join(' · ');
}

function describeComparison(c: StrokeProfileComparison | undefined): string {
  if (!c) return 'no preview to measure against';
  return `length ×${c.length.toFixed(2)} · peak ×${c.peak.toFixed(2)} · profile off ${pct(c.profileError)} · 80% reached ${pct(c.start.preview)}→${pct(c.start.ours)} in, ${pct(c.end.preview)}→${pct(c.end.ours)} from the end · density ${c.density >= 0 ? '+' : ''}${c.density.toFixed(2)} · rim ${c.rim.preview.toFixed(2)}→${c.rim.ours.toFixed(2)} · grain ${c.grain.preview.toFixed(1)}→${c.grain.ours.toFixed(1)} px`;
}

/**
 * Draws the sheet for `pack` of `style` (every brush, or only `only`, by name) into `out` (brushes/<pack>/fidelity/ by
 * default), replacing what's there.
 */
export async function writeStampBrushSheet({ stylesDir, style, pack, out, only }: { stylesDir: string; style: string; pack: string; out?: string; only?: readonly string[] }): Promise<StampBrushSheet> {
  const styleDir = join(stylesDir, style), packDir = join(styleDir, 'brushes', pack);
  const manifestFile = join(packDir, STAMP_PAINT_PACK_MANIFEST);
  if (!existsSync(manifestFile)) throw new Error(`brushes sheet: ${pack} isn't imported into work/styles/${style}/brushes/; run studio brushes import first`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as StampPaintPackManifest;
  const labels = (await readStyleFidelity(styleDir))[pack] ?? {};
  const names = Object.keys(manifest.brushes).filter((name) => !only || only.includes(name));
  const missing = only?.filter((name) => !manifest.brushes[name]) ?? [];
  if (missing.length) throw new Error(`brushes sheet: ${pack} has no brush ${missing.map((name) => JSON.stringify(name)).join(', ')}`);

  const dir = out ?? join(packDir, 'fidelity');
  rmSync(join(dir, 'rows'), { recursive: true, force: true });
  mkdirSync(join(dir, 'rows'), { recursive: true });
  const entries = await withBrowserModulePage({ entry: SHEET_PAGE, filesDir: packDir }, async (call) => {
    const done: StampBrushSheetEntry[] = [];
    for (const name of names) {
      const brush = manifest.brushes[name], previewFile = manifest.previews[name]?.image, shows = manifest.previews[name]?.shows ?? 'stroke';
      const preview = previewFile ? await call<StrokeCoverageProfile | null>('measureProcreatePreview', previewFile) : null;
      let diameter = FIRST_DIAMETER;
      let painted = await call<{ png: string; profile: StrokeCoverageProfile | null }>('paintOnProcreatePreviewStroke', brush, diameter, shows);
      for (let fit = 0; preview && painted.profile && fit < DIAMETER_FITS; fit++) {
        const next = Math.min(2000, Math.max(2, diameter * (preview.peakThickness / painted.profile.peakThickness)));
        if (Math.abs(next / diameter - 1) < 0.02) break;
        diameter = next;
        painted = await call('paintOnProcreatePreviewStroke', brush, diameter, shows);
      }
      const comparison = preview && painted.profile ? compareStrokeProfiles(preview, painted.profile) : undefined;
      const fidelity = labels[name];
      const lines = [
        `${name}  ·  ${fidelity ? fidelity.level.toUpperCase() : 'UNLABELLED'}${fidelity ? `: ${fidelity.note}` : ''}`,
        `d ${Math.round(diameter)} px · ${describeComparison(comparison)}`,
        describeBrush(brush),
      ];
      const row = join(dir, 'rows', `${slugOf(previewFile, name)}.png`);
      const png = await call<string>('drawStampBrushSheetRow', { previewFile, ours: painted.png, lines, label: fidelity?.level });
      writeFileSync(row, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
      done.push({ brush: name, row, diameter: Math.round(diameter), comparison, fidelity });
    }
    return done;
  });

  const sheet = join(dir, 'sheet.jpg');
  const inputs = entries.flatMap(({ row }) => ['-i', row]);
  const stack = entries.length > 1 ? `${entries.map((_, i) => `[${i}]`).join('')}vstack=inputs=${entries.length},` : '';
  runFfmpeg(['-nostdin', '-v', 'error', ...inputs, '-filter_complex', `${stack}scale=iw/2:-1`, '-frames:v', '1', '-q:v', '3', '-y', sheet]);
  const unlabelled = Object.keys(manifest.brushes).filter((name) => !labels[name]);
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify({ style, pack, source: manifest.source, entries: entries.map((e) => ({ ...e, row: basename(e.row) })), unlabelled }, null, 2)}\n`);
  return { dir, sheet, entries, unlabelled };
}

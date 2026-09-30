// stamp-brush-sheet.ts: `npm run brushes:sheet`, the brush fidelity sheet. Each brush of an imported pack is painted by
// the studio's GPU renderer beside its target, and the two are measured alike (procreate-preview-stroke.ts). The target
// is the brush's Procreate preview, painted along the stroke the preview was drawn with at the diameter whose thickness
// matches it; or without one its Photoshop reference (photoshop-reference-target.ts), painted as the rig painted it, at
// its diameter under simulated pressure (photoshop-reference-stroke.ts). A brush with neither is painted at its
// source's own size, unscored. Writes, in brushes/<pack>/fidelity/ unless told otherwise: a row per brush
// (rows/<brush>.png), the rows stacked at half size (sheet.jpg; sheet-1.jpg, sheet-2.jpg… past 120 brushes), and
// report.json with each brush's diameter, measures, score and grade, and its note from the style's fidelity.ts. A
// whole pack drawn where it belongs also writes each brush's score and grade into the style's
// fidelity-grades.json, which git keeps, so a painter reads the grades without drawing the sheet.
//
// The sheet embeds the pack's previews, so it stays under brushes/, which git ignores. An import leaves fidelity/ be,
// so a sheet there shows the brushes as they were when it was drawn.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runFfmpeg } from '#lib/output/ffmpeg/engine/ffmpeg.ts';
import { withBrowserModulePage, type BrowserModuleCall } from '#lib/output/render/engine/browser-module-page.ts';
import {
  compareStrokeProfiles, STROKE_SCORE_GRADES, strokeFidelityGrade, type StrokeCoverageProfile, type StrokeFidelityGrade, type StrokeProfileComparison,
} from '../models/procreate-preview-stroke.ts';
import type { StampBrush } from '../models/stamp-brush.ts';
import { STAMP_PAINT_PACK_MANIFEST, type StampPaintPackManifest, type StampPaintStyleFidelity, STAMP_PAINT_FIDELITY_GRADES, type StampPaintStyleGrades } from '../models/style.ts';
import { photoshopReferenceStrokePng, readPhotoshopReferenceStrokes } from './photoshop-reference-target.ts';

const SHEET_PAGE = fileURLToPath(new URL('../studio/stamp-brush-sheet-page.ts', import.meta.url));
/** Rounds of fitting the diameter to the preview's thickness; thickness follows diameter closely, so two land within a few percent. */
const DIAMETER_FITS = 3;
/** Rows to a sheet image. */
const SHEET_ROWS = 120;
/** The diameter a brush is first painted at, before it's fitted: about a mid-sized preview's thickness. */
const FIRST_DIAMETER = 120;
/** The diameters a brush without a preview may be painted at, its source's own clamped to what the row shows whole. */
const UNPREVIEWED_DIAMETER = { min: 16, max: 240 };

export type StampBrushSheetEntry = {
  brush: string;
  row: string;
  diameter: number;
  /** What the brush was measured against; none for a brush with neither a preview nor a reference. */
  target?: 'Procreate preview' | 'Photoshop reference';
  comparison?: StrokeProfileComparison;
  /** From the comparison's score; none without a preview to score against. */
  grade?: StrokeFidelityGrade;
  /** The style's fidelity.ts note on why it differs. */
  note?: string;
};

export type StampBrushSheet = { dir: string; sheets: string[]; entries: StampBrushSheetEntry[]; scores?: string };

/** The sheet's browser page, run with the styles folder served at /files/. */
export const withStampBrushSheetPage = <T>(stylesDir: string, use: (call: BrowserModuleCall) => Promise<T>) => withBrowserModulePage({ entry: SHEET_PAGE, filesDir: stylesDir }, use);

/** A pack's file as the sheet page loads it: its URL under the styles folder, served at /files/. */
export const packFile = (style: string, pack: string, file: string) => `/files/${style}/brushes/${pack}/${file}`;

/**
 * `brush` painted as Procreate previews it, at the diameter whose peak thickness matches `preview`'s, the target's
 * measure (or, without one, its source's own `diameter` held within the row, else the first diameter), and measured;
 * with the painting as a PNG data URL when `withPng`.
 */
export async function paintAtPreviewThickness(
  call: BrowserModuleCall, brush: StampBrush, shows: 'stroke' | 'stamp', preview: StrokeCoverageProfile | null, withPng: boolean,
  sourceDiameter?: number,
): Promise<{ diameter: number; png?: string; profile: StrokeCoverageProfile | null }> {
  let diameter = !preview && sourceDiameter ? Math.min(UNPREVIEWED_DIAMETER.max, Math.max(UNPREVIEWED_DIAMETER.min, sourceDiameter)) : FIRST_DIAMETER;
  let painted = await call<{ png?: string; profile: StrokeCoverageProfile | null }>('paintOnProcreatePreviewStroke', brush, diameter, shows, withPng);
  for (let fit = 0; preview && painted.profile && fit < DIAMETER_FITS; fit++) {
    const next = Math.min(2000, Math.max(2, diameter * (preview.peakThickness / painted.profile.peakThickness)));
    if (Math.abs(next / diameter - 1) < 0.02) break;
    diameter = next;
    painted = await call('paintOnProcreatePreviewStroke', brush, diameter, shows, withPng);
  }
  return { diameter, ...painted };
}

const slugOf = (preview: string | undefined, name: string) => (preview ? basename(preview, '.png') : name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
const pct = (n: number) => `${Math.round(n * 100)}%`;

async function readStyleFidelity(styleDir: string): Promise<StampPaintStyleFidelity> {
  const file = join(styleDir, 'fidelity.ts');
  return existsSync(file) ? (await import(pathToFileURL(file).href) as { default: StampPaintStyleFidelity }).default : {};
}

function describeBrush(brush: StampBrush): string {
  const grain = brush.grain ? `grain ${brush.grain.mode} ${brush.grain.blend} ×${brush.grain.scale.toFixed(2)} depth ${brush.grain.depth.toFixed(2)}` : 'no grain';
  const edges = [brush.wetEdge && `wet rim ${brush.wetEdge.rim.toFixed(2)}`, brush.pooling && `pooling ${brush.pooling.peak.toFixed(2)}/${brush.pooling.body.toFixed(2)}`, brush.burntEdge && `burnt ${brush.burntEdge.strength.toFixed(2)}`].filter(Boolean).join(' ');
  const dual = brush.dual ? `dual ${brush.dual.blend} ×${brush.dual.scale.toFixed(2)}` : '';
  return [grain, edges, dual, brush.accumulation, `taper ${brush.taper.start.toFixed(2)}/${brush.taper.end.toFixed(2)}`].filter(Boolean).join(' · ');
}

function describeComparison(c: StrokeProfileComparison | undefined): string {
  if (!c) return 'nothing to measure against';
  return `score ${c.score.toFixed(3)} · map off ${pct(c.mapError)} · length ×${c.length.toFixed(2)} · peak ×${c.peak.toFixed(2)} · profile off ${pct(c.profileError)} · 80% reached ${pct(c.start.preview)}→${pct(c.start.ours)} in, ${pct(c.end.preview)}→${pct(c.end.ours)} from the end · density ${c.density >= 0 ? '+' : ''}${c.density.toFixed(2)} · rim ${c.rim.preview.toFixed(2)}→${c.rim.ours.toFixed(2)} · grain ${c.grain.preview.toFixed(1)}→${c.grain.ours.toFixed(1)} px · edge ${c.edgeWidth.preview}→${c.edgeWidth.ours} px · mottle ${c.mottle.preview.fine.toFixed(2)}/${c.mottle.preview.coarse.toFixed(2)}→${c.mottle.ours.fine.toFixed(2)}/${c.mottle.ours.coarse.toFixed(2)} · fill ${c.fill.preview.toFixed(2)}→${c.fill.ours.toFixed(2)}`;
}

/**
 * Draws the sheet for `pack` of `style` (every brush, or only `only`, by name) into `out` (brushes/<pack>/fidelity/ by
 * default), replacing what's there.
 */
export async function writeStampBrushSheet({ stylesDir, style, pack, out, only }: {
  stylesDir: string; style: string; pack: string; out?: string; only?: readonly string[];
}): Promise<StampBrushSheet> {
  const styleDir = join(stylesDir, style), packDir = join(styleDir, 'brushes', pack);
  const manifestFile = join(packDir, STAMP_PAINT_PACK_MANIFEST);
  if (!existsSync(manifestFile)) throw new Error(`brushes sheet: ${pack} isn't imported into work/styles/${style}/brushes/; run studio brushes import first`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as StampPaintPackManifest;
  const notes = (await readStyleFidelity(styleDir))[pack] ?? {};
  const names = Object.keys(manifest.brushes).filter((name) => !only || only.includes(name));
  const missing = only?.filter((name) => !manifest.brushes[name]) ?? [];
  if (missing.length) throw new Error(`brushes sheet: ${pack} has no brush ${missing.map((name) => JSON.stringify(name)).join(', ')}`);

  const dir = out ?? join(packDir, 'fidelity');
  rmSync(join(dir, 'rows'), { recursive: true, force: true });
  mkdirSync(join(dir, 'rows'), { recursive: true });
  const references = readPhotoshopReferenceStrokes(packDir);
  const entries = await withStampBrushSheetPage(stylesDir, async (call) => {
    const done: StampBrushSheetEntry[] = [];
    for (const name of names) {
      const brush = manifest.brushes[name], previewFile = manifest.previews[name]?.image, shows = manifest.previews[name]?.shows ?? 'stroke';
      const reference = previewFile ? undefined : references.get(name);
      const target = previewFile ? { src: packFile(style, pack, previewFile), label: 'Procreate preview' as const }
        : reference ? { src: photoshopReferenceStrokePng(reference), label: 'Photoshop reference' as const } : undefined;
      const preview = target ? await call<StrokeCoverageProfile | null>('measureStrokeTarget', target.src) : null;
      const { diameter, ...painted } = reference
        ? { diameter: reference.diameter, ...await call<{ png?: string; profile: StrokeCoverageProfile | null }>('paintOnPhotoshopReferenceStroke', brush, reference.diameter, reference.poseOverrides, true) }
        : await paintAtPreviewThickness(call, brush, shows, preview, true, manifest.diameters?.[name]);
      const comparison = preview && painted.profile ? compareStrokeProfiles(preview, painted.profile) : undefined;
      const note = notes[name], grade = comparison && strokeFidelityGrade(comparison.score);
      const lines = [
        `${name}  ·  ${grade ? grade.toUpperCase() : target ? 'NOT MEASURED' : 'NO TARGET'}${note ? `: ${note}` : ''}`,
        `d ${Math.round(diameter)} px · ${describeComparison(comparison)}`,
        describeBrush(brush),
      ];
      const row = join(dir, 'rows', `${slugOf(previewFile, name)}.png`);
      const png = await call<string>('drawStampBrushSheetRow', { target, ours: painted.png, lines, grade });
      writeFileSync(row, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
      done.push({ brush: name, row, diameter: Math.round(diameter), ...(target && { target: target.label }), comparison, ...(grade && { grade }), ...(note && { note }) });
    }
    return done;
  });

  // One JPEG can't pass 65,535 px tall, and a row is 211 px at half size: a big pack (Legacy's 471) takes several.
  const pages = Array.from({ length: Math.ceil(entries.length / SHEET_ROWS) }, (_, i) => entries.slice(i * SHEET_ROWS, (i + 1) * SHEET_ROWS));
  for (const stale of readdirSync(dir).filter((file) => /^sheet(-\d+)?\.jpg$/.test(file))) rmSync(join(dir, stale));
  const sheets = pages.map((page, i) => {
    const sheet = join(dir, pages.length > 1 ? `sheet-${i + 1}.jpg` : 'sheet.jpg');
    const stack = page.length > 1 ? `${page.map((_, k) => `[${k}]`).join('')}vstack=inputs=${page.length},` : '';
    runFfmpeg(['-nostdin', '-v', 'error', ...page.flatMap(({ row }) => ['-i', row]), '-filter_complex', `${stack}scale=iw/2:-1`, '-frames:v', '1', '-q:v', '3', '-y', sheet]);
    return sheet;
  });
  const total = entries.reduce((sum, e) => sum + (e.comparison?.score ?? 0), 0);
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify({ style, pack, source: manifest.source, grades: STROKE_SCORE_GRADES, total, entries: entries.map((e) => ({ ...e, row: basename(e.row) })) }, null, 2)}\n`);
  let scores: string | undefined;
  if (!out && !only) {
    scores = join(styleDir, STAMP_PAINT_FIDELITY_GRADES);
    const all: StampPaintStyleGrades = existsSync(scores) ? JSON.parse(readFileSync(scores, 'utf8')) : {};
    all[pack] = Object.fromEntries(entries.flatMap((e) => (e.comparison && e.grade ? [[e.brush, { grade: e.grade, score: Math.round(e.comparison.score * 1000) / 1000 }]] : [])));
    writeFileSync(scores, `${JSON.stringify(all, null, 2)}\n`);
  }
  return { dir, sheets, entries, scores };
}

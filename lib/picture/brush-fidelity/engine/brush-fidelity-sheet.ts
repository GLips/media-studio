// brush-fidelity-sheet.ts: `npm run brushes:sheet`, the brush fidelity sheet. Each brush of an imported pack is scored
// against its target (brush-fidelity-score.ts): painted by the studio's GPU renderer as its Procreate preview or its
// Photoshop reference was, and the two measured alike; a brush with neither is painted at its source's own size,
// unscored. Writes, in brushes/<pack>/fidelity/ unless told otherwise: a row per brush (rows/<brush>.png), the rows
// stacked at half size (sheet.jpg; sheet-1.jpg, sheet-2.jpg… past 120 brushes), and report.json with each brush's
// diameter, measures, score and grade, and its note from the style's fidelity.ts. A whole pack drawn where it belongs
// also writes each brush's score and grade into the style's fidelity-grades.json, which git keeps, so a painter reads
// the grades without drawing the sheet.
//
// The sheet embeds the pack's previews, so it stays under brushes/, which git ignores. An import leaves fidelity/ be,
// so a sheet there shows the brushes as they were when it was drawn.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runFfmpeg } from '#lib/output/ffmpeg/engine/ffmpeg.ts';
import type { StampBrush } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { resolveStampPaintPackBrushes } from '#lib/picture/stamp-styles/models/stamp-paint-pack.ts';
import { readStampPaintPackDir } from '#lib/picture/stamp-styles/engine/stamp-paint-pack-files.ts';
import { STAMP_PAINT_FIDELITY_GRADES, type StampPaintStyleFidelity, type StampPaintStyleGrades } from '../models/brush-fidelity-style.ts';
import { BRUSH_FIDELITY_TARGET_LABELS, type BrushFidelityTargetLabel } from '../models/brush-fidelity-target.ts';
import { STROKE_SCORE_GRADES, strokeFidelityGrade, type StrokeFidelityGrade, type StrokeProfileComparison } from '../models/stroke-measure.ts';
import { measureBrushFidelityTarget, scoreBrushFidelity, withBrushFidelityPage } from './brush-fidelity-score.ts';
import { brushFidelityTargetSrc, readBrushFidelityTargets, type BrushFidelityReport } from './brush-fidelity-targets.ts';

/** Rows to a sheet image. */
const SHEET_ROWS = 120;

export type BrushFidelitySheetEntry = {
  brush: string;
  row: string;
  diameter: number;
  target: BrushFidelityTargetLabel;
  comparison?: StrokeProfileComparison;
  /** Against a measured target: the comparison's score, or what painting nothing scores. */
  score?: number;
  grade?: StrokeFidelityGrade;
  /** The style's fidelity.ts note on why it differs. */
  note?: string;
};

export type BrushFidelitySheet = { dir: string; sheets: string[]; entries: BrushFidelitySheetEntry[]; scores?: string };

const slugOf = (preview: string | undefined, name: string) => (preview ? basename(preview, '.png') : name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
const pct = (n: number) => `${Math.round(n * 100)}%`;

async function readStyleFidelity(styleDir: string): Promise<StampPaintStyleFidelity> {
  const file = join(styleDir, 'fidelity.ts');
  return existsSync(file) ? (await import(pathToFileURL(file).href) as { default: StampPaintStyleFidelity }).default : {};
}

function describeBrush(brush: StampBrush): string {
  const grain = brush.grain ? `grain ${brush.grain.kind} ${brush.grain.blend.mode} ×${brush.grain.scale.toFixed(2)} depth ${brush.grain.depth.toFixed(2)}` : 'no grain';
  const wet = brush.wetEdges && (brush.wetEdges.kind === 'rim' ? `wet rim ${brush.wetEdges.rim.toFixed(2)}` : `pooling ${brush.wetEdges.peak.toFixed(2)}/${brush.wetEdges.body.toFixed(2)}`);
  const edges = [wet, brush.burntEdge && `burnt ${brush.burntEdge.strength.toFixed(2)}`].filter(Boolean).join(' ');
  const dual = brush.dual ? `dual ${brush.dual.blend.mode} ×${brush.dual.scale.toFixed(2)}` : '';
  return [grain, edges, dual, brush.accumulation.kind, `taper ${brush.taper.start.toFixed(2)}/${brush.taper.end.toFixed(2)}`].filter(Boolean).join(' · ');
}

function describeComparison(c: StrokeProfileComparison | undefined, score: number | undefined): string {
  if (!c) return score === undefined ? 'nothing to measure against' : `paints nothing: score ${score.toFixed(3)}`;
  return `score ${c.score.toFixed(3)} · map off ${pct(c.mapError)} · length ×${c.length.toFixed(2)} · peak ×${c.peak.toFixed(2)} · profile off ${pct(c.profileError)} · 80% reached ${pct(c.start.preview)}→${pct(c.start.ours)} in, ${pct(c.end.preview)}→${pct(c.end.ours)} from the end · density ${c.density >= 0 ? '+' : ''}${c.density.toFixed(2)} · rim ${c.rim.preview.toFixed(2)}→${c.rim.ours.toFixed(2)} · grain ${c.grain.preview.toFixed(1)}→${c.grain.ours.toFixed(1)} px · edge ${c.edgeWidth.preview}→${c.edgeWidth.ours} px · mottle ${c.mottle.preview.fine.toFixed(2)}/${c.mottle.preview.coarse.toFixed(2)}→${c.mottle.ours.fine.toFixed(2)}/${c.mottle.ours.coarse.toFixed(2)} · fill ${c.fill.preview.toFixed(2)}→${c.fill.ours.toFixed(2)}`;
}

/**
 * Draws the sheet for `pack` of `style` (every brush, or only `only`, by name) into `out` (brushes/<pack>/fidelity/ by
 * default), replacing what's there.
 */
export async function writeBrushFidelitySheet({ stylesDir, style, pack, out, only }: {
  stylesDir: string; style: string; pack: string; out?: string; only?: readonly string[];
}): Promise<BrushFidelitySheet> {
  const styleDir = join(stylesDir, style), packDir = join(styleDir, 'brushes', pack);
  const manifest = readStampPaintPackDir(packDir), brushes = resolveStampPaintPackBrushes(manifest), targets = readBrushFidelityTargets(packDir, manifest);
  const notes = (await readStyleFidelity(styleDir))[pack] ?? {};
  const names = Object.keys(brushes).filter((name) => !only || only.includes(name));
  const missing = only?.filter((name) => !brushes[name]) ?? [];
  if (missing.length) throw new Error(`brushes sheet: ${pack} has no brush ${missing.map((name) => JSON.stringify(name)).join(', ')}`);

  const dir = out ?? join(packDir, 'fidelity');
  rmSync(join(dir, 'rows'), { recursive: true, force: true });
  mkdirSync(join(dir, 'rows'), { recursive: true });
  const entries = await withBrushFidelityPage(stylesDir, async (call) => {
    const done: BrushFidelitySheetEntry[] = [];
    for (const name of names) {
      const brush = brushes[name], target = targets[name], src = brushFidelityTargetSrc(target, style, pack), label = BRUSH_FIDELITY_TARGET_LABELS[target.kind];
      const measured = src ? await measureBrushFidelityTarget(call, src) : null;
      const { diameter, png, comparison, score } = await scoreBrushFidelity(call, brush, target, measured, true);
      const note = notes[name], grade = score === undefined ? undefined : strokeFidelityGrade(score);
      const lines = [
        `${name}  ·  ${grade ? grade.toUpperCase() : src ? 'NOT MEASURED' : 'NO TARGET'}${note ? `: ${note}` : ''}`,
        `d ${Math.round(diameter)} px · ${describeComparison(comparison, score)}`,
        describeBrush(brush),
      ];
      const row = join(dir, 'rows', `${slugOf(target.kind === 'procreatePreview' ? target.image : undefined, name)}.png`);
      const rowPng = await call<string>('drawStampBrushSheetRow', { target: src && { src, label }, ours: png, lines, grade });
      writeFileSync(row, Buffer.from(rowPng.slice(rowPng.indexOf(',') + 1), 'base64'));
      done.push({ brush: name, row, diameter: Math.round(diameter), target: label, ...(comparison && { comparison }), ...(score !== undefined && { score }), ...(grade && { grade }), ...(note && { note }) });
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
  const total = entries.reduce((sum, e) => sum + (e.score ?? 0), 0);
  const report: BrushFidelityReport & Record<string, unknown> = { style, pack, source: manifest.source, grades: STROKE_SCORE_GRADES, total, entries: entries.map((e) => ({ ...e, row: basename(e.row) })) };
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  let scores: string | undefined;
  if (!out && !only) {
    scores = join(styleDir, STAMP_PAINT_FIDELITY_GRADES);
    const all: StampPaintStyleGrades = existsSync(scores) ? JSON.parse(readFileSync(scores, 'utf8')) : {};
    all[pack] = Object.fromEntries(entries.flatMap((e) => (e.score !== undefined && e.grade ? [[e.brush, { grade: e.grade, score: Math.round(e.score * 1000) / 1000 }]] : [])));
    writeFileSync(scores, `${JSON.stringify(all, null, 2)}\n`);
  }
  return { dir, sheets, entries, scores };
}

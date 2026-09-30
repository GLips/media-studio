// brush-fidelity-sheet.ts: `npm run brushes:sheet`. Each brush of an imported pack is painted on the GPU as its
// Procreate preview or Photoshop reference was and scored against it (brush-fidelity-score.ts); a brush with neither
// is painted unscored. Writes rows, a half-size sheet.jpg and report.json (stamped with source, reading and scorer)
// to brushes/<pack>/fidelity/. A whole pack drawn in place also writes grades to the style's fidelity-grades.json,
// which git keeps, so a painter reads them without drawing the sheet.
//
// The sheet embeds the pack's previews, so it stays under brushes/, which git ignores. An import leaves fidelity/ be,
// so a sheet there shows the brushes as they were when it was drawn.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import type { StampBrush } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { readBrushFidelityBrushes } from '../models/brush-readings.ts';
import { STAMP_PAINT_FIDELITY_GRADES, type StampPaintStyleFidelity, type StampPaintStyleGrades } from '../models/brush-fidelity-style.ts';
import {
  BRUSH_FIDELITY_REPORT_VERSION, brushFidelityOutcomeScore, currentBrushFidelityIdentity, type BrushFidelityOutcome, type BrushFidelityReportEntry,
} from '../models/brush-fidelity-report.ts';
import { BRUSH_FIDELITY_TARGET_LABELS } from '../models/brush-fidelity-target.ts';
import { brushFidelityPackKey } from '../models/brush-fidelity-pack-urls.ts';
import { STROKE_SCORE_GRADES, strokeFidelityGrade, type StrokeFidelityGrade, type StrokeProfileComparison } from '../models/stroke-measure.ts';
import { brushFidelityOutcome, measureBrushFidelityTarget, scoreBrushFidelity, withBrushFidelityPage } from './brush-fidelity-score.ts';
import { brushFidelityTargetSrc, readBrushFidelityPack, readBrushFidelityTargets, writeBrushFidelityReport } from './brush-fidelity-targets.ts';

/** Rows to a sheet image. */
const SHEET_ROWS = 120;

/** `row` is its row's path; the report keeps its file name. */
export type BrushFidelitySheet = { dir: string; sheets: string[]; entries: BrushFidelityReportEntry[]; total: number; scores?: string };

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

function describeOutcome(outcome: BrushFidelityOutcome): string {
  switch (outcome.kind) {
    case 'scored': return describeComparison(outcome.comparison);
    case 'emptyRender': return `paints nothing: score ${outcome.score.toFixed(3)}`;
    case 'unmeasurableTarget': return 'its target has nothing to measure';
    case 'unscored': return 'nothing to measure against';
  }
}

function describeComparison(c: StrokeProfileComparison): string {
  return `score ${c.score.toFixed(3)} · map off ${pct(c.mapError)} · length ×${c.length.toFixed(2)} · peak ×${c.peak.toFixed(2)} · profile off ${pct(c.profileError)} · 80% reached ${pct(c.start.preview)}→${pct(c.start.ours)} in, ${pct(c.end.preview)}→${pct(c.end.ours)} from the end · density ${c.density >= 0 ? '+' : ''}${c.density.toFixed(2)} · rim ${c.rim.preview.toFixed(2)}→${c.rim.ours.toFixed(2)} · grain ${c.grain.preview.toFixed(1)}→${c.grain.ours.toFixed(1)} px · edge ${c.edgeWidth.preview}→${c.edgeWidth.ours} px · mottle ${c.mottle.preview.fine.toFixed(2)}/${c.mottle.preview.coarse.toFixed(2)}→${c.mottle.ours.fine.toFixed(2)}/${c.mottle.ours.coarse.toFixed(2)} · fill ${c.fill.preview.toFixed(2)}→${c.fill.ours.toFixed(2)}`;
}

/**
 * Draws the sheet for `pack` of `style` (every brush, or only `only`, by name) into `out` (brushes/<pack>/fidelity/ by
 * default), replacing what's there.
 */
export async function writeBrushFidelitySheet({ stylesDir, style, pack, out, only }: {
  stylesDir: string; style: string; pack: string; out?: string; only?: readonly string[];
}): Promise<BrushFidelitySheet> {
  const styleDir = join(stylesDir, style), { packDir, manifest, url } = readBrushFidelityPack(stylesDir, style, pack), packUrls = { [brushFidelityPackKey(style, pack)]: url };
  const targets = readBrushFidelityTargets(packDir, manifest), brushes = readBrushFidelityBrushes(manifest, targets);
  const notes = (await readStyleFidelity(styleDir))[pack] ?? {};
  const names = Object.keys(brushes).filter((name) => !only || only.includes(name));
  const missing = only?.filter((name) => !brushes[name]) ?? [];
  if (missing.length) throw new Error(`brushes sheet: ${pack} has no brush ${missing.map((name) => JSON.stringify(name)).join(', ')}`);

  const dir = out ?? join(packDir, 'fidelity');
  rmSync(join(dir, 'rows'), { recursive: true, force: true });
  mkdirSync(join(dir, 'rows'), { recursive: true });
  const entries = await withBrushFidelityPage(stylesDir, async (call) => {
    const done: BrushFidelityReportEntry[] = [];
    for (const name of names) {
      const brush = brushes[name], target = targets[name], src = target.kind === 'none' ? undefined : brushFidelityTargetSrc(target, url), label = BRUSH_FIDELITY_TARGET_LABELS[target.kind];
      const measured = src ? await measureBrushFidelityTarget(call, target, src) : null;
      const scored = await scoreBrushFidelity(call, brush, target, measured, true, packUrls), outcome = brushFidelityOutcome(scored);
      const note = notes[name], grade = gradeOf(outcome);
      const lines = [
        `${name}  ·  ${grade ? grade.toUpperCase() : outcome.kind === 'unmeasurableTarget' ? 'NOT MEASURED' : 'NO TARGET'}${note ? `: ${note}` : ''}`,
        `d ${Math.round(scored.diameter)} px · ${describeOutcome(outcome)}`,
        describeBrush(brush),
      ];
      const row = join(dir, 'rows', `${slugOf(target.kind === 'procreatePreview' ? target.image : undefined, name)}.png`);
      const rowPng = await call<string>('drawStampBrushSheetRow', { target: src && { src, label }, ours: scored.png, lines, grade });
      writeFileSync(row, Buffer.from(rowPng.slice(rowPng.indexOf(',') + 1), 'base64'));
      done.push({ brush: name, row, diameter: Math.round(scored.diameter), target: label, ...(note && { note }), outcome });
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
  const total = entries.reduce((sum, e) => sum + (brushFidelityOutcomeScore(e.outcome) ?? 0), 0);
  writeBrushFidelityReport(join(dir, 'report.json'), {
    version: BRUSH_FIDELITY_REPORT_VERSION, style, pack, identity: currentBrushFidelityIdentity(manifest), grades: STROKE_SCORE_GRADES, total,
    entries: entries.map((e) => ({ ...e, row: basename(e.row) })),
  });
  let scores: string | undefined;
  if (!out && !only) {
    scores = join(styleDir, STAMP_PAINT_FIDELITY_GRADES);
    const all: StampPaintStyleGrades = existsSync(scores) ? JSON.parse(readFileSync(scores, 'utf8')) : {};
    all[pack] = Object.fromEntries(entries.flatMap((e) => {
      const score = brushFidelityOutcomeScore(e.outcome);
      return score === undefined ? [] : [[e.brush, { grade: strokeFidelityGrade(score), score: Math.round(score * 1000) / 1000 }]];
    }));
    writeFileSync(scores, `${JSON.stringify(all, null, 2)}\n`);
  }
  return { dir, sheets, entries, total, scores };
}

const gradeOf = (outcome: BrushFidelityOutcome): StrokeFidelityGrade | undefined => {
  const score = brushFidelityOutcomeScore(outcome);
  return score === undefined ? undefined : strokeFidelityGrade(score);
};

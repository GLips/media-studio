// stamp-brush-fit.ts: `studio brushes fit`. Fits the importer's ProcreateReading (models/procreate-brush.ts), the
// constants shared by every Procreate brush, against every brush of the packs it's given at once: each candidate
// reading reads each brush's own settings again (the pack's procreate-sources.json), paints it as the brush fidelity
// sheet does, and sums the sheet's scores (models/procreate-reading-fit.ts searches). It writes the fitted reading
// into models/procreate-reading.ts, which the importer reads; re-import the packs to carry it into their manifests.
//
// Each brush keeps the diameter the sheet fits it at under the starting reading, so a score moves only with how the
// brush paints. A brush that reads the same under two readings is painted once: most constants touch a few brushes.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeProcreateBrush, type ProcreateReading } from '../models/procreate-brush.ts';
import { compareStrokeProfiles, type StrokeCoverageProfile } from '../models/procreate-preview-stroke.ts';
import { PROCREATE_READING } from '../models/procreate-reading.ts';
import { fitProcreateReading, type ProcreateReadingFitStep } from '../models/procreate-reading-fit.ts';
import { STAMP_PAINT_PACK_MANIFEST, type StampPaintPackManifest } from '../models/style.ts';
import { PROCREATE_SOURCES, type ProcreatePackSources } from './import-procreate-pack.ts';
import { packFile, paintAtPreviewThickness, withStampBrushSheetPage, type StampBrushSheetEntry } from './stamp-brush-sheet.ts';

const READING_FILE = fileURLToPath(new URL('../models/procreate-reading.ts', import.meta.url));

/** What a brush that paints nothing scores: as far off as the worst brushes the sheet has seen. */
const NOTHING_PAINTED = 2;

/**
 * What each point a brush loses against its baseline costs the fit, beyond the loss itself: a shared constant that
 * makes some brushes closer by making another further off has to win by this much more. The baseline is its score on
 * the pack's last drawn sheet (fidelity/report.json), so a change to the model can't quietly give back what the sheet
 * showed; a brush the sheet hasn't scored is held to its score under the starting reading.
 */
const REGRESSION_WEIGHT = 3;

export type StampBrushFitPack = { style: string; pack: string };

export type StampBrushFitResult = {
  before: ProcreateReading;
  after: ProcreateReading;
  total: { before: number; after: number };
  brushes: { pack: string; brush: string; before: number; after: number }[];
  steps: ProcreateReadingFitStep[];
  /** The file the fitted reading was written to, when asked to write it. */
  written?: string;
};

/** procreate-reading.ts's text for `reading`. */
function readingModule(reading: ProcreateReading, packs: readonly StampBrushFitPack[]): string {
  const lines = Object.entries(reading).map(([key, value]) => `  ${key}: ${value},`);
  return `// procreate-reading.ts: the fitted ProcreateReading (procreate-brush.ts), written by \`studio brushes fit\`
// (lib/picture/stamp-paint/engine/stamp-brush-fit.ts) against ${packs.map(({ style, pack }) => `${style}/${pack}`).join(', ')}. Edit by fitting again, not by hand:
// each value was chosen with the others, against every brush the fit was given.
import type { ProcreateReading } from './procreate-brush.ts';

export const PROCREATE_READING: ProcreateReading = {
${lines.join('\n')}
};
`;
}

/**
 * Fits the reading against every previewed brush of `packs`, starting from the checked-in one, searching only `keys`
 * when given. Writes it into procreate-reading.ts when `write`. `log` hears each step.
 */
export async function fitStampBrushReading({ stylesDir, packs, keys, write, log }: {
  stylesDir: string; packs: readonly StampBrushFitPack[]; keys?: readonly (keyof ProcreateReading)[]; write: boolean; log: (line: string) => void;
}): Promise<StampBrushFitResult> {
  const brushes = packs.flatMap(({ style, pack }) => {
    const dir = join(stylesDir, style, 'brushes', pack);
    const sourcesFile = join(dir, PROCREATE_SOURCES);
    if (!existsSync(sourcesFile)) throw new Error(`brushes fit: ${style}/${pack} has no ${PROCREATE_SOURCES}; import it again with studio brushes import`);
    const manifest = JSON.parse(readFileSync(join(dir, STAMP_PAINT_PACK_MANIFEST), 'utf8')) as StampPaintPackManifest;
    const sources = JSON.parse(readFileSync(sourcesFile, 'utf8')) as ProcreatePackSources;
    const reportFile = join(dir, 'fidelity', 'report.json');
    const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) as { entries: StampBrushSheetEntry[] } : null;
    const sheetScores: Record<string, number | undefined> = Object.fromEntries((report?.entries ?? []).map((e) => [e.brush, e.comparison?.score]));
    return Object.entries(sources).flatMap(([name, source]) => {
      const preview = manifest.previews[name];
      return preview ? [{ style, pack, name, source, preview: packFile(style, pack, preview.image), shows: preview.shows, sheet: sheetScores[name] }] : [];
    });
  });

  return withStampBrushSheetPage(stylesDir, async (call) => {
    const read = (b: (typeof brushes)[number], reading: ProcreateReading) => normalizeProcreateBrush(b.name, b.source.main, b.source.dual, reading).brush;
    const previews = new Map<string, StrokeCoverageProfile | null>();
    const diameters = new Map<string, number>();
    for (const b of brushes) {
      const preview = await call<StrokeCoverageProfile | null>('measureProcreatePreview', b.preview);
      previews.set(b.preview, preview);
      diameters.set(b.preview, (await paintAtPreviewThickness(call, read(b, PROCREATE_READING), b.shows, preview, false)).diameter);
    }
    const scored = new Map<string, number>();
    const scoreBrush = async (b: (typeof brushes)[number], reading: ProcreateReading) => {
      const brush = read(b, reading), diameter = diameters.get(b.preview)!, preview = previews.get(b.preview);
      if (!preview) return 0;
      const key = `${JSON.stringify(brush)}@${diameter}`;
      if (!scored.has(key)) {
        const { profile } = await call<{ profile: StrokeCoverageProfile | null }>('paintOnProcreatePreviewStroke', brush, diameter, b.shows, false);
        scored.set(key, profile ? compareStrokeProfiles(preview, profile).score : NOTHING_PAINTED);
      }
      return scored.get(key)!;
    };
    const scoresOf = async (reading: ProcreateReading) => {
      const each: number[] = [];
      for (const b of brushes) each.push(await scoreBrush(b, reading));
      return each;
    };
    const before = await scoresOf(PROCREATE_READING);
    const baseline = brushes.map((b, i) => b.sheet ?? before[i]);
    const total = async (reading: ProcreateReading) => (await scoresOf(reading))
      .reduce((sum, score, i) => sum + score + REGRESSION_WEIGHT * Math.max(0, score - baseline[i]), 0);

    log(`brushes fit: ${brushes.length} brushes from ${packs.map(({ style, pack }) => `${style}/${pack}`).join(', ')}, total ${before.reduce((a, b) => a + b, 0).toFixed(3)}`);
    const fit = await fitProcreateReading(PROCREATE_READING, total, {
      ...(keys && { keys }),
      onStep: ({ key, from, to, total: t }) => log(`brushes fit: ${key} ${from} → ${to}, scored ${t.toFixed(3)} with losses weighed`),
    });
    const after = await scoresOf(fit.reading);
    let written: string | undefined;
    if (write) {
      writeFileSync(READING_FILE, readingModule(fit.reading, packs));
      written = READING_FILE;
    }
    return {
      before: PROCREATE_READING, after: fit.reading,
      total: { before: before.reduce((a, b) => a + b, 0), after: after.reduce((a, b) => a + b, 0) },
      brushes: brushes.map((b, i) => ({ pack: `${b.style}/${b.pack}`, brush: b.name, before: before[i], after: after[i] })),
      steps: fit.steps,
      ...(written && { written }),
    };
  });
}

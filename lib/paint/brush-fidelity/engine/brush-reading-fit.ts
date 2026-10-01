// brush-reading-fit.ts: `npm run brushes:fit`. Fits an app's reading (brush-readings.ts), the constants its importer
// reads every brush by, against every targeted training brush of the packs it's given at once: each candidate reading
// reads each brush's own source again (the pack's manifest), scores it as the brush fidelity sheet does, and sums the
// scores (brush-reading-search.ts searches). It writes the fitted reading into the app's reading module, which every
// style reads its brushes by when it resolves them.
//
// A brush that reads the same under two readings is scored once: most constants touch a few brushes.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BrowserModuleCall } from '#lib/platform/browser/engine/browser-module-page.ts';
import type { StampPaintPack } from '#lib/paint/brush-packs/models/stamp-paint-pack.ts';
import { BRUSH_READINGS, type BrushReadingApp } from '../models/brush-readings.ts';
import { searchBrushReading, type BrushReading, type BrushReadingFitStep } from '../models/brush-reading-search.ts';
import { withBrushFidelityPage } from './brush-fidelity-score.ts';
import { readBrushFidelityBaselines } from './brush-fidelity-targets.ts';
import {
  brushReadingKeys, brushReadingScorer, readBrushReadingSubjects, type BrushFidelityPackId, type BrushReadingSubject,
} from './brush-reading-subjects.ts';

/** Each app's reading module, which a fit rewrites. */
const READING_FILES: Record<StampPaintPack['app'], string> = {
  procreate: fileURLToPath(new URL('../../procreate-brushes/models/procreate-reading.ts', import.meta.url)),
  photoshop: fileURLToPath(new URL('../../photoshop-brushes/models/photoshop-reading.ts', import.meta.url)),
};

/**
 * What each point a brush loses against its baseline costs the fit beyond the loss itself, so a constant that helps
 * some brushes by hurting another must win by this much more. The baseline is the pack's last whole sheet
 * (readBrushFidelityBaselines), so a change to the model can't quietly give back what the sheet showed.
 */
const REGRESSION_WEIGHT = 3;

export type BrushReadingFitResult = {
  before: BrushReading;
  after: BrushReading;
  total: { before: number; after: number };
  brushes: { pack: string; brush: string; before: number; after: number }[];
  steps: BrushReadingFitStep[];
  /** The file the fitted reading was written to, when asked to write it. */
  written?: string;
};

/**
 * Fits the app's reading against every targeted training brush of `packs`, starting from the checked-in one,
 * searching only `keys` when given (else each constant some brush uses). Writes the reading module when `write`.
 */
export async function fitBrushReading({ stylesDir, packs, keys, write, log }: {
  stylesDir: string; packs: readonly BrushFidelityPackId[]; keys?: readonly string[]; write: boolean; log: (line: string) => void;
}): Promise<BrushReadingFitResult> {
  const against = packs.map(({ style, pack }) => `${style}/${pack}`).join(', ');
  // Read before the page opens, so a stale sheet is refused before any painting.
  const baselines = new Map(packs.map(({ style, pack }) => [`${style}/${pack}`, readBrushFidelityBaselines(stylesDir, style, pack)]));
  return withBrushFidelityPage(stylesDir, async (call) => {
    const read = await readBrushReadingSubjects(call, stylesDir, packs), options = { against, baselines, keys, write, log };
    return read.app === 'procreate'
      ? fitSubjects(call, READING_FILES.procreate, BRUSH_READINGS.procreate, read.subjects, options)
      : fitSubjects(call, READING_FILES.photoshop, BRUSH_READINGS.photoshop, read.subjects, options);
  });
}

async function fitSubjects<R extends BrushReading, Source>(
  call: BrowserModuleCall, file: string, reading: BrushReadingApp<R, Source>, subjects: readonly BrushReadingSubject<Source>[],
  { against, baselines, keys, write, log }: {
    against: string; baselines: ReadonlyMap<string, ReadonlyMap<string, number>>; keys?: readonly string[]; write: boolean; log: (line: string) => void;
  },
): Promise<BrushReadingFitResult> {
  const training = subjects.filter((s) => !s.heldOut), score = brushReadingScorer(call, reading);
  const scoresOf = async (candidate: R) => {
    const each: number[] = [];
    for (const s of training) each.push(await score(s, candidate));
    return each;
  };
  // readBrushFidelityBaselines holds every targeted brush of its pack, and every subject is one.
  const baseline = training.map((s) => baselines.get(`${s.style}/${s.pack}`)!.get(s.name)!);
  const before = await scoresOf(reading.reading);
  const total = async (candidate: R) => (await scoresOf(candidate)).reduce((sum, s, i) => sum + s + REGRESSION_WEIGHT * Math.max(0, s - baseline[i]), 0);
  const searched = brushReadingKeys('fit', reading, training, keys);

  log(`brushes fit: ${training.length} brushes from ${against} (${subjects.length - training.length} held out), searching ${searched.join(', ')}, total ${before.reduce((a, b) => a + b, 0).toFixed(3)}`);
  const fit = await searchBrushReading(reading.reading, reading.ranges, total, {
    keys: searched,
    onStep: ({ key, from, to, total: t }) => log(`brushes fit: ${key} ${from} → ${to}, scored ${t.toFixed(3)} with losses weighed`),
  });
  const after = await scoresOf(fit.reading);
  if (write) writeFileSync(file, reading.module(fit.reading, against));
  return {
    before: reading.reading, after: fit.reading,
    total: { before: before.reduce((a, b) => a + b, 0), after: after.reduce((a, b) => a + b, 0) },
    brushes: training.map((s, i) => ({ pack: `${s.style}/${s.pack}`, brush: s.name, before: before[i], after: after[i] })),
    steps: fit.steps,
    ...(write && { written: file }),
  };
}

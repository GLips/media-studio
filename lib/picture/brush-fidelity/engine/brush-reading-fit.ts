// brush-reading-fit.ts: `npm run brushes:fit`. Fits an app's reading (brush-readings.ts), the constants its importer
// reads every brush by, against every targeted training brush of the packs it's given at once: each candidate reading
// reads each brush's own source again (the pack's manifest), scores it as the brush fidelity sheet does, and sums the
// scores (brush-reading-search.ts searches). It writes the fitted reading into the app's reading module, which every
// style reads its brushes by when it resolves them.
//
// A brush that reads the same under two readings is scored once: most constants touch a few brushes.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BrowserModuleCall } from '#lib/output/render/engine/browser-module-page.ts';
import type { PhotoshopPackBrush, ProcreatePackBrush, StampPaintPack } from '#lib/picture/stamp-styles/models/stamp-paint-pack.ts';
import type { BrushFidelityTarget } from '../models/brush-fidelity-target.ts';
import { BRUSH_READINGS, type BrushReadingApp } from '../models/brush-readings.ts';
import { searchBrushReading, type BrushReading, type BrushReadingFitStep } from '../models/brush-reading-search.ts';
import type { StrokeCoverageProfile } from '../models/stroke-measure.ts';
import { measureBrushFidelityTarget, scoreBrushFidelity, withBrushFidelityPage } from './brush-fidelity-score.ts';
import { brushFidelityTargetSrc, readBrushFidelityPacks } from './brush-fidelity-targets.ts';

/** Each app's reading module, which a fit rewrites. */
const READING_FILES: Record<StampPaintPack['app'], string> = {
  procreate: fileURLToPath(new URL('../../procreate-brushes/models/procreate-reading.ts', import.meta.url)),
  photoshop: fileURLToPath(new URL('../../photoshop-brushes/models/photoshop-reading.ts', import.meta.url)),
};

/**
 * What each point a brush loses against its baseline costs the fit, beyond the loss itself: a shared constant that
 * makes some brushes closer by making another further off has to win by this much more. The baseline is its score on
 * the pack's last drawn sheet (fidelity/report.json), so a change to the model can't quietly give back what the sheet
 * showed; a brush the sheet hasn't scored is held to its score under the starting reading.
 */
const REGRESSION_WEIGHT = 3;

export type BrushFidelityPackId = { style: string; pack: string };

/** A targeted brush of the packs, with its source as its app reads it and its target's measure. */
export type BrushReadingSubject<Source> = {
  style: string; pack: string; name: string; source: Source; target: BrushFidelityTarget; measured: StrokeCoverageProfile | null; sheetScore?: number; heldOut: boolean;
};

/** Every targeted brush of `packs`, measured on `call`'s page, as their shared app reads them. */
export async function readBrushReadingSubjects(call: BrowserModuleCall, stylesDir: string, packs: readonly BrushFidelityPackId[]): Promise<
  | { app: 'procreate'; subjects: BrushReadingSubject<ProcreatePackBrush>[] }
  | { app: 'photoshop'; subjects: BrushReadingSubject<PhotoshopPackBrush>[] }
> {
  const { app, packs: read } = readBrushFidelityPacks(stylesDir, packs);
  const subjects: BrushReadingSubject<ProcreatePackBrush | PhotoshopPackBrush>[] = [];
  for (const { manifest, brushes } of read) {
    for (const { style, pack, name, target, sheetScore } of brushes) {
      const measured = await measureBrushFidelityTarget(call, brushFidelityTargetSrc(target, style, pack)!);
      subjects.push({ style, pack, name, source: manifest.brushes[name], target, measured, sheetScore, heldOut: BRUSH_READINGS[app].heldOut(pack, name) });
    }
  }
  // readBrushFidelityPacks holds every pack to one app, so each source is that app's.
  return app === 'procreate' ? { app, subjects: subjects as BrushReadingSubject<ProcreatePackBrush>[] } : { app, subjects: subjects as BrushReadingSubject<PhotoshopPackBrush>[] };
}

/** Scores a subject under a candidate reading; a brush that reads alike under two readings is painted once. */
export function brushReadingScorer<R extends BrushReading, Source>(call: BrowserModuleCall, reading: BrushReadingApp<R, Source>) {
  const scored = new Map<string, number>();
  return async (subject: BrushReadingSubject<Source>, candidate: R): Promise<number> => {
    if (!subject.measured) return 0;
    const brush = reading.read(subject.name, subject.source, candidate), key = `${subject.pack}|${subject.name}|${JSON.stringify(brush)}`;
    if (!scored.has(key)) scored.set(key, (await scoreBrushFidelity(call, brush, subject.target, subject.measured, false)).score!);
    return scored.get(key)!;
  };
}

/** Which of `reading`'s constants to search: `keys`, each checked, or else each one some subject uses. */
export function brushReadingKeys<R extends BrushReading, Source>(verb: string, reading: BrushReadingApp<R, Source>, subjects: readonly BrushReadingSubject<Source>[], keys?: readonly string[]): (keyof R & string)[] {
  const all = Object.keys(reading.ranges) as (keyof R & string)[];
  const unknown = keys?.filter((key) => !all.includes(key as keyof R & string)) ?? [];
  if (unknown.length) throw new Error(`brushes ${verb}: the reading has no ${unknown.join(', ')}; it has ${all.join(', ')}`);
  return keys ? (keys as (keyof R & string)[]) : all.filter((key) => subjects.some((s) => reading.uses(key, s.source)));
}

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
  return withBrushFidelityPage(stylesDir, async (call) => {
    const read = await readBrushReadingSubjects(call, stylesDir, packs);
    return read.app === 'procreate'
      ? fitSubjects(call, READING_FILES.procreate, BRUSH_READINGS.procreate, read.subjects, { against, keys, write, log })
      : fitSubjects(call, READING_FILES.photoshop, BRUSH_READINGS.photoshop, read.subjects, { against, keys, write, log });
  });
}

async function fitSubjects<R extends BrushReading, Source>(
  call: BrowserModuleCall, file: string, reading: BrushReadingApp<R, Source>, subjects: readonly BrushReadingSubject<Source>[],
  { against, keys, write, log }: { against: string; keys?: readonly string[]; write: boolean; log: (line: string) => void },
): Promise<BrushReadingFitResult> {
  const training = subjects.filter((s) => !s.heldOut), score = brushReadingScorer(call, reading);
  const scoresOf = async (candidate: R) => {
    const each: number[] = [];
    for (const s of training) each.push(await score(s, candidate));
    return each;
  };
  const before = await scoresOf(reading.reading);
  const baseline = training.map((s, i) => s.sheetScore ?? before[i]);
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

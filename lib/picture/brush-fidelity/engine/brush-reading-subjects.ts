// brush-reading-subjects.ts: the brushes an app's reading is judged on, for the fit (brush-reading-fit.ts) and the
// diagnostic (brush-reading-diagnostic.ts) alike: every targeted brush of the packs given, its target measured once,
// each scored under a candidate reading as the brush fidelity sheet scores it.

import type { BrowserModuleCall } from '#lib/output/render/engine/browser-module-page.ts';
import type { PhotoshopPackBrush, ProcreatePackBrush } from '#lib/picture/stamp-styles/models/stamp-paint-pack.ts';
import { BRUSH_READINGS, type BrushReadingApp } from '../models/brush-readings.ts';
import type { BrushReading } from '../models/brush-reading-search.ts';
import { brushFidelityPackKey } from '../models/brush-fidelity-pack-urls.ts';
import type { StrokeCoverageProfile } from '../models/stroke-measure.ts';
import { measureBrushFidelityTarget, scoreBrushFidelity } from './brush-fidelity-score.ts';
import { brushFidelityTargetSrc, readBrushFidelityPacks, type BrushFidelityTargetedBrush } from './brush-fidelity-targets.ts';

export type BrushFidelityPackId = { style: string; pack: string };

/** A targeted brush of the packs, with its source as its app reads it and its target's measure. */
export type BrushReadingSubject<Source> = BrushFidelityTargetedBrush<Source> & { measured: StrokeCoverageProfile | null; heldOut: boolean };

async function measureBrushReadingSubjects<R extends BrushReading, Source>(
  call: BrowserModuleCall, brushes: readonly BrushFidelityTargetedBrush<Source>[], reading: BrushReadingApp<R, Source>,
): Promise<BrushReadingSubject<Source>[]> {
  const subjects: BrushReadingSubject<Source>[] = [];
  for (const brush of brushes) {
    const measured = await measureBrushFidelityTarget(call, brushFidelityTargetSrc(brush.target, brush.packUrl));
    subjects.push({ ...brush, measured, heldOut: reading.heldOut(brush.pack, brush.name) });
  }
  return subjects;
}

/** Every targeted brush of `packs`, measured on `call`'s page, as their shared app reads them. */
export async function readBrushReadingSubjects(call: BrowserModuleCall, stylesDir: string, packs: readonly BrushFidelityPackId[]): Promise<
  | { app: 'procreate'; subjects: BrushReadingSubject<ProcreatePackBrush>[] }
  | { app: 'photoshop'; subjects: BrushReadingSubject<PhotoshopPackBrush>[] }
> {
  const read = readBrushFidelityPacks(stylesDir, packs);
  return read.app === 'procreate'
    ? { app: read.app, subjects: await measureBrushReadingSubjects(call, read.brushes, BRUSH_READINGS.procreate) }
    : { app: read.app, subjects: await measureBrushReadingSubjects(call, read.brushes, BRUSH_READINGS.photoshop) };
}

/** Scores a subject under a candidate reading; a brush that reads alike under two readings is painted once. */
export function brushReadingScorer<R extends BrushReading, Source>(call: BrowserModuleCall, reading: BrushReadingApp<R, Source>) {
  const scored = new Map<string, number>();
  return async (subject: BrushReadingSubject<Source>, candidate: R): Promise<number> => {
    if (!subject.measured) return 0;
    const brush = reading.read(subject.name, subject.source, candidate), key = `${subject.pack}|${subject.name}|${JSON.stringify(brush)}`;
    const known = scored.get(key);
    if (known !== undefined) return known;
    const result = await scoreBrushFidelity(call, brush, subject.target, subject.measured, false, { [brushFidelityPackKey(subject.style, subject.pack)]: subject.packUrl });
    switch (result.kind) {
      case 'scored': case 'emptyRender': scored.set(key, result.score); return result.score;
      // A subject's target is measured (checked above), so neither can come back.
      case 'unmeasurableTarget': case 'unscored': throw new Error(`brushes: ${subject.pack} ${subject.name}'s target was measured, yet it scored as ${result.kind}`);
    }
  };
}

/** Which of `reading`'s constants to search: `keys`, each checked, or else each one some subject uses. */
export function brushReadingKeys<R extends BrushReading, Source>(verb: string, reading: BrushReadingApp<R, Source>, subjects: readonly BrushReadingSubject<Source>[], keys?: readonly string[]): (keyof R & string)[] {
  const all = Object.keys(reading.ranges).filter((key): key is keyof R & string => Object.hasOwn(reading.ranges, key));
  if (!keys) return all.filter((key) => subjects.some((s) => reading.uses(key, s.source)));
  const unknown = keys.filter((key) => !all.some((known) => known === key));
  if (unknown.length) throw new Error(`brushes ${verb}: the reading has no ${unknown.join(', ')}; it has ${all.join(', ')}`);
  return keys.flatMap((key) => all.filter((known) => known === key));
}

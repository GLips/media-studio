// brush-reading-diagnostic.ts: `npm run brushes:diagnose`, vid-97's per-brush diagnostic of an app's reading
// (brush-reading-spread.ts says what it reads). Each targeted brush that uses a constant's mechanism is read again from
// its pack's manifest at each candidate value, scored as the brush fidelity sheet scores it, and its best candidate is
// where it lands. It also sums the training brushes under each candidate, the shared fit the spread would justify, and
// the held-out brushes under each. It writes nothing: a constant moves by `npm run brushes:fit`, or by hand, on what
// this shows.

import type { BrowserModuleCall } from '#lib/output/render/engine/browser-module-page.ts';
import { BRUSH_READINGS, type BrushReadingApp } from '../models/brush-readings.ts';
import { BRUSH_READING_INSENSITIVE, BRUSH_READING_MULTIPLES, brushReadingSpread, type BrushReadingSpread } from '../models/brush-reading-spread.ts';
import type { BrushReading } from '../models/brush-reading-search.ts';
import { withBrushFidelityPage } from './brush-fidelity-score.ts';
import { brushReadingKeys, brushReadingScorer, readBrushReadingSubjects, type BrushFidelityPackId, type BrushReadingSubject } from './brush-reading-fit.ts';

export type BrushReadingBrushDiagnosis = { pack: string; brush: string; heldOut: boolean; scores: number[]; best: number; sensitive: boolean };

export type BrushReadingDiagnosis = {
  key: string;
  values: number[];
  brushes: BrushReadingBrushDiagnosis[];
  /** From the training brushes that tell the candidates apart. */
  spread: BrushReadingSpread;
  /** Summed over the training brushes, by candidate; and over the held-out ones. */
  training: number[];
  heldOut: number[];
};

/** Diagnoses `keys` of the packs' app's reading, or each constant some brush uses. */
export async function diagnoseBrushReading({ stylesDir, packs, keys, log }: {
  stylesDir: string; packs: readonly BrushFidelityPackId[]; keys?: readonly string[]; log?: (line: string) => void;
}): Promise<BrushReadingDiagnosis[]> {
  return withBrushFidelityPage(stylesDir, async (call) => {
    const read = await readBrushReadingSubjects(call, stylesDir, packs);
    return read.app === 'procreate'
      ? diagnoseSubjects(call, BRUSH_READINGS.procreate, read.subjects, keys, log)
      : diagnoseSubjects(call, BRUSH_READINGS.photoshop, read.subjects, keys, log);
  });
}

async function diagnoseSubjects<R extends BrushReading, Source>(
  call: BrowserModuleCall, reading: BrushReadingApp<R, Source>, subjects: readonly BrushReadingSubject<Source>[], keys: readonly string[] | undefined, log?: (line: string) => void,
): Promise<BrushReadingDiagnosis[]> {
  const score = brushReadingScorer(call, reading), measured = subjects.filter((s) => s.measured);
  const diagnoses: BrushReadingDiagnosis[] = [];
  for (const key of brushReadingKeys('diagnose', reading, measured, keys)) {
    const values = BRUSH_READING_MULTIPLES.map((times) => reading.reading[key] * times);
    const using = measured.filter((s) => reading.uses(key, s.source));
    log?.(`brushes diagnose: ${key}, ${using.length} brushes use it (${using.filter((s) => s.heldOut).length} held out), candidates ${values.map((v) => +v.toFixed(4)).join(', ')}`);
    const diagnosed: BrushReadingBrushDiagnosis[] = [];
    for (const subject of using) {
      const scores: number[] = [];
      for (const value of values) scores.push(await score(subject, { ...reading.reading, [key]: value }));
      const best = scores.indexOf(Math.min(...scores));
      diagnosed.push({ pack: subject.pack, brush: subject.name, heldOut: subject.heldOut, scores, best, sensitive: Math.max(...scores) - Math.min(...scores) >= BRUSH_READING_INSENSITIVE });
    }
    const sum = (list: BrushReadingBrushDiagnosis[]) => values.map((_, i) => list.reduce((total, b) => total + b.scores[i], 0));
    const training = diagnosed.filter((b) => !b.heldOut);
    diagnoses.push({
      key, values, brushes: diagnosed,
      spread: brushReadingSpread(training.filter((b) => b.sensitive).map((b) => b.best)),
      training: sum(training), heldOut: sum(diagnosed.filter((b) => b.heldOut)),
    });
  }
  return diagnoses;
}

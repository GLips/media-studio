// photoshop-reading-diagnostic.ts: `npm run brushes:diagnose`, vid-97's per-brush diagnostic of the PhotoshopReading
// (models/photoshop-reading-spread.ts says what it reads). Each brush that uses a constant's mechanism is read again
// from its pack's photoshop-sources.json at each candidate value, painted as the brush fidelity sheet paints it
// against its Photoshop reference, and scored; its best candidate is where it lands. It also sums the training brushes
// under each candidate, the shared fit the spread would justify, and the held-out brushes under the current value and
// that one. It writes nothing: a constant moves in photoshop-reading.ts by hand, on what this shows.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePhotoshopBrush, type PhotoshopReading } from '../models/photoshop-brush.ts';
import { PHOTOSHOP_READING } from '../models/photoshop-reading.ts';
import {
  PHOTOSHOP_READING_INSENSITIVE, PHOTOSHOP_READING_MULTIPLES, photoshopBrushHeldOut, photoshopReadingSpread, photoshopReadingUses, type PhotoshopReadingSpread,
} from '../models/photoshop-reading-spread.ts';
import { compareStrokeProfiles, type StrokeCoverageProfile } from '../models/procreate-preview-stroke.ts';
import type { PhotoshopPackSources } from './import-photoshop-pack.ts';
import { photoshopReferenceStrokePng, readPhotoshopReferenceStrokes } from './photoshop-reference-target.ts';
import { withStampBrushSheetPage } from './stamp-brush-sheet.ts';
import { PHOTOSHOP_SOURCES } from './stamp-paint-pack-files.ts';

/** What a brush that paints nothing scores, as the Procreate fit counts it. */
const NOTHING_PAINTED = 2;

export type PhotoshopReadingBrushDiagnosis = { pack: string; brush: string; heldOut: boolean; scores: number[]; best: number; sensitive: boolean };

export type PhotoshopReadingDiagnosis = {
  key: keyof PhotoshopReading;
  values: number[];
  brushes: PhotoshopReadingBrushDiagnosis[];
  /** From the training brushes that tell the candidates apart. */
  spread: PhotoshopReadingSpread;
  /** Summed over the training brushes, by candidate; and over the held-out ones. */
  training: number[];
  heldOut: number[];
};

export async function diagnosePhotoshopReading({ stylesDir, packs, keys, log }: {
  stylesDir: string; packs: readonly { style: string; pack: string }[]; keys: readonly (keyof PhotoshopReading)[]; log?: (line: string) => void;
}): Promise<PhotoshopReadingDiagnosis[]> {
  const brushes = packs.flatMap(({ style, pack }) => {
    const dir = join(stylesDir, style, 'brushes', pack);
    const sources = JSON.parse(readFileSync(join(dir, PHOTOSHOP_SOURCES), 'utf8')) as PhotoshopPackSources;
    const references = readPhotoshopReferenceStrokes(dir);
    return Object.entries(sources).flatMap(([name, source]) => {
      const reference = references.get(name);
      return reference ? [{ pack, name, source, reference, heldOut: photoshopBrushHeldOut(pack, name) }] : [];
    });
  });
  return withStampBrushSheetPage(stylesDir, async (call) => {
    const targets = new Map<string, StrokeCoverageProfile | null>();
    const diagnoses: PhotoshopReadingDiagnosis[] = [];
    for (const key of keys) {
      const values = PHOTOSHOP_READING_MULTIPLES.map((times) => PHOTOSHOP_READING[key] * times);
      const using = brushes.filter((b) => photoshopReadingUses(key, b.source.preset));
      log?.(`brushes diagnose: ${key}, ${using.length} brushes use it (${using.filter((b) => b.heldOut).length} held out), candidates ${values.map((v) => +v.toFixed(4)).join(', ')}`);
      const diagnosed: PhotoshopReadingBrushDiagnosis[] = [];
      for (const { pack, name, source, reference, heldOut } of using) {
        const id = `${pack}|${name}`;
        if (!targets.has(id)) targets.set(id, await call<StrokeCoverageProfile | null>('measureStrokeTarget', photoshopReferenceStrokePng(reference)));
        const target = targets.get(id);
        if (!target) continue;
        const scores: number[] = [];
        for (const value of values) {
          const { brush } = normalizePhotoshopBrush(name, source, { ...PHOTOSHOP_READING, [key]: value });
          const { profile } = await call<{ profile: StrokeCoverageProfile | null }>('paintOnPhotoshopReferenceStroke', brush, reference.diameter, reference.poseOverrides, false);
          scores.push(profile ? compareStrokeProfiles(target, profile).score : NOTHING_PAINTED);
        }
        const best = scores.indexOf(Math.min(...scores));
        diagnosed.push({ pack, brush: name, heldOut, scores, best, sensitive: Math.max(...scores) - Math.min(...scores) >= PHOTOSHOP_READING_INSENSITIVE });
      }
      const sum = (list: PhotoshopReadingBrushDiagnosis[]) => values.map((_, i) => list.reduce((total, b) => total + b.scores[i], 0));
      const training = diagnosed.filter((b) => !b.heldOut);
      diagnoses.push({
        key, values, brushes: diagnosed,
        spread: photoshopReadingSpread(training.filter((b) => b.sensitive).map((b) => b.best)),
        training: sum(training), heldOut: sum(diagnosed.filter((b) => b.heldOut)),
      });
    }
    return diagnoses;
  });
}

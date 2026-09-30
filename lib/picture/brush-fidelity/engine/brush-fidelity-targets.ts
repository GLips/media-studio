// brush-fidelity-targets.ts: each brush of an imported pack with what it's measured against (brush-fidelity-target.ts):
// its Procreate preview, else its Photoshop reference capture, else nothing at its source's own size.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stampPaintPackDiameter, type StampPaintPack } from '#lib/picture/stamp-styles/models/stamp-paint-pack.ts';
import { readStampPaintPackDir } from '#lib/picture/stamp-styles/engine/stamp-paint-pack-files.ts';
import { untargetedBrushFidelity, type BrushFidelityTarget } from '../models/brush-fidelity-target.ts';
import { photoshopReferenceStrokePng, readPhotoshopReferenceStrokes } from './photoshop-reference-target.ts';

/** Each brush of `manifest` (in `packDir`) by name, with its target. */
export function readBrushFidelityTargets(packDir: string, manifest: StampPaintPack): Record<string, BrushFidelityTarget> {
  const references = readPhotoshopReferenceStrokes(packDir);
  return Object.fromEntries(Object.keys(manifest.brushes).map((name): [string, BrushFidelityTarget] => {
    const preview = manifest.previews[name], reference = references.get(name);
    return [name, preview ? { kind: 'procreatePreview', image: preview.image, shows: preview.shows }
      : reference ? { kind: 'photoshopReference', stroke: reference }
      : untargetedBrushFidelity(stampPaintPackDiameter(manifest, name))];
  }));
}

/** A pack's file as the fidelity page loads it: its URL under the styles folder, served at /files/. */
export const brushFidelityPackFile = (style: string, pack: string, file: string) => `/files/${style}/brushes/${pack}/${file}`;

/** The image the fidelity page measures `target` from: a preview's URL, or a reference cropped to a data URL. */
export function brushFidelityTargetSrc(target: BrushFidelityTarget, style: string, pack: string): string | undefined {
  switch (target.kind) {
    case 'procreatePreview': return brushFidelityPackFile(style, pack, target.image);
    case 'photoshopReference': return photoshopReferenceStrokePng(target.stroke);
    case 'none': return undefined;
  }
}

/** A sheet's report.json, as the fitter reads its baselines and the guard its scores. */
export type BrushFidelityReport = { total: number; entries: { brush: string; score?: number }[] };

/** Each targeted brush of `packs` (each `<style>/<pack>`, all of one app) with its source, target and last sheet score. */
export function readBrushFidelityPacks(stylesDir: string, packs: readonly { style: string; pack: string }[]) {
  const read = packs.map(({ style, pack }) => {
    const dir = join(stylesDir, style, 'brushes', pack), manifest = readStampPaintPackDir(dir), targets = readBrushFidelityTargets(dir, manifest);
    const reportFile = join(dir, 'fidelity', 'report.json');
    const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) as BrushFidelityReport : undefined;
    const sheetScores = new Map(report?.entries.map((e) => [e.brush, e.score]));
    const brushes = Object.keys(manifest.brushes).flatMap((name) => {
      const target = targets[name];
      return target.kind === 'none' ? [] : [{ style, pack, name, target, sheetScore: sheetScores.get(name) }];
    });
    return { style, pack, manifest, brushes };
  });
  const apps = [...new Set(read.map(({ manifest }) => manifest.app))];
  if (apps.length !== 1) throw new Error(`brushes: ${packs.map(({ style, pack }) => `${style}/${pack}`).join(', ')} mix ${apps.join(' and ')} packs; a reading is one app's`);
  return { app: apps[0], packs: read };
}

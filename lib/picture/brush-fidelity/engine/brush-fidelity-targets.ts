// brush-fidelity-targets.ts: each brush of an imported pack with what it's measured against (brush-fidelity-target.ts):
// its Procreate preview, else its Photoshop reference capture, else nothing at its source's own size; and the pack's
// report.json on disk (brush-fidelity-report.ts), with the baselines a fit reads from it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stampPaintPackDiameter, type StampPaintPack } from '#lib/picture/stamp-styles/models/stamp-paint-pack.ts';
import { readStampPaintPackDir } from '#lib/picture/stamp-styles/engine/stamp-paint-pack-files.ts';
import {
  brushFidelityIdentityDifferences, currentBrushFidelityIdentity, parseBrushFidelityReport, type BrushFidelityReport,
} from '../models/brush-fidelity-report.ts';
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

/** A pack's report.json, in the fidelity/ its sheet is drawn to by default. */
export const brushFidelityReportFile = (packDir: string) => join(packDir, 'fidelity', 'report.json');

/** A report.json, parsed whole: one of another version, or none, is refused with how to draw it again. */
export const readBrushFidelityReport = (file: string): BrushFidelityReport => parseBrushFidelityReport(JSON.parse(readFileSync(file, 'utf8')), file);

export const writeBrushFidelityReport = (file: string, report: BrushFidelityReport) => writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);

/**
 * What each targeted brush of `<style>/<pack>` scored on the pack's last whole sheet, by name: the baseline a fit holds
 * it to. A brush whose target has nothing to measure holds at 0, as the fit scores it.
 *
 * A report of another source, reading or scorer is refused, not warned about: its scores measured other brushes, or
 * measured them another way, so holding today's brushes to them would weigh the fit by a comparison nobody made.
 * Drawing the sheets again is a few minutes; a fit that quietly regressed against a stale baseline isn't found at all.
 */
export function readBrushFidelityBaselines(stylesDir: string, style: string, pack: string): Map<string, number> {
  const dir = join(stylesDir, style, 'brushes', pack), manifest = readStampPaintPackDir(dir), file = brushFidelityReportFile(dir);
  const redraw = `draw it again: npm run brushes:sheet -- --style ${style} --pack ${pack}`;
  if (!existsSync(file)) throw new Error(`brushes: ${style}/${pack} has no sheet to hold the fit to (${file}); ${redraw}`);
  const report = readBrushFidelityReport(file), stale = brushFidelityIdentityDifferences(report.identity, currentBrushFidelityIdentity(manifest));
  if (stale.length) throw new Error(`brushes: ${file} scored other brushes or scored them otherwise (${stale.join('; ')}); ${redraw}`);
  const outcomes = new Map(report.entries.map((e) => [e.brush, e.outcome]));
  const targets = readBrushFidelityTargets(dir, manifest);
  return new Map(Object.keys(manifest.brushes).flatMap((name): [string, number][] => {
    if (targets[name].kind === 'none') return [];
    const outcome = outcomes.get(name);
    switch (outcome?.kind) {
      case 'scored': case 'emptyRender': return [[name, outcome.score]];
      case 'unmeasurableTarget': return [[name, 0]];
      case 'unscored': case undefined: throw new Error(`brushes: ${file} ${outcome ? 'predates' : 'has no row for'} ${JSON.stringify(name)}'s target; ${redraw}`);
    }
  }));
}

/** Each targeted brush of `packs` (each `<style>/<pack>`, all of one app) with its source and target. */
export function readBrushFidelityPacks(stylesDir: string, packs: readonly { style: string; pack: string }[]) {
  const read = packs.map(({ style, pack }) => {
    const dir = join(stylesDir, style, 'brushes', pack), manifest = readStampPaintPackDir(dir), targets = readBrushFidelityTargets(dir, manifest);
    const brushes = Object.keys(manifest.brushes).flatMap((name) => {
      const target = targets[name];
      return target.kind === 'none' ? [] : [{ style, pack, name, target }];
    });
    return { style, pack, manifest, brushes };
  });
  const apps = [...new Set(read.map(({ manifest }) => manifest.app))];
  if (apps.length !== 1) throw new Error(`brushes: ${packs.map(({ style, pack }) => `${style}/${pack}`).join(', ')} mix ${apps.join(' and ')} packs; a reading is one app's`);
  return { app: apps[0], packs: read };
}

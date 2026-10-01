// brush-fidelity-targets.ts: each brush of an imported pack with what it's measured against (brush-fidelity-target.ts):
// its Procreate preview, else its Photoshop reference capture, else nothing at its source's own size; and the pack's
// report.json on disk (brush-fidelity-report.ts), with the baselines a fit reads from it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveStampPaintPackBrush, stampPaintPackDiameter, type PhotoshopPackBrush, type ProcreatePackBrush, type StampPaintPack,
} from '#lib/paint/brush-packs/models/stamp-paint-pack.ts';
import { readServedStampPaintPack, readStampPaintPackDir, type ServedStampPaintPack } from '#lib/paint/brush-packs/engine/stamp-paint-pack-files.ts';
import {
  brushFidelityIdentityDifferences, currentBrushFidelityIdentity, parseBrushFidelityReport, type BrushFidelityReport,
} from '../models/brush-fidelity-report.ts';
import { stampBrushPaintReach } from '../models/photoshop-reference-stroke.ts';
import { untargetedBrushFidelity, type BrushFidelityMeasurableTarget, type BrushFidelityTarget } from '../models/brush-fidelity-target.ts';
import { photoshopReferenceStrokePng, readPhotoshopReferenceStrokes } from './photoshop-reference-target.ts';

/** Each brush of `manifest` (in `packDir`) by name, with its target. */
export function readBrushFidelityTargets(packDir: string, manifest: StampPaintPack): Record<string, BrushFidelityTarget> {
  // A captured item the pack didn't import (a skipped preset) is read as reaching its tip's corner alone.
  const reachOf = (item: string) => {
    const read = resolveStampPaintPackBrush(manifest, item);
    return read ? stampBrushPaintReach(read.brush) : Math.SQRT1_2;
  };
  const references = readPhotoshopReferenceStrokes(packDir, reachOf);
  return Object.fromEntries(Object.keys(manifest.brushes).map((name): [string, BrushFidelityTarget] => {
    const preview = manifest.previews[name], reference = references.get(name);
    return [name, preview ? { kind: 'procreatePreview', image: preview.image, shows: preview.shows }
      : reference ? { kind: 'photoshopReference', stroke: reference }
      : untargetedBrushFidelity(stampPaintPackDiameter(manifest, name))];
  }));
}

/** The image the fidelity page measures `target` from: a preview's URL, or a reference cropped to a data URL. */
export function brushFidelityTargetSrc(target: BrushFidelityMeasurableTarget, packUrl: string): string {
  switch (target.kind) {
    case 'procreatePreview': return `${packUrl}/${target.image}`;
    case 'photoshopReference': return photoshopReferenceStrokePng(target.stroke);
  }
}

/** A pack's report.json, in the fidelity/ its sheet is drawn to by default. */
export const brushFidelityReportFile = (packDir: string) => join(packDir, 'fidelity', 'report.json');

/** A report.json, parsed whole: one of another version, or none, is refused with how to draw it again. */
export const readBrushFidelityReport = (file: string): BrushFidelityReport => parseBrushFidelityReport(JSON.parse(readFileSync(file, 'utf8')), file);

export const writeBrushFidelityReport = (file: string, report: BrushFidelityReport) => writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);

/**
 * Each targeted brush's score on the pack's last whole sheet: the baseline a fit holds it to (0 when its target has
 * nothing to measure). A report of another source, reading or scorer is refused, not warned about: it measured other
 * brushes or another way. Redrawing takes minutes; a fit regressed against a stale baseline is never found.
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

/** A targeted brush of a pack with its source, as its app's importer reads it. */
export type BrushFidelityTargetedBrush<Source> = { style: string; pack: string; packUrl: string; name: string; source: Source; target: BrushFidelityMeasurableTarget };

/** Each targeted brush of `read`'s pack with its source, typed by the app `brushes` was narrowed to. */
function targetedBrushes<Source>(
  style: string, pack: string, { packDir, manifest, url }: ServedStampPaintPack, brushes: Readonly<Record<string, Source>>,
): BrushFidelityTargetedBrush<Source>[] {
  const targets = readBrushFidelityTargets(packDir, manifest);
  return Object.entries(brushes).flatMap(([name, source]) => {
    const target = targets[name];
    return target.kind === 'none' ? [] : [{ style, pack, packUrl: url, name, source, target }];
  });
}

/** Each targeted brush of `packs` (each `<style>/<pack>`, all of one app) with its source and target, by their app. */
export function readBrushFidelityPacks(stylesDir: string, packs: readonly { style: string; pack: string }[]):
  | { app: 'procreate'; brushes: BrushFidelityTargetedBrush<ProcreatePackBrush>[] }
  | { app: 'photoshop'; brushes: BrushFidelityTargetedBrush<PhotoshopPackBrush>[] } {
  const procreate: BrushFidelityTargetedBrush<ProcreatePackBrush>[] = [], photoshop: BrushFidelityTargetedBrush<PhotoshopPackBrush>[] = [];
  const apps = new Set<StampPaintPack['app']>();
  for (const { style, pack } of packs) {
    const read = readServedStampPaintPack(stylesDir, style, pack), { manifest } = read;
    apps.add(manifest.app);
    if (manifest.app === 'procreate') procreate.push(...targetedBrushes(style, pack, read, manifest.brushes));
    else photoshop.push(...targetedBrushes(style, pack, read, manifest.brushes));
  }
  if (apps.size !== 1) throw new Error(`brushes: ${packs.map(({ style, pack }) => `${style}/${pack}`).join(', ')} mix ${[...apps].join(' and ')} packs; a reading is one app's`);
  return apps.has('photoshop') ? { app: 'photoshop', brushes: photoshop } : { app: 'procreate', brushes: procreate };
}

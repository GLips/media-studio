// stamp-paint-guard.ts: `npm run brushes:guard`, what holds a restructuring of the brush engine to "nothing painted
// changes". A fingerprint hashes the compiled stamps of every brush of every imported pack in every style, painted as
// its fidelity sheet paints it and in a fixed probe painting (placed stamps and a hand-drawn stroke), so placement,
// seeding and the recipe are checked in Node, brush by brush, without the GPU. Its diffs read two manifests, or two
// sheet reports, brush by brush: a total can hide offsetting changes.
//
// It holds to a tolerance, not to the bit: a stamp's numbers may drift by float order (STAMP_DRIFT), a brush's score
// by SCORE_DRIFT and a pack's total by TOTAL_DRIFT, as nothing that small shows in a painting.
//
// Negative space: a fingerprint hashes stamps, not the brush, so a brush reshaped without moving a stamp keeps it; the
// manifest diff shows the reshaping, and the sheet's scores what the GPU does with it.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { photoshopReferencePainting } from '../models/photoshop-reference-stroke.ts';
import { procreatePreviewPainting } from '../models/procreate-preview-stroke.ts';
import type { StampBrush } from '../models/stamp-brush.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type CompiledStampPaint } from '../models/stamp-paint-recipe.ts';
import { STAMP_PAINT_PACK_MANIFEST, type StampPaintPackManifest } from '../models/style.ts';
import { readPhotoshopReferenceStrokes } from './photoshop-reference-target.ts';

/**
 * A painting's stamps: a hash of them exactly, their count, and each numeric field summed over them, so a hash that
 * moved can be told drift from change.
 */
type StampPaintingPrint = { hash: string; stamps: number; sums: Record<string, number> };

/** Each pack, `<style>/<pack>`, to each brush's prints: as its sheet paints it, and in the probe painting. */
export type StampPaintFingerprints = Record<string, Record<string, { sheet: StampPaintingPrint; probe: StampPaintingPrint }>>;

/** How far, relative to its size, a summed stamp field may drift: float order, never a stamp that moved. */
const STAMP_DRIFT = 1e-6;
/** How far a brush's sheet score may move, and a pack's total as a share of it. */
const SCORE_DRIFT = 0.02;
const TOTAL_DRIFT = 0.01;

/** The diameter the sheet paints a previewed brush at first, before fitting it on the GPU; stamps scale with it. */
const SHEET_DIAMETER = 120;
const UNPREVIEWED_DIAMETER = { min: 16, max: 240 };

/** Placed stamps at their own sizes, turns and pressures, and a hand-drawn stroke with a lift. */
function probePainting(brush: StampBrush): CompiledStampPaint {
  const material = { kind: 'pigment', color: '#6a4c93' } as const;
  return compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('probe', { composite: 'glaze', opacity: 0.8 }, (group) => group.pass('probe', {}, (pass) => {
    pass.stamps('placed', { brush, material, diameter: 70, secondaryColor: '#e0b040', at: [
      { x: 100, y: 120 }, { x: 260, y: 140, diameter: 40, rotation: 0.7 }, { x: 420, y: 110, pressure: 0.3 }, { x: 600, y: 150, diameter: 110, pressure: 0.8, rotation: -1.2 },
    ] });
    pass.stroke('hand', { brush, material, diameter: 55, hand: { profile: 'taper' }, path: [
      { x: 60, y: 260 }, { x: 300, y: 200, pressure: 0.6 }, { x: 520, y: 280, speed: 0.5 }, { x: 700, y: 230, lift: true }, { x: 960, y: 250, pressure: 0.2 },
    ] });
  }))));
}

/** Each numeric leaf of `value`, summed into `sums` by its path with array indices dropped. */
function sumNumbers(value: unknown, path: string, sums: Record<string, number>) {
  if (typeof value === 'number') sums[path] = (sums[path] ?? 0) + value;
  else if (typeof value === 'boolean') sums[path] = (sums[path] ?? 0) + Number(value);
  else if (Array.isArray(value)) for (const item of value) sumNumbers(item, path, sums);
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) sumNumbers(item, path ? `${path}.${key}` : key, sums);
}

/** A painting's stamps, as they reach the renderer: everything a deposit carries but its brush. */
function printPainting(painting: CompiledStampPaint): StampPaintingPrint {
  const deposits = painting.groups.flatMap((group) => group.passes.flatMap((pass) => pass.deposits.map(({ brush: _brush, ...deposit }) => deposit)));
  const sums: Record<string, number> = {};
  sumNumbers(deposits, '', sums);
  return {
    hash: createHash('sha256').update(JSON.stringify(deposits)).digest('hex').slice(0, 16),
    stamps: deposits.reduce((n, d) => n + d.stamps.length + d.dualStamps.length, 0),
    sums,
  };
}

/** Why `after` isn't `before` within drift, or nothing. */
function printMoved(before: StampPaintingPrint, after: StampPaintingPrint): string | undefined {
  if (before.hash === after.hash) return undefined;
  if (before.stamps !== after.stamps) return `${before.stamps} → ${after.stamps} stamps`;
  const moved = [...new Set([...Object.keys(before.sums), ...Object.keys(after.sums)])].filter((key) => {
    const a = before.sums[key] ?? 0, b = after.sums[key] ?? 0;
    return Math.abs(a - b) > STAMP_DRIFT * Math.max(1, Math.abs(a), Math.abs(b));
  });
  return moved.length ? moved.map((key) => `${key} ${before.sums[key]} → ${after.sums[key]}`).join(', ') : undefined;
}

/** Every imported pack of every style in `stylesDir`, fingerprinted brush by brush. */
export function fingerprintStampPaintPacks(stylesDir: string): StampPaintFingerprints {
  const packs = readdirSync(stylesDir).flatMap((style) => {
    const brushes = join(stylesDir, style, 'brushes');
    return existsSync(brushes) ? readdirSync(brushes).filter((pack) => existsSync(join(brushes, pack, STAMP_PAINT_PACK_MANIFEST))).map((pack) => ({ style, pack, dir: join(brushes, pack) })) : [];
  });
  return Object.fromEntries(packs.map(({ style, pack, dir }) => {
    const manifest = JSON.parse(readFileSync(join(dir, STAMP_PAINT_PACK_MANIFEST), 'utf8')) as StampPaintPackManifest;
    const references = readPhotoshopReferenceStrokes(dir);
    const brushes = Object.fromEntries(Object.entries(manifest.brushes).map(([name, brush]) => {
      const preview = manifest.previews[name], reference = preview ? undefined : references.get(name), source = manifest.diameters?.[name];
      const sheet = preview ? procreatePreviewPainting(brush, SHEET_DIAMETER, preview.shows)
        : reference ? photoshopReferencePainting(brush, reference.diameter, reference.poseOverrides)
        : procreatePreviewPainting(brush, source ? Math.min(UNPREVIEWED_DIAMETER.max, Math.max(UNPREVIEWED_DIAMETER.min, source)) : SHEET_DIAMETER, 'stroke');
      return [name, { sheet: printPainting(sheet), probe: printPainting(probePainting(brush)) }];
    }));
    return [`${style}/${pack}`, brushes];
  }));
}

/**
 * Where `after` differs from `before` past drift, a line each: a pack or brush gained or lost, or a brush's stamps
 * moved. `drifted` counts the paintings whose hash moved within drift.
 */
export function diffStampPaintFingerprints(before: StampPaintFingerprints, after: StampPaintFingerprints): { moved: string[]; drifted: number } {
  let drifted = 0;
  const moved = [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((pack) => {
    if (!before[pack] || !after[pack]) return [`${pack}: ${before[pack] ? 'gone' : 'new'}`];
    return [...new Set([...Object.keys(before[pack]), ...Object.keys(after[pack])])].flatMap((brush) => {
      const a = before[pack][brush], b = after[pack][brush];
      if (!a || !b) return [`${pack} ${brush}: ${a ? 'gone' : 'new'}`];
      return (['sheet', 'probe'] as const).flatMap((k) => {
        const why = printMoved(a[k], b[k]);
        if (!why && a[k].hash !== b[k].hash) drifted++;
        return why ? [`${pack} ${brush}: ${k} moved: ${why}`] : [];
      });
    });
  });
  return { moved, drifted };
}

/** The JSON paths at which `a` and `b` differ, as `path: a → b`. */
function jsonDifferences(a: unknown, b: unknown, path: string): string[] {
  if (a === b) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.flatMap((key) => jsonDifferences((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`));
  }
  return [`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`];
}

/** Where two pack manifests differ, brush by brush and then the rest, a line each. */
export function diffStampPaintManifests(before: StampPaintPackManifest, after: StampPaintPackManifest): string[] {
  const names = [...new Set([...Object.keys(before.brushes), ...Object.keys(after.brushes)])];
  const brushes = names.flatMap((name) => jsonDifferences(before.brushes[name], after.brushes[name], JSON.stringify(name)));
  const { brushes: _a, ...restBefore } = before, { brushes: _b, ...restAfter } = after;
  return [...brushes, ...jsonDifferences(restBefore, restAfter, 'manifest')];
}

type SheetReport = { total: number; entries: { brush: string; comparison?: { score: number } }[] };

/**
 * Where two sheet reports differ past drift, a line each: a brush gained, lost, scored or unscored, or its score moved
 * past SCORE_DRIFT, or the total past TOTAL_DRIFT of itself. `drift` is the largest move within them.
 */
export function diffStampBrushSheetReports(before: SheetReport, after: SheetReport): { moved: string[]; drift: number } {
  const at = (report: SheetReport) => new Map(report.entries.map((e) => [e.brush, e.comparison?.score]));
  const a = at(before), b = at(after);
  let drift = 0;
  const moved = [...new Set([...a.keys(), ...b.keys()])].flatMap((brush) => {
    const x = a.get(brush), y = b.get(brush);
    if (!a.has(brush) || !b.has(brush) || (x === undefined) !== (y === undefined)) return [`${brush}: ${a.has(brush) ? x ?? 'unscored' : 'absent'} → ${b.has(brush) ? y ?? 'unscored' : 'absent'}`];
    if (x === undefined || y === undefined) return [];
    if (Math.abs(x - y) > SCORE_DRIFT) return [`${brush}: score ${x.toFixed(4)} → ${y.toFixed(4)}`];
    drift = Math.max(drift, Math.abs(x - y));
    return [];
  });
  const total = Math.abs(after.total - before.total) > TOTAL_DRIFT * before.total ? [`total: ${before.total} → ${after.total}`] : [];
  return { moved: [...moved, ...total], drift };
}

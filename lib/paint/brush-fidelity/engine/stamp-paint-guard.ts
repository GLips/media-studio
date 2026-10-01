// stamp-paint-guard.ts: `npm run brushes:guard`, holding a brush-engine restructuring to "nothing painted changes".
// A fingerprint keeps every imported brush's compiled deposits (as its sheet paints it, and in a fixed probe painting),
// checking placement, seeding and recipe in Node without the GPU. A brush snapshot holds every brush as read; diffs go
// brush by brush, as a total hides offsetting changes. Tolerances (STAMP_DRIFT, SCORE_DRIFT, TOTAL_DRIFT) allow float
// order: nothing that small shows.
//
// Negative space: a fingerprint keeps stamps, not the brush, so a brush reshaped without moving a stamp keeps it; the
// brush snapshot's diff shows the reshaping, and the sheet's scores what the GPU does with it.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { compileStampPaintRecipe, stampPassDeposits, type CompiledStampDeposit, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { PlacedStamp } from '#lib/paint/brush/models/stamp-placement.ts';
import { resolveStampPaintPackBrushes, type StampPaintPack } from '#lib/paint/brush-packs/models/stamp-paint-pack.ts';
import { readImportedStampPaintPack } from '#lib/paint/brush-packs/engine/stamp-paint-pack-files.ts';
import { brushFidelityIdentityDifferences, brushFidelityOutcomeScore, type BrushFidelityReport } from '../models/brush-fidelity-report.ts';
import { brushFidelityDiameter, brushFidelityPainting } from '../models/brush-fidelity-target.ts';
import { readBrushFidelityBrushes } from '../models/brush-readings.ts';
import { readBrushFidelityTargets } from './brush-fidelity-targets.ts';

/**
 * A painting's deposits as they reach the renderer, their brush aside, each deposit's stamps and dual stamps kept by
 * column (each leaf of a stamp, over its stamps in order: `x`, `tint.hue`…), as JSON reads them back; and a hash of
 * them, which only says whether a walk is needed.
 */
export type StampPaintingPrint = { hash: string; deposits: unknown };

/** A brush's prints: as its sheet paints it, and in the probe painting. `pack` is `<style>/<pack>`. */
export type StampPaintBrushPrint = { pack: string; brush: string; sheet: StampPaintingPrint; probe: StampPaintingPrint };

/** The fingerprint file's format: its first line names it, so a file of another is refused, not misread. */
const STAMP_PAINT_FINGERPRINT_VERSION = 1;

/** How far, relative to its size (absolute below 1), a stamp's number may drift: float order, never a stamp that moved. */
const STAMP_DRIFT = 1e-6;
/** Differing paths shown for a painting: enough to see what moved without drowning the rest. */
const PAINTING_DIFFERENCES = 4;
/** How far a brush's sheet score may move, and a pack's total as a share of it. */
const SCORE_DRIFT = 0.02;
const TOTAL_DRIFT = 0.01;

/** Placed stamps at their own sizes, turns and pressures, and a hand-drawn stroke with a lift. */
function probePainting(brush: StampBrush): CompiledStampPaint {
  const material = { kind: 'color', color: '#6a4c93' } as const;
  return compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('probe', { composite: 'glaze', opacity: 0.8 }, (group) => group.pass('probe', {}, (pass) => {
    pass.stamps('placed', { brush, material, diameter: 70, secondaryColor: '#e0b040', at: [
      { x: 100, y: 120 }, { x: 260, y: 140, diameter: 40, rotation: 0.7 }, { x: 420, y: 110, pressure: 0.3 }, { x: 600, y: 150, diameter: 110, pressure: 0.8, rotation: -1.2 },
    ] });
    pass.stroke('hand', { brush, material, diameter: 55, hand: { profile: 'taper' }, path: [
      { x: 60, y: 260 }, { x: 300, y: 200, pressure: 0.6 }, { x: 520, y: 280, speed: 0.5 }, { x: 700, y: 230, lift: true }, { x: 960, y: 250, pressure: 0.2 },
    ] });
  }))));
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Each leaf of `stamp` by its dotted path. */
function stampLeaves(value: unknown, path: string, into: (path: string, leaf: unknown) => void) {
  if (isPlainObject(value)) for (const [key, item] of Object.entries(value)) stampLeaves(item, path ? `${path}.${key}` : key, into);
  else into(path, value);
}

/**
 * Stamps by column: a painting holds a million stamps, and their keys repeated on each were most of its size. A stamp
 * lacking a leaf its neighbours have leaves null in that column, which the walk reports.
 */
function stampColumns(stamps: readonly PlacedStamp[]): Record<string, unknown[]> {
  const columns: Record<string, unknown[]> = {};
  stamps.forEach((stamp, i) => stampLeaves(stamp, '', (path, leaf) => {
    (columns[path] ??= Array.from({ length: stamps.length }, () => null))[i] = leaf;
  }));
  return columns;
}

/** A deposit as printed: its brush left out, its stamps in columns. */
function printedStampDeposit({ brush: _brush, stamps, dualStamps, ...deposit }: CompiledStampDeposit) {
  return { ...deposit, stamps: stampColumns(stamps), dualStamps: stampColumns(dualStamps) };
}

/** A painting's print. Its deposits go through JSON so they compare as a file read back would hold them. */
export function printStampPainting(painting: CompiledStampPaint): StampPaintingPrint {
  const deposits = painting.groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass).map((deposit) => printedStampDeposit(deposit))));
  const json = JSON.stringify(deposits);
  return { hash: createHash('sha256').update(json).digest('hex').slice(0, 16), deposits: JSON.parse(json) };
}

/** Walks `a` and `b` together, pushing each path where they differ past drift into `out`, up to `limit`. */
function printDifferences(a: unknown, b: unknown, path: string, out: string[], limit: number) {
  if (out.length >= limit || a === b) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > STAMP_DRIFT * Math.max(1, Math.abs(a), Math.abs(b))) out.push(`${path}: ${a} → ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: ${a.length} → ${b.length} items`);
    else for (let i = 0; i < a.length && out.length < limit; i++) printDifferences(a[i], b[i], `${path}[${i}]`, out, limit);
  } else if (isPlainObject(a) && isPlainObject(b)) {
    const gone = Object.keys(a).filter((key) => !(key in b)), added = Object.keys(b).filter((key) => !(key in a));
    if (gone.length || added.length) out.push(`${path}: ${[...gone.map((key) => `-${key}`), ...added.map((key) => `+${key}`)].join(' ')}`);
    else for (const key of Object.keys(a)) printDifferences(a[key], b[key], `${path}.${key}`, out, limit);
  } else out.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
}

/**
 * Where `after` differs from `before` past drift, the first few paths: the same structure (keys, lengths, order), the
 * same IDs and every other non-number exactly, and each number within STAMP_DRIFT of its counterpart. None when the
 * hashes agree.
 */
export function diffStampPaintingPrints(before: StampPaintingPrint, after: StampPaintingPrint): string[] {
  if (before.hash === after.hash) return [];
  const out: string[] = [];
  printDifferences(before.deposits, after.deposits, 'deposits', out, PAINTING_DIFFERENCES);
  return out;
}

/** Every imported pack of every style in `stylesDir`, by `<style>/<pack>`, with its folder. */
function importedStampPaintPacks(stylesDir: string): { id: string; dir: string; pack: StampPaintPack }[] {
  return readdirSync(stylesDir).flatMap((style) => {
    const brushes = join(stylesDir, style, 'brushes');
    return existsSync(brushes)
      ? readdirSync(brushes).flatMap((pack) => {
        const imported = readImportedStampPaintPack(join(brushes, pack));
        return imported ? [{ id: `${style}/${pack}`, dir: join(brushes, pack), pack: imported.manifest }] : [];
      })
      : [];
  });
}

/** Each pack, `<style>/<pack>`, to its brushes as their sources read, by name. */
export type StampPaintBrushSnapshot = Record<string, Record<string, StampBrush>>;

/** Every imported pack's brushes as their sources read today, to diff against a later reading. */
export const snapshotStampPaintBrushes = (stylesDir: string): StampPaintBrushSnapshot =>
  Object.fromEntries(importedStampPaintPacks(stylesDir).map(({ id, pack }) => [id, resolveStampPaintPackBrushes(pack)]));

/** Every brush of every imported pack of every style in `stylesDir`, printed one at a time: all at once is gigabytes. */
export function* fingerprintStampPaintPacks(stylesDir: string): Generator<StampPaintBrushPrint> {
  for (const { id, dir, pack: manifest } of importedStampPaintPacks(stylesDir)) {
    const targets = readBrushFidelityTargets(dir, manifest), asTargeted = readBrushFidelityBrushes(manifest, targets);
    for (const [name, brush] of Object.entries(resolveStampPaintPackBrushes(manifest))) {
      // A preview's brush is painted at the diameter its fit starts from, before the GPU fits it; stamps scale with it.
      const sheet = brushFidelityPainting(asTargeted[name], targets[name], brushFidelityDiameter(targets[name]));
      yield { pack: id, brush: name, sheet: printStampPainting(sheet), probe: printStampPainting(probePainting(brush)) };
    }
  }
}

/** Writes every brush's prints to `file`: gzipped, a line of JSON each after the format's line. */
export function writeStampPaintFingerprints(stylesDir: string, file: string): { brushes: number; packs: number; bytes: number } {
  const lines = [Buffer.from(`${JSON.stringify({ stampPaintFingerprints: STAMP_PAINT_FINGERPRINT_VERSION })}\n`)], packs = new Set<string>();
  for (const print of fingerprintStampPaintPacks(stylesDir)) {
    lines.push(Buffer.from(`${JSON.stringify(print)}\n`));
    packs.add(print.pack);
  }
  const gz = gzipSync(Buffer.concat(lines));
  writeFileSync(file, gz);
  return { brushes: lines.length - 1, packs: packs.size, bytes: gz.length };
}

/** A fingerprint file's prints by `<pack> <brush>`. */
function readStampPaintFingerprints(file: string): Map<string, StampPaintBrushPrint> {
  const text = gunzipSync(readFileSync(file)), prints = new Map<string, StampPaintBrushPrint>();
  let start = text.indexOf(10) + 1;
  const format = JSON.parse(text.toString('utf8', 0, start)) as { stampPaintFingerprints?: unknown };
  if (format.stampPaintFingerprints !== STAMP_PAINT_FINGERPRINT_VERSION) {
    throw new Error(`brushes guard: ${file} is fingerprint format ${String(format.stampPaintFingerprints ?? 'none')}, and the guard reads ${STAMP_PAINT_FINGERPRINT_VERSION}; write it again with a checkout of the engine it was meant to hold`);
  }
  // Each line is parsed alone: the whole file as one string passes V8's longest.
  while (start < text.length) {
    const end = text.indexOf(10, start), print = JSON.parse(text.toString('utf8', start, end)) as StampPaintBrushPrint;
    prints.set(`${print.pack} ${print.brush}`, print);
    start = end + 1;
  }
  return prints;
}

/**
 * Where today's prints differ from `file`'s past drift, a line each: a brush gained or lost, or a painting's first few
 * differing paths. `drifted` counts the paintings whose hash moved within drift.
 */
export function checkStampPaintFingerprints(stylesDir: string, file: string): { moved: string[]; drifted: number; brushes: number } {
  const before = readStampPaintFingerprints(file), moved: string[] = [];
  let drifted = 0, brushes = 0;
  for (const after of fingerprintStampPaintPacks(stylesDir)) {
    brushes++;
    const key = `${after.pack} ${after.brush}`, was = before.get(key);
    before.delete(key);
    if (!was) {
      moved.push(`${key}: new`);
      continue;
    }
    for (const painting of ['sheet', 'probe'] as const) {
      const differences = diffStampPaintingPrints(was[painting], after[painting]);
      if (differences.length) moved.push(...differences.map((difference) => `${key}: ${painting} ${difference}`));
      else if (was[painting].hash !== after[painting].hash) drifted++;
    }
  }
  for (const key of before.keys()) moved.push(`${key}: gone`);
  return { moved, drifted, brushes };
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

/** Where two brush snapshots differ, pack by pack and brush by brush, a JSON path each. */
export function diffStampPaintBrushSnapshots(before: StampPaintBrushSnapshot, after: StampPaintBrushSnapshot): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((pack) => {
    const names = [...new Set([...Object.keys(before[pack] ?? {}), ...Object.keys(after[pack] ?? {})])];
    return names.flatMap((name) => jsonDifferences(before[pack]?.[name], after[pack]?.[name], `${pack} ${JSON.stringify(name)}`));
  });
}

/**
 * Where two sheet reports differ past drift, a line each: what they scored (source, reading, scorer), a brush gained,
 * lost or of another outcome, its score moved past SCORE_DRIFT, or the total past TOTAL_DRIFT of itself. `drift` is
 * the largest move within them.
 */
export function diffStampBrushSheetReports(before: BrushFidelityReport, after: BrushFidelityReport): { moved: string[]; drift: number } {
  const identity = brushFidelityIdentityDifferences(before.identity, after.identity).map((line) => `scored under another ${line}`);
  const at = (report: BrushFidelityReport) => new Map(report.entries.map((e) => [e.brush, e.outcome]));
  const a = at(before), b = at(after);
  let drift = 0;
  const moved = [...new Set([...a.keys(), ...b.keys()])].flatMap((brush) => {
    const x = a.get(brush), y = b.get(brush);
    if (!x || !y || x.kind !== y.kind) return [`${brush}: ${x?.kind ?? 'absent'} → ${y?.kind ?? 'absent'}`];
    const from = brushFidelityOutcomeScore(x), to = brushFidelityOutcomeScore(y);
    if (from === undefined || to === undefined) return [];
    if (Math.abs(from - to) > SCORE_DRIFT) return [`${brush}: score ${from.toFixed(4)} → ${to.toFixed(4)}`];
    drift = Math.max(drift, Math.abs(from - to));
    return [];
  });
  const total = Math.abs(after.total - before.total) > TOTAL_DRIFT * before.total ? [`total: ${before.total} → ${after.total}`] : [];
  return { moved: [...identity, ...moved, ...total], drift };
}

// photoshop-capture.ts: `npm run photoshop -- probes` and `npm run photoshop -- references`, which have Photoshop 2026 paint
// the probes and a pack's brushes and write what it painted, with a manifest (vid-100). Photoshop is driven by
// lib/platform/photoshop/engine/photoshop-app.ts, which owns it for the run and puts Graham's settings back after;
// the painting itself is photoshop-capture.jsxinc, one script per sheet of the plan (models/photoshop-capture-plan.ts).
//
// Captures are private assets beside the packs: a probe run in work/styles/<style>/brushes/photoshop-probes/<run>/,
// a pack's references in work/styles/<style>/brushes/<pack>/reference/, replaced on each run.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { runPhotoshopScript, withOwnedPhotoshop, type PhotoshopSettingsRestore } from '#lib/platform/photoshop/engine/photoshop-app.ts';
import { photoshopPresetMismatches, photoshopPresetScript, type PhotoshopPreset } from '../models/photoshop-preset.ts';
import { comparePhotoshopCells, cropPhotoshopCell, type PhotoshopPixels } from '../models/photoshop-capture-cells.ts';
import {
  PHOTOSHOP_CAPTURE_DOCUMENT, PHOTOSHOP_GROUND_RGB, PHOTOSHOP_NOT_CAPTURED, planPhotoshopProbeCapture, planPhotoshopReferenceCapture, photoshopReferenceSize,
  type PhotoshopCaptureCell, type PhotoshopCaptureManifest, type PhotoshopCaptureSheet,
} from '../models/photoshop-capture-plan.ts';
import { PHOTOSHOP_PROBE_RAMP, PHOTOSHOP_PROBE_SAMPLES, PHOTOSHOP_PROBE_TIP, photoshopProbeRampValue, photoshopProbes } from '../models/photoshop-probes.ts';

const CAPTURE_JSX = readFileSync(new URL('./photoshop-capture.jsxinc', import.meta.url), 'utf8');

type Log = (line: string) => void;

const runId = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');

function captureScript<T>(entry: string, data: unknown): T {
  return JSON.parse(runPhotoshopScript(`${CAPTURE_JSX}\n${entry}();`, { data, timeoutSeconds: 3600 })) as T;
}

/** Writes a grey PNG from values 0..1 per pixel, at 16 or 8 bits. */
function writeGreyPng(file: string, width: number, height: number, value: (x: number, y: number) => number, bits: 8 | 16) {
  const bytes = Buffer.alloc(width * height * (bits / 8));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.min(1, Math.max(0, value(x, y))), i = y * width + x;
      if (bits === 16) bytes.writeUInt16BE(Math.round(v * 65535), i * 2);
      else bytes[i] = Math.round(v * 255);
    }
  }
  runFfmpeg(['-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', bits === 16 ? 'gray16be' : 'gray', '-s', `${width}x${height}`, '-i', 'pipe:0', file], { input: bytes });
}

/** A capture sheet's pixels: Photoshop's 16-bit PNG decoded to straight RGBA. */
export function readPhotoshopSheet(file: string, width: number, height: number): PhotoshopPixels {
  const raw = runFfmpeg(['-nostdin', '-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba64le', 'pipe:1'], { maxBuffer: width * height * 8 + 1024 });
  if (raw.length !== width * height * 8) throw new Error(`capture: ${file} decoded to ${raw.length} bytes, not ${width}×${height} RGBA at 16 bits`);
  return { width, height, rgba: new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2) };
}

/** A run's manifest and every cell with its pixels, sheet by sheet (a sheet is decoded once, when first reached). */
export function* readPhotoshopCaptureCells(dir: string): Generator<{ manifest: PhotoshopCaptureManifest; sheet: string; cell: PhotoshopCaptureCell; pixels: PhotoshopPixels }> {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as PhotoshopCaptureManifest;
  for (const sheet of manifest.sheets) {
    const pixels = readPhotoshopSheet(join(dir, sheet.file), sheet.width, sheet.height);
    for (const cell of sheet.cells) yield { manifest, sheet: sheet.name, cell, pixels: cropPhotoshopCell(pixels, cell.box) };
  }
}

/**
 * Paints each sheet in its own script and saves it into `dir`; returns the sheets with their files, and what each item
 * applied. `jobs` holds what the script sets for each item: a probe's preset as its `script`, or a pack brush's `preset`.
 */
function paintSheets(dir: string, sheets: readonly PhotoshopCaptureSheet[], jobs: Record<string, unknown>, extra: Record<string, unknown>, log: Log) {
  const applied: Record<string, PhotoshopCaptureManifest['items'][string]['applied']> = {};
  let paintMs = 0;
  const written = sheets.map((sheet, i) => {
    const file = `${sheet.name}.png`;
    const jobItems = Object.fromEntries([...new Set(sheet.cells.map((c) => c.item))].map((key) => [key, jobs[key]]));
    const result = captureScript<{ applied: typeof applied; paintMs: number; totalMs: number }>('paintSheet', { ...extra, sheet, items: jobItems, grounds: PHOTOSHOP_GROUND_RGB, file: join(dir, file) });
    // A randomness probe's copies are the same settings: the first read-back stands.
    for (const [key, options] of Object.entries(result.applied)) applied[key] ??= options;
    paintMs += result.paintMs;
    log(`photoshop: sheet ${i + 1}/${sheets.length} ${sheet.name}: ${sheet.cells.length} cells in ${(result.totalMs / 1000).toFixed(1)} s`);
    return { ...sheet, file };
  });
  return { sheets: written, applied, paintMs };
}

const blending = (colorSettings: Record<string, unknown>) => (colorSettings.RGBBlendGamma === true ? 'linear (gamma 1.0)' : 'gamma-encoded');

/** Each repeated cell's difference between its two paintings, keyed by item, mark and copy. */
function measureRepeats(dir: string, sheets: PhotoshopCaptureManifest['sheets']): NonNullable<PhotoshopCaptureManifest['repeatability']> {
  const paintings = (group: string) => sheets.filter((s) => s.group === group).flatMap((s) => {
    const pixels = readPhotoshopSheet(join(dir, s.file), s.width, s.height);
    return s.cells.map((cell) => ({ key: `${cell.item} / mark ${cell.index + 1} ${cell.mark}${cell.copy > 1 ? ` copy ${cell.copy}` : ''}`, pixels: cropPhotoshopCell(pixels, cell.box) }));
  });
  const a = paintings('repeat-a'), b = paintings('repeat-b');
  return Object.fromEntries(a.map((cell, i) => [cell.key, comparePhotoshopCells(cell.pixels, b[i].pixels)]));
}

export type PhotoshopProbeCaptureOptions = { dir: string; only?: readonly string[]; repeat?: readonly string[]; log: Log };

/** The rig sample a tip names, when it's sampled. */
const sampleOf = (tip: PhotoshopPreset['tip'] | undefined) => (tip?.kind === 'sampled' ? tip.sample : undefined);

/** Captures the probe set into `<dir>/<run>/`. */
export async function capturePhotoshopProbes({ dir: root, only, repeat = [], log }: PhotoshopProbeCaptureOptions): Promise<{ dir: string; manifest: PhotoshopCaptureManifest; restore: PhotoshopSettingsRestore }> {
  const started = new Date(), run = runId(started), dir = join(root, run);
  const probes = photoshopProbes();
  const sheets = planPhotoshopProbeCapture(probes, { only, repeat });
  mkdirSync(dir, { recursive: true });
  const rampFile = join(dir, 'ramp.png'), tipFile = join(dir, 'tip.png');
  writeGreyPng(rampFile, PHOTOSHOP_PROBE_RAMP.width, PHOTOSHOP_PROBE_RAMP.height, (x) => photoshopProbeRampValue(x), 16);
  // Photoshop's tips are dark where they paint.
  const tips = Object.entries(PHOTOSHOP_PROBE_SAMPLES).map(([name, sample]) => {
    const file = name === PHOTOSHOP_PROBE_TIP.name ? tipFile : join(dir, `${name}.png`);
    writeGreyPng(file, sample.width, sample.height, (x, y) => 1 - sample.paint(x, y), 8);
    return { name, file };
  });
  const cells = sheets.reduce((n, s) => n + s.cells.length, 0);
  log(`photoshop: ${probes.filter((p) => !only || only.includes(p.name)).length} probes, ${cells} cells on ${sheets.length} sheets into ${dir}`);

  // The manifest is written before the quit, beside the sheets already saved: a Photoshop that hangs on quit then
  // costs only the cleanup, not the capture.
  const { result: manifest, restore } = await withOwnedPhotoshop(`probes-${run}`, ({ version }) => {
    const assets = captureScript<{ colorSettings: Record<string, unknown> }>('defineProbeAssets', { rampFile, rampName: PHOTOSHOP_PROBE_RAMP.name, tips });
    const items = Object.fromEntries(probes.map((p) => [p.name, { reads: p.reads }]));
    const presets = Object.fromEntries(probes.map((p) => [p.name, p.preset]));
    const jobs = Object.fromEntries(Object.entries(presets).map(([key, preset]) => [key, { script: photoshopPresetScript(preset), samples: { tip: sampleOf(preset.tip), dual: sampleOf(preset.dual?.tip) } }]));
    const painted = paintSheets(dir, sheets, jobs, { rampName: PHOTOSHOP_PROBE_RAMP.name, tipNames: tips.map((t) => t.name) }, log);
    const finished = new Date(), total = (finished.getTime() - started.getTime()) / 1000;
    const probeManifest: PhotoshopCaptureManifest = {
      run, kind: 'probes', startedAt: started.toISOString(), finishedAt: finished.toISOString(),
      seconds: { total, paint: painted.paintMs / 1000, perCapture: total / cells },
      photoshop: { version, colorSettings: assets.colorSettings, blending: blending(assets.colorSettings) },
      document: PHOTOSHOP_CAPTURE_DOCUMENT,
      assets: { ramp: { ...PHOTOSHOP_PROBE_RAMP, file: basename(rampFile) }, tip: { ...PHOTOSHOP_PROBE_TIP, file: basename(tipFile) } },
      items: Object.fromEntries(Object.entries(painted.applied).map(([key, applied]) => {
        const mismatches = photoshopPresetMismatches(presets[key], applied);
        for (const line of mismatches) log(`photoshop: ${key} didn't take as asked: ${line}`);
        return [key, { ...items[key], applied, ...(mismatches.length ? { mismatches } : {}) }];
      })),
      sheets: painted.sheets,
      notCaptured: PHOTOSHOP_NOT_CAPTURED,
      ...(repeat.length ? { repeatability: measureRepeats(dir, painted.sheets) } : {}),
    };
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(probeManifest, null, 2)}\n`);
    return probeManifest;
  }, log);
  return { dir, manifest, restore };
}

export type PhotoshopReferenceCaptureOptions = { abr: string; stylesDir: string; style: string; pack: string; only?: readonly string[]; log: Log };

/** Loads `abr` into Photoshop and captures every brush in it (or `only` those) into the pack's reference/. */
export async function capturePhotoshopReferences({ abr, stylesDir, style, pack, only, log }: PhotoshopReferenceCaptureOptions): Promise<{ dir: string; manifest: PhotoshopCaptureManifest; restore: PhotoshopSettingsRestore }> {
  const started = new Date(), run = runId(started);
  const dir = join(stylesDir, style, 'brushes', pack, 'reference');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const { result: manifest, restore } = await withOwnedPhotoshop(`references-${run}`, ({ version }) => {
    const loaded = captureScript<{ loadMs: number; colorSettings: Record<string, unknown>; presets: { name: string; tipClass: string; diameter: number | null }[]; repeated: string[] }>('loadPackPresets', { abr });
    log(`photoshop: ${basename(abr)} loaded in ${loaded.loadMs} ms: ${loaded.presets.length} presets${loaded.repeated.length ? `, and ${loaded.repeated.length} repeating a name before them (not captured)` : ''}`);
    if (!loaded.presets.length) throw new Error(`photoshop: ${abr} holds no brush presets`);
    const missing = (only ?? []).filter((name) => !loaded.presets.some((p) => p.name === name));
    if (missing.length) throw new Error(`photoshop: ${basename(abr)} has no brush named ${missing.map((m) => JSON.stringify(m)).join(', ')}`);
    const brushes = loaded.presets.filter((p) => !only || only.includes(p.name)).map((p) => ({ key: p.name, preset: { name: p.name, nativeDiameter: p.diameter, ...photoshopReferenceSize(p.diameter) } }));
    const sheets = planPhotoshopReferenceCapture(brushes.map((b) => ({ key: b.key, diameter: b.preset.diameter })));
    const cells = sheets.reduce((n, s) => n + s.cells.length, 0);
    log(`photoshop: ${brushes.length} brushes, ${cells} cells on ${sheets.length} sheets into ${dir}`);
    const items = Object.fromEntries(brushes.map((b) => [b.key, { preset: b.preset }]));
    const painted = paintSheets(dir, sheets, items, {}, log);
    // Written before the quit, as for the probes.
    const finished = new Date(), total = (finished.getTime() - started.getTime()) / 1000;
    const referenceManifest: PhotoshopCaptureManifest = {
      run, kind: 'references', startedAt: started.toISOString(), finishedAt: finished.toISOString(),
      seconds: { total, paint: painted.paintMs / 1000, perCapture: total / cells },
      photoshop: { version, colorSettings: loaded.colorSettings, blending: blending(loaded.colorSettings) },
      document: PHOTOSHOP_CAPTURE_DOCUMENT,
      source: { abr: basename(abr), pack, style },
      items: Object.fromEntries(Object.entries(painted.applied).map(([key, applied]) => [key, { ...items[key], applied }])),
      sheets: painted.sheets,
      notCaptured: PHOTOSHOP_NOT_CAPTURED,
      ...(loaded.repeated.length ? { repeatedNames: loaded.repeated } : {}),
    };
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(referenceManifest, null, 2)}\n`);
    return referenceManifest;
  }, log);
  return { dir, manifest, restore };
}

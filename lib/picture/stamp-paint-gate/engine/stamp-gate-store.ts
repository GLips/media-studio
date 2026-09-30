// stamp-gate-store.ts: the GPU gate's accepted baselines and the candidates that may replace them. A store is a
// folder: the public one harness/fixtures/stamp-paint/, a private one under work/validation/stamp-paint/. Each
// baseline is a file named by its ID (formula/<name>.f32, painting/<id>.png) and an entry in manifest.json saying
// what inputs it was accepted for, the hash of its bytes, why, when, over which commit and on which GPU.
//
// A baseline is never written by a run. `update` writes candidates beside it, in candidates/ (ignored), with their
// numeric and visual differences; `accept` replaces the baselines with them, only the IDs named, all or none.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { stampGateFrameDiffImage } from '../models/stamp-gate-frames.ts';

/** Where the public baselines live, beside the harness that runs them. */
export const STAMP_GATE_PUBLIC_STORE = new URL('../../../../harness/fixtures/stamp-paint/', import.meta.url).pathname;

/**
 * A baseline's provenance: its file, the sha256 of its bytes (`output`) and of the inputs it was drawn from, why it
 * was accepted, the day, the commit it was accepted over (its parent, as the accepting commit doesn't exist yet) and
 * the GPU it was drawn on.
 */
export type StampGateBaseline = { file: string; output: string; inputs: string; reason: string; accepted: string; acceptedOver: string; adapter: string };
type StampGateManifest = { baselines: Record<string, StampGateBaseline> };
/** What `update` writes beside a candidate's file, and `accept` records. */
type StampGateCandidateMeta = { file: string; output: string; inputs: string; reason: string; comparison: string; adapter: string };

/** What a subject produced: a formula's values, or a frame as RGB bytes. */
export type StampGateOutput = { kind: 'values'; values: Float32Array } | { kind: 'frame'; rgb: Uint8Array; width: number; height: number };

/** A frame from the page's RGB bytes; throws unless there are exactly `width` × `height` pixels of them. */
export function stampGateFrame(rgb: Uint8Array, width: number, height: number): StampGateOutput {
  if (rgb.length !== width * height * 3) throw new Error(`stamp gate: a ${width} × ${height} frame came back as ${rgb.length} bytes`);
  return { kind: 'frame', rgb, width, height };
}

export const stampGateInputsHash = (inputs: string | Uint8Array) => createHash('sha256').update(inputs).digest('hex');

const manifestPath = (store: string) => join(store, 'manifest.json');
const extension = (output: StampGateOutput) => (output.kind === 'values' ? 'f32' : 'png');
const candidateDir = (store: string) => join(store, 'candidates');
const fileHash = (file: string) => stampGateInputsHash(readFileSync(file));

const BASELINE_FIELDS = ['file', 'output', 'inputs', 'reason', 'accepted', 'acceptedOver', 'adapter'] as const;
const CANDIDATE_FIELDS = ['file', 'output', 'inputs', 'reason', 'comparison', 'adapter'] as const;

/** Whether `value`, parsed JSON, is an object holding a string under each of `names`. */
function hasStringFields<const K extends string>(value: unknown, names: readonly K[]): value is Record<K, string> {
  if (typeof value !== 'object' || value === null) return false;
  const fields = new Map<string, unknown>(Object.entries(value));
  for (const name of names) if (typeof fields.get(name) !== 'string') return false;
  return true;
}

/** Whether `value`, a parsed manifest.json, holds a baseline of every field under each ID. */
function isStampGateManifest(value: unknown): value is StampGateManifest {
  if (typeof value !== 'object' || value === null || !('baselines' in value)) return false;
  const { baselines } = value;
  if (typeof baselines !== 'object' || baselines === null) return false;
  for (const entry of Object.values(baselines)) if (!hasStringFields(entry, BASELINE_FIELDS)) return false;
  return true;
}

export function readStampGateManifest(store: string): StampGateManifest {
  if (!existsSync(manifestPath(store))) return { baselines: {} };
  const manifest: unknown = JSON.parse(readFileSync(manifestPath(store), 'utf8'));
  if (!isStampGateManifest(manifest)) throw new Error(`stamp gate: ${manifestPath(store)} isn't a manifest: each baseline needs ${BASELINE_FIELDS.join(', ')}`);
  return manifest;
}

function readRgbPng(file: string, width: number, height: number): Uint8Array {
  const rgb = runFfmpeg(['-nostdin', '-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1 << 28 });
  if (rgb.length !== width * height * 3) throw new Error(`stamp gate: ${file} isn't ${width} × ${height}`);
  return new Uint8Array(rgb.buffer, rgb.byteOffset, rgb.length);
}

function writeRgbPng(file: string, rgb: Uint8Array, width: number, height: number) {
  mkdirSync(dirname(file), { recursive: true });
  runFfmpeg(['-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-i', 'pipe:0', '-frames:v', '1', file], { input: rgb });
}

/**
 * `id`'s accepted output shaped like `like`, and its provenance; null when it has none. Throws when the file's bytes
 * aren't the ones accepted: a baseline changes only through `accept`.
 */
export function readStampGateBaseline(store: string, id: string, like: StampGateOutput): { output: StampGateOutput; baseline: StampGateBaseline } | null {
  const baseline = readStampGateManifest(store).baselines[id];
  if (!baseline) return null;
  const file = join(store, baseline.file);
  if (fileHash(file) !== baseline.output) throw new Error(`stamp gate: ${file} isn't the file accepted as ${id} (${baseline.accepted}); a baseline changes only by update and accept`);
  if (like.kind === 'values') {
    const bytes = readFileSync(file);
    return { output: { kind: 'values', values: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)) }, baseline };
  }
  return { output: { ...like, rgb: readRgbPng(file, like.width, like.height) }, baseline };
}

function writeOutput(file: string, output: StampGateOutput) {
  mkdirSync(dirname(file), { recursive: true });
  if (output.kind === 'values') writeFileSync(file, new Uint8Array(output.values.buffer, output.values.byteOffset, output.values.byteLength));
  else writeRgbPng(file, output.rgb, output.width, output.height);
}

/**
 * Writes `output` as `id`'s candidate, with `inputs`' hash, the `reason`, how it compares to the baseline
 * (`comparison`) and the `adapter` it was drawn on, and for a frame the difference from the baseline's as an image;
 * returns the files written.
 */
export function writeStampGateCandidate(store: string, id: string, output: StampGateOutput, { inputs, reason, comparison, adapter }: Omit<StampGateCandidateMeta, 'file' | 'output'>): string[] {
  const dir = candidateDir(store), name = `${id}.${extension(output)}`, file = join(dir, name), meta = join(dir, `${id}.json`);
  writeOutput(file, output);
  const written: StampGateCandidateMeta = { file: name, output: fileHash(file), inputs, reason, comparison, adapter };
  writeFileSync(meta, `${JSON.stringify(written, null, 2)}\n`);
  const baseline = readStampGateBaseline(store, id, output);
  if (output.kind === 'values' || baseline?.output.kind !== 'frame') return [file, meta];
  const diff = join(dir, `${id}.diff.png`);
  writeRgbPng(diff, stampGateFrameDiffImage(output.rgb, baseline.output.rgb), output.width, output.height);
  return [file, meta, diff];
}

const today = () => new Date().toISOString().slice(0, 10);
const headCommit = (store: string) => execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: store, encoding: 'utf8' }).trim();

/**
 * Replaces each of `ids`' baselines with its candidate, recording its provenance. Every candidate is read and checked
 * before any baseline is touched, so a missing or altered candidate, or an ID named twice, changes nothing.
 */
export function acceptStampGateCandidates(store: string, ids: readonly string[]): string[] {
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (twice.length) throw new Error(`stamp gate: ${twice.join(', ')} named twice`);
  const dir = candidateDir(store);
  const candidates = ids.map((id) => {
    const metaFile = join(dir, `${id}.json`);
    if (!existsSync(metaFile)) throw new Error(`stamp gate: ${id} has no candidate in ${dir}; run update first`);
    const meta: unknown = JSON.parse(readFileSync(metaFile, 'utf8'));
    if (!hasStringFields(meta, CANDIDATE_FIELDS)) throw new Error(`stamp gate: ${metaFile} needs ${CANDIDATE_FIELDS.join(', ')}; run update again`);
    if (fileHash(join(dir, meta.file)) !== meta.output) throw new Error(`stamp gate: ${join(dir, meta.file)} changed since update wrote it`);
    return { id, metaFile, meta };
  });
  const manifest = readStampGateManifest(store), acceptedOver = headCommit(store), accepted = today();
  for (const { id, metaFile, meta: { file, output, inputs, reason, adapter } } of candidates) {
    mkdirSync(dirname(join(store, file)), { recursive: true });
    renameSync(join(dir, file), join(store, file));
    rmSync(metaFile);
    rmSync(join(dir, `${id}.diff.png`), { force: true });
    manifest.baselines[id] = { file, output, inputs, reason, accepted, acceptedOver, adapter };
  }
  const sorted = Object.fromEntries(Object.entries(manifest.baselines).toSorted(([a], [b]) => a.localeCompare(b)));
  // Written aside and renamed over, so the manifest is never half written.
  writeFileSync(`${manifestPath(store)}.next`, `${JSON.stringify({ baselines: sorted }, null, 2)}\n`);
  renameSync(`${manifestPath(store)}.next`, manifestPath(store));
  return candidates.map(({ meta }) => meta.file);
}

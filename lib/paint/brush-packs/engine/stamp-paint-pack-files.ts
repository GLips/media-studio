// stamp-paint-pack-files.ts: how a pack lives in work/styles/<style>/brushes/<pack>/, written by every brush importer
// (import-procreate-pack.ts, import-photoshop-pack.ts) and read by everything that paints with one. An import writes
// a whole generation, generations/<id>/ (the manifest and every image it lists), then renames `current` over the old
// pointer to name it, so a reader sees one generation whole or the one before. Everything else in the pack's folder
// (a sheet's fidelity/, Photoshop's reference/) sits beside the generations and outlives them. Also here: brush images
// written as downsized grey PNGs, and the archive's hash.

import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { runFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { parseStudioProcessName, studioProcessName, studioProcessRunning, thisStudioProcess, type StudioProcessIdentity } from '#lib/platform/process/engine/studio-process.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { readStampPaintPack, STAMP_PAINT_PACK_MANIFEST, type StampPaintPack } from '../models/stamp-paint-pack.ts';

/** The file in a pack's folder naming its current generation, and the folder its generations sit in. */
export const STAMP_PACK_CURRENT = 'current', STAMP_PACK_GENERATIONS = 'generations';

/**
 * The folder of `packDir`'s current generation, where its manifest and images are; undefined when it isn't imported.
 * A pack from before generations, its manifest straight in its folder, reads as not imported: import it again.
 */
export function stampPaintPackGenerationDir(packDir: string): string | undefined {
  const pointer = join(packDir, STAMP_PACK_CURRENT);
  return existsSync(pointer) ? join(packDir, STAMP_PACK_GENERATIONS, readFileSync(pointer, 'utf8').trim()) : undefined;
}

/**
 * The pack imported into `packDir`: its current generation's folder, resolved once so every file read from it is of
 * one import, and its manifest read through readStampPaintPack. Throws naming the folder when it isn't imported.
 */
export function readStampPaintPackGeneration(packDir: string): { dir: string; manifest: StampPaintPack } {
  const read = readImportedStampPaintPack(packDir);
  if (!read) throw new Error(`${packDir} isn't imported; run studio brushes import first`);
  return read;
}

/**
 * An imported pack as a browser page over the styles folder reads it (the fidelity sheet, the studies, the gate):
 * its folder (where its fidelity/ and reference/ are), its current generation's folder and manifest, resolved once,
 * and that generation's URL under the styles folder, served at /files/.
 */
export type ServedStampPaintPack = { packDir: string; dir: string; manifest: StampPaintPack; url: string };

/** `style`'s pack `pack` in `stylesDir`, read as ServedStampPaintPack; throws as readStampPaintPackGeneration does. */
export function readServedStampPaintPack(stylesDir: string, style: string, pack: string): ServedStampPaintPack {
  const packDir = join(stylesDir, style, 'brushes', pack), { dir, manifest } = readStampPaintPackGeneration(packDir);
  return { packDir, dir, manifest, url: `/files/${relative(stylesDir, dir).split(sep).join('/')}` };
}

/** As readStampPaintPackGeneration, but undefined for a pack that isn't imported. */
export function readImportedStampPaintPack(packDir: string): { dir: string; manifest: StampPaintPack } | undefined {
  const dir = stampPaintPackGenerationDir(packDir);
  if (!dir) return undefined;
  const file = join(dir, STAMP_PAINT_PACK_MANIFEST);
  try {
    return { dir, manifest: readStampPaintPack(JSON.parse(readFileSync(file, 'utf8'))) };
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}; import it again with studio brushes import`, { cause: error });
  }
}

/** The pack imported into `packDir`, for a reader of its manifest alone (readStampPaintPackGeneration). */
export const readStampPaintPackDir = (packDir: string): StampPaintPack => readStampPaintPackGeneration(packDir).manifest;

/** Where a pack lives: `<stylesDir>/<style>/brushes/<pack>/`. */
export type StampPaintPackPlace = { stylesDir: string; style: string; pack: string };
export type ImportStampPaintPackOptions = StampPaintPackPlace & { archive: string };

/** `place`'s folder. */
export const stampPaintPackDir = ({ stylesDir, style, pack }: StampPaintPackPlace) => join(stylesDir, style, 'brushes', pack);

/** A brush's or paper's name as a file name: lowercase letters, digits and dashes; empty for a name in another script. */
export const stampPackSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function fitWithin(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A filesystem error's code (ENOENT, EEXIST…); undefined for anything else thrown. */
const fsErrorCode = (error: unknown) => (error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined);

/**
 * The import holding a lock whose text is `text` (`<pid>-<started> <uuid>`), while it runs; undefined once it's gone,
 * and for a lock naming no process.
 */
function runningLockHolder(text: string): StudioProcessIdentity | undefined {
  const holder = parseStudioProcessName(text.split(' ')[0]);
  return holder && studioProcessRunning(holder) ? holder : undefined;
}

/**
 * Takes `lock` from a dead holder, or says who holds it. Renamed away first, so of two takers one rename wins and the
 * other retries. What was renamed may turn out live (another taker locked between our read and rename): it's linked
 * back, which fails rather than overwrite a newer lock.
 */
function takeOverStaleStampPackLock(lock: string, pack: string) {
  let text: string;
  try {
    text = readFileSync(lock, 'utf8');
  } catch (error) {
    if (fsErrorCode(error) === 'ENOENT') return;
    throw error;
  }
  const holding = runningLockHolder(text);
  if (holding) throw new Error(`brushes import: process ${holding.pid} is importing into ${pack} now (${lock})`);
  const taken = `${lock}.stale-${randomUUID()}`;
  try {
    renameSync(lock, taken);
  } catch (error) {
    if (fsErrorCode(error) === 'ENOENT') return;
    throw error;
  }
  const holder = runningLockHolder(readFileSync(taken, 'utf8'));
  if (holder) {
    try {
      linkSync(taken, lock);
    } finally {
      rmSync(taken, { force: true });
    }
    throw new Error(`brushes import: process ${holder.pid} is importing into ${pack} now (${lock})`);
  }
  rmSync(taken, { force: true });
}

/**
 * Holds `brushes/.<pack>.lock` while `body` runs, so two imports into one pack can't interleave their publishing. It's
 * made exclusively (O_EXCL); a lock whose process has gone (a killed import) is taken over, one held by a live process
 * refuses. Released only while it's still this import's.
 */
async function withStampPackLock<T>(brushesDir: string, pack: string, body: () => Promise<T>): Promise<T> {
  mkdirSync(brushesDir, { recursive: true });
  const lock = join(brushesDir, `.${pack}.lock`), mine = `${studioProcessName(thisStudioProcess())} ${randomUUID()}`;
  for (;;) {
    try {
      writeFileSync(lock, mine, { flag: 'wx' });
      break;
    } catch (error) {
      if (fsErrorCode(error) !== 'EEXIST') throw error;
      takeOverStaleStampPackLock(lock, pack);
    }
  }
  try {
    return await body();
  } finally {
    if (existsSync(lock) && readFileSync(lock, 'utf8') === mine) rmSync(lock, { force: true });
  }
}

/** A new generation's folder name: sorts by when it was written, and never repeats. */
const stampPackGenerationName = () => `${new Date().toISOString().replace(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`;

/** Refuses an archive an import can't read from: missing, or among the generations an import replaces. */
export function checkStampPaintPackArchive({ archive, ...place }: ImportStampPaintPackOptions) {
  if (!existsSync(archive)) throw new Error(`brushes import: ${archive} doesn't exist`);
  const generations = join(stampPaintPackDir(place), STAMP_PACK_GENERATIONS);
  if (resolve(archive).startsWith(`${resolve(generations)}${sep}`)) throw new Error(`brushes import: ${archive} is inside ${generations}, which an import replaces; keep the pack elsewhere`);
}

/**
 * Runs `write` into a new generation's folder, then names it `current` by one rename: a reader sees the previous import
 * or the new one whole, and a failed import leaves the previous one current. Older generations go after the switch, as
 * far as they can; one left behind is never current again.
 */
export async function replaceStampPaintPack<T>(place: StampPaintPackPlace, write: (generation: string) => T | Promise<T>): Promise<T & { dir: string }> {
  const { style, pack } = place;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pack) || !/^[a-z0-9][a-z0-9-]*$/.test(style)) throw new Error('brushes import: --style and --pack are lowercase names: letters, digits and dashes');
  const dir = stampPaintPackDir(place), brushesDir = join(dir, '..'), generations = join(dir, STAMP_PACK_GENERATIONS);
  return withStampPackLock(brushesDir, pack, async () => {
    const name = stampPackGenerationName(), generation = join(generations, name), pointer = join(dir, `.${STAMP_PACK_CURRENT}-${name}`);
    mkdirSync(generation, { recursive: true });
    let written: T;
    try {
      written = await write(generation);
      writeFileSync(pointer, `${name}\n`);
      renameSync(pointer, join(dir, STAMP_PACK_CURRENT));
    } catch (error) {
      rmSync(pointer, { force: true });
      rmSync(generation, { recursive: true, force: true });
      throw error;
    }
    for (const old of readdirSync(generations).filter((entry) => entry !== name)) {
      try {
        rmSync(join(generations, old), { recursive: true, force: true });
      } catch {
        // Best effort, by design: the switch has happened, and the next import deletes what's left.
      }
    }
    return { dir, ...written };
  });
}

/** A PNG's size, from its IHDR chunk. */
const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

/** A brush image from a PNG as a grey PNG, downsized to fit `max` and negated when asked (to make dark paint). */
export function writeStampPackPng(png: Buffer, max: number, negate: boolean, out: string) {
  const { width, height } = fitWithin(pngSize(png).width, pngSize(png).height, max);
  withStudioTemp('brush-image', (dir) => {
    writeFileSync(join(dir, 'in.png'), png);
    const filters = [`scale=${width}:${height}:flags=area`, 'format=gray', ...(negate ? ['negate'] : [])].join(',');
    runFfmpeg(['-nostdin', '-v', 'error', '-i', join(dir, 'in.png'), '-vf', filters, '-y', out]);
  });
}

/** A brush image from grey pixels, row by row, as a grey PNG: mirrored and negated when asked, downsized to fit `max`. */
export function writeStampPackGray(
  image: { width: number; height: number; pixels: Uint8Array }, max: number, out: string, { negate = false, flipX = false, flipY = false } = {},
) {
  const { width, height } = fitWithin(image.width, image.height, max);
  withStudioTemp('brush-image', (dir) => {
    writeFileSync(join(dir, 'in.raw'), image.pixels);
    const filters = [...(flipX ? ['hflip'] : []), ...(flipY ? ['vflip'] : []), `scale=${width}:${height}:flags=area`, ...(negate ? ['negate'] : [])].join(',');
    runFfmpeg(['-nostdin', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${image.width}x${image.height}`, '-i', join(dir, 'in.raw'), '-vf', filters, '-y', out]);
  });
}

// stamp-paint-pack-files.ts: what every brush importer (import-procreate-pack.ts, import-photoshop-pack.ts) does to
// write a pack into work/styles/<style>/brushes/<pack>/: check the names, stage what it writes and swap that in only
// once it's whole, leaving the rest of the folder be, write brush images as downsized grey PNGs, and hash the archive
// it came from; and how the rigs read a pack back (readStampPaintPackDir).

import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { runFfmpeg } from '#lib/output/ffmpeg/engine/ffmpeg.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { readStampPaintPack, STAMP_PAINT_PACK_MANIFEST, type StampPaintPack } from '../models/stamp-paint-pack.ts';

/** The pack imported into `packDir`, read through readStampPaintPack; throws naming the folder when it isn't imported. */
export function readStampPaintPackDir(packDir: string): StampPaintPack {
  const file = join(packDir, STAMP_PAINT_PACK_MANIFEST);
  if (!existsSync(file)) throw new Error(`${packDir} isn't imported; run studio brushes import first`);
  try {
    return readStampPaintPack(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    throw new Error(`${file}: ${(error as Error).message}; import it again with studio brushes import`);
  }
}

/** Longest side of each stored image, in pixels: tips stamp at a few hundred, grains tile, papers span a frame. */
export const STAMP_PACK_TIP_MAX = 512, STAMP_PACK_GRAIN_MAX = 1024, STAMP_PACK_PAPER_MAX = 2560;

export type ImportStampPaintPackOptions = { archive: string; stylesDir: string; style: string; pack: string };

/** A brush's or paper's name as a file name: lowercase letters, digits and dashes; empty for a name in another script. */
export const stampPackSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function sha256OfFile(file: string): string {
  const hash = createHash('sha256'), fd = openSync(file, 'r'), chunk = Buffer.alloc(1 << 22);
  for (let read; (read = readSync(fd, chunk, 0, chunk.length, null)) > 0;) hash.update(chunk.subarray(0, read));
  closeSync(fd);
  return hash.digest('hex');
}

export function fitWithin(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * What an importer writes into a pack's folder, of either app, and all an import replaces. The rest stays: a sheet's
 * fidelity/, a pack's Photoshop reference/ captures (npm run photoshop -- references), anything else put beside them.
 */
const STAMP_PACK_IMPORTED = ['tips', 'grains', 'previews', 'papers', STAMP_PAINT_PACK_MANIFEST];

/** Whether process `pid` still runs; signal 0 only asks. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Holds `brushes/.<pack>.lock` while `body` runs, so two imports into one pack can't interleave their swaps. A lock
 * whose process has gone (a killed import) is taken over; one held by a live process refuses.
 */
function withStampPackLock<T>(brushesDir: string, pack: string, body: () => T): T {
  mkdirSync(brushesDir, { recursive: true });
  const lock = join(brushesDir, `.${pack}.lock`);
  for (;;) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = Number(readFileSync(lock, 'utf8'));
      if (processAlive(holder)) throw new Error(`brushes import: process ${holder} is importing into ${pack} now (${lock})`);
      rmSync(lock, { force: true });
    }
  }
  try {
    return body();
  } finally {
    rmSync(lock, { force: true });
  }
}

/**
 * Runs `write` into a staging folder of its own beside the pack's, and swaps what it wrote in only once `write`
 * returns, so an import that fails leaves the previous one whole; the pack's lock keeps two imports from swapping at
 * once. Every entry of STAMP_PACK_IMPORTED goes, even one this import didn't write (a Procreate pack's previews/ when
 * a Photoshop file is imported over it). Refuses an archive kept among those entries, which the swap would delete.
 */
export function replaceStampPaintPack<T>({ archive, stylesDir, style, pack }: ImportStampPaintPackOptions, write: (staging: string) => T): T & { dir: string } {
  if (!existsSync(archive)) throw new Error(`brushes import: ${archive} doesn't exist`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pack) || !/^[a-z0-9][a-z0-9-]*$/.test(style)) throw new Error('brushes import: --style and --pack are lowercase names: letters, digits and dashes');
  const brushesDir = join(stylesDir, style, 'brushes'), dir = join(brushesDir, pack);
  const replaced = (entry: string) => resolve(archive) === resolve(dir, entry) || resolve(archive).startsWith(`${resolve(dir, entry)}${sep}`);
  if (STAMP_PACK_IMPORTED.some(replaced)) throw new Error(`brushes import: ${archive} is inside ${dir}, among what an import replaces; keep the pack elsewhere`);
  // Beside the pack, not in the studio's temp folder, so each entry renames into place on one volume.
  const staging = join(brushesDir, `.${pack}.importing-${randomUUID()}`);
  return withStampPackLock(brushesDir, pack, () => {
    mkdirSync(staging);
    return swapStagedPack(dir, staging, write);
  });
}

function swapStagedPack<T>(dir: string, staging: string, write: (staging: string) => T): T & { dir: string } {
  try {
    const written = write(staging);
    const unknown = readdirSync(staging).filter((entry) => !STAMP_PACK_IMPORTED.includes(entry));
    if (unknown.length) throw new Error(`brushes import: wrote ${unknown.join(', ')}, which STAMP_PACK_IMPORTED doesn't list, so a later import wouldn't replace it`);
    mkdirSync(dir, { recursive: true });
    for (const entry of STAMP_PACK_IMPORTED) rmSync(join(dir, entry), { recursive: true, force: true });
    for (const entry of readdirSync(staging)) renameSync(join(staging, entry), join(dir, entry));
    return { dir, ...written };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
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

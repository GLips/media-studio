// stamp-paint-pack-files.ts: what every brush importer (import-procreate-pack.ts, import-photoshop-pack.ts) does to
// write a pack into work/styles/<style>/brushes/<pack>/: check the names, stage the new folder and swap it in only once
// it's whole, write brush images as downsized grey PNGs, and hash the archive it came from.

import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { runFfmpeg } from '#lib/output/ffmpeg/engine/ffmpeg.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';

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
 * Runs `write` into a staging folder beside the pack's, and swaps it in only once `write` returns, so an import that
 * fails leaves the previous one whole. Refuses an archive kept inside the pack's folder, which the swap would delete.
 */
export function replaceStampPaintPack<T>({ archive, stylesDir, style, pack }: ImportStampPaintPackOptions, write: (staging: string) => T): T & { dir: string } {
  if (!existsSync(archive)) throw new Error(`brushes import: ${archive} doesn't exist`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pack) || !/^[a-z0-9][a-z0-9-]*$/.test(style)) throw new Error('brushes import: --style and --pack are lowercase names: letters, digits and dashes');
  const dir = join(stylesDir, style, 'brushes', pack), staging = join(stylesDir, style, 'brushes', `.${pack}.importing`);
  if (resolve(archive).startsWith(`${resolve(dir)}${sep}`)) throw new Error(`brushes import: ${archive} is inside ${dir}, which an import replaces; keep the pack elsewhere`);
  rmSync(staging, { recursive: true, force: true });
  try {
    const written = write(staging);
    rmSync(dir, { recursive: true, force: true });
    renameSync(staging, dir);
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

// contact-sheet.ts: images tiled into one labelled sheet, for looking over many frames at once.
//
// sharp draws it, not ffmpeg: ffmpeg's drawtext needs a build with freetype, which Homebrew's plain `ffmpeg` lacks,
// and sharp's own libvips renders an SVG label's text wherever it installs.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';

const LABEL_STRIP = 28;
const BACKDROP = { r: 0x22, g: 0x22, b: 0x22 };

/**
 * Tiles `cells` left to right, `cols` a row, each scaled to `w`×`h` with its label in a strip above it, into `out`
 * (a JPEG).
 */
export async function tileLabelledImages(cells: readonly { file: string; label: string }[], out: string, { cols, w, h }: { cols: number; w: number; h: number }) {
  if (!cells.length) throw new Error(`no images to tile into ${out}`);
  const rows = Math.ceil(cells.length / cols), cellH = h + LABEL_STRIP;
  const layers = await Promise.all(cells.map(async (cell, i) => {
    const left = (i % cols) * w, top = Math.floor(i / cols) * cellH;
    const image = await sharp(cell.file).resize(w, h, { fit: 'fill' }).toBuffer();
    return [{ input: labelSvg(cell.label, w), left, top }, { input: image, left, top: top + LABEL_STRIP }];
  }));
  mkdirSync(dirname(out), { recursive: true });
  await sharp({ create: { width: Math.min(cols, cells.length) * w, height: rows * cellH, channels: 3, background: BACKDROP } })
    .composite(layers.flat()).jpeg({ quality: 85 }).toFile(out);
  return out;
}

const labelSvg = (label: string, w: number) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${LABEL_STRIP}"><text x="8" y="20" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#eeeeee">${escapeXml(label)}</text></svg>`);

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

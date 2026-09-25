// contact-sheet.ts: images tiled into one labelled sheet with ffmpeg, for looking over many frames at once.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runFfmpeg } from './ffmpeg.ts';

const LABEL_STRIP = 28;

/**
 * Tiles `cells` left to right, `cols` a row, each scaled to `w`×`h` with its label in a strip above it, into `out`
 * (a JPEG). `h` should be even: ffmpeg pads 4:2:0 JPEG frames to even sizes, and a mismatch fails the layout.
 */
export function tileLabelledImages(cells: readonly { file: string; label: string }[], out: string, { cols, w, h }: { cols: number; w: number; h: number }) {
  if (!cells.length) throw new Error(`no images to tile into ${out}`);
  const filters = cells.map((c, i) => `[${i}:v]scale=${w}:${h},pad=${w}:${h + LABEL_STRIP}:0:${LABEL_STRIP}:color=0x222222,` +
    `drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='${escapeDrawtext(c.label)}':x=8:y=5:fontsize=18:fontcolor=0xeeeeee[c${i}]`);
  const layout = cells.map((_, i) => `${(i % cols) * w}_${Math.floor(i / cols) * (h + LABEL_STRIP)}`).join('|');
  const stack = cells.length === 1 ? `[c0]copy[out]` :
    `${cells.map((_, i) => `[c${i}]`).join('')}xstack=inputs=${cells.length}:layout=${layout}:fill=0x222222[out]`;
  mkdirSync(dirname(out), { recursive: true });
  runFfmpeg(['-y', '-loglevel', 'error', ...cells.flatMap((c) => ['-i', c.file]),
    '-filter_complex', `${filters.join(';')};${stack}`, '-map', '[out]', '-frames:v', '1', '-q:v', '3', out]);
  return out;
}

// drawtext reads ':' as an option separator and '\' and "'" as escapes, inside a filtergraph that reads ',' and ';'.
const escapeDrawtext = (text: string) => text.replace(/[\\':,;%]/g, (c) => (c === "'" ? '’' : c === '%' ? '\\%' : `\\${c}`));

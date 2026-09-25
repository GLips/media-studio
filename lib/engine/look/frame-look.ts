// frame-look.ts: `studio look`'s frames, from the composition or a rendered video: a labelled sheet of chosen frames,
// before/after pairs against another render with a count of the pixels that really changed, and a stretch's motion.
// Each source is decoded once per command: one ffmpeg pass selects every frame the command needs, however many.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { tileLabelledImages } from '../ffmpeg/contact-sheet.ts';
import { formatFrameMotion, type BarClock } from './frame-motion.ts';
import type { RenderSession } from '../render/render-session.ts';
import { runFfmpeg, runFfprobe } from '../ffmpeg/ffmpeg.ts';

export type LookSource =
  | { kind: 'composition'; session: RenderSession; captions: boolean }
  /** A render; its first frame is the project's frame `startsAt` (0 for a whole video, a bar's first for a bar alone). */
  | { kind: 'video'; file: string; startsAt: number };

/** How ffmpeg reads a source's chosen frames in order: its input args, the filter chain after it, and any rendered stills' dir. */
type LookInput = { args: string[]; chain: string; dir?: string };

/** A region of the frame, in the source's pixels. */
export type LookCrop = { x: number; y: number; w: number; h: number };

/**
 * A pixel really changed when its luma moves more than this (of 255). Two renders of the same code aren't bit for bit
 * alike: edges jitter a fraction of a pixel and the encoder follows, moving a region's mean luma by up to 0.6, but no
 * pixel by a fifth of full contrast.
 */
export const CHANGED_LUMA_STEP = 48;
/** A frame counts as changed when over this share (per mille) of its region changed; less is edge noise. */
const CHANGED_PER_MILLE = 0.1;
/** Most tiles a plain sheet holds, and most before/after rows a comparison shows (its most changed frames). */
const MAX_SHEET_TILES = 60, MAX_AGAINST_ROWS = 12;
/**
 * Selected frames are renumbered 0, 1, 2… at this rate before two sources meet, so ffmpeg pairs the k-th selected frame
 * of each whatever their own rates and frame numbers. Any rate does; it never reaches an output.
 */
const PAIRING_RATE = 30;

/** Frames: `200:210` (inclusive), `200:260:5` (every 5th) or `161,176,191`. */
export function parseLookFrames(spec: string): number[] {
  const range = spec.split(':');
  const frames = range.length > 1 ? stepFrames(range.map(parseLookNumber)) : spec.split(',').map(parseLookNumber);
  if (!frames.length || !frames.every((f) => Number.isInteger(f) && f >= 0)) {
    throw new Error(`frames are whole numbers, like 200:210, 200:260:5 or 161,176,191, not ${spec}`);
  }
  return [...new Set(frames)].sort((a, b) => a - b);
}

/** A number from a comma or colon list; an empty item is NaN, where Number('') would quietly make it 0. */
export const parseLookNumber = (item: string) => (item.trim() ? Number(item) : NaN);

function stepFrames([from, to, step = 1, ...rest]: number[]): number[] {
  if (rest.length || !(step >= 1 && from <= to)) return [NaN];
  return Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
}

export function parseLookCrop(spec: string): LookCrop {
  const [x, y, w, h, ...rest] = spec.split(',').map(Number);
  if (rest.length || ![x, y, w, h].every((n) => Number.isInteger(n) && n >= 0) || !(w > 0 && h > 0)) {
    throw new Error(`--crop is x,y,w,h in the video's pixels, like 0,120,1920,840, not ${spec}`);
  }
  return { x, y, w, h };
}

/** A source opened for reading frames: its rate and size, the project frames it holds, and a one-pass decoder. */
export type OpenLookSource = Awaited<ReturnType<typeof openLookSource>>;

export async function openLookSource(source: LookSource) {
  if (source.kind === 'composition') {
    const { session, captions } = source, props = session.props({ captions });
    const composition = await session.compositionFor(props);
    return {
      name: 'composition', fps: composition.fps, width: composition.width, height: composition.height, first: 0, end: composition.durationInFrames,
      /** Renders `frames` `w` wide; the ffmpeg input that reads them in order. */
      async input(frames: number[], w: number): Promise<LookInput> {
        const stills = await session.renderStills(frames, { w, captions });
        // Numbered in order for image2's sequence pattern: ffmpeg builds without glob support are common.
        frames.forEach((f, i) => renameSync(stills.fileFor(f), join(stills.dir, `${String(i).padStart(5, '0')}.jpg`)));
        return { args: ['-framerate', String(PAIRING_RATE), '-i', join(stills.dir, '%05d.jpg')], chain: `settb=1/${PAIRING_RATE},setpts=N`, dir: stills.dir };
      },
    };
  }
  const { file, startsAt } = source;
  const [width, height, rate, count] = runFfprobe(['-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_read_packets', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().split(',');
  const [num, den] = rate.split('/').map(Number);
  return {
    name: basename(file), fps: num / den, width: Number(width), height: Number(height), first: startsAt, end: startsAt + Number(count),
    async input(frames: number[]): Promise<LookInput> {
      return { args: ['-i', file], chain: `select=${selectFrames(frames.map((f) => f - startsAt))},settb=1/${PAIRING_RATE},setpts=N` };
    },
  };
}

/** An ffmpeg select expression for these (sorted) frame numbers, a between() for each consecutive run. */
function selectFrames(frames: number[]): string {
  const runs: [number, number][] = [];
  for (const f of frames) {
    const last = runs.at(-1);
    if (last && f === last[1] + 1) last[1] = f;
    else runs.push([f, f]);
  }
  return runs.map(([a, b]) => (a === b ? `eq(n\\,${a})` : `between(n\\,${a}\\,${b})`)).join('+');
}

function checkFramesIn(source: OpenLookSource, frames: number[]) {
  const outside = frames.filter((f) => f < source.first || f >= source.end);
  if (outside.length) throw new Error(`${source.name} holds frames ${source.first}–${source.end - 1}, not ${outside.slice(0, 5).join(', ')}${outside.length > 5 ? '…' : ''}`);
}

const cropFilter = (crop?: LookCrop) => (crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` : '');
const evenHeight = (w: number, region: { w: number; h: number }) => 2 * Math.round((w * region.h) / region.w / 2);
const frameLabel = (f: number, fps: number) => `${f} · ${(f / fps).toFixed(2)}s`;

function runFilterGraph(inputs: { args: string[] }[], graph: string, outputs: string[][]) {
  runFfmpeg(['-y', '-v', 'error', ...inputs.flatMap((i) => i.args), '-filter_complex', graph, ...outputs.flat()], { stdio: ['ignore', 'ignore', 'inherit'] });
}

/** An output of the graph's `[label]`, one image per frame, into `dir`; returns how to read them back in order. */
function imagesOut(label: string, dir: string) {
  mkdirSync(dir, { recursive: true });
  return ['-map', `[${label}]`, '-fps_mode', 'passthrough', '-q:v', '3', join(dir, '%05d.jpg')];
}

function readImages(dir: string, frames: number[]) {
  const files = readdirSync(dir).sort().map((f) => join(dir, f));
  if (files.length !== frames.length) throw new Error(`decoded ${files.length} of ${frames.length} frames into ${dir}`);
  return files;
}

/** Each frame's YAVG, in order, from a metadata=print file. */
const readYavg = (file: string) => [...readFileSync(file, 'utf8').matchAll(/lavfi\.signalstats\.YAVG=([\d.e+-]+)/g)].map((m) => Number(m[1]));

/** The chosen frames, `w` wide, tiled `cols` across into `out`, each labelled with its frame and time. */
export async function lookFrameSheet(source: OpenLookSource, frames: number[], { crop, cols, w, out }: { crop?: LookCrop; cols: number; w: number; out: string }) {
  checkFramesIn(source, frames);
  if (frames.length > MAX_SHEET_TILES) throw new Error(`${frames.length} frames is too many for one sheet (${MAX_SHEET_TILES} at most): step through them, like --frames=a:b:5`);
  const region = crop ?? { w: source.width, h: source.height }, h = evenHeight(w, region);
  await withLookWork(async (work, inputFor) => {
    const input = await inputFor(source, frames, crop ? source.width : w);
    runFilterGraph([input], `[0:v]${input.chain},${cropFilter(crop)}scale=${w}:${h}[t]`, [imagesOut('t', join(work, 't'))]);
    const files = readImages(join(work, 't'), frames);
    tileLabelledImages(frames.map((f, i) => ({ file: files[i], label: frameLabel(f, source.fps) })), out, { cols, w, h });
  });
  return [`${source.name}: ${frames.length} frames, ${cols}×${Math.ceil(frames.length / cols)}`, out];
}

/** Runs `look` with a work dir and a way to open sources' inputs; removes the dir and every rendered input however it ends. */
async function withLookWork<T>(look: (work: string, inputFor: (source: OpenLookSource, frames: number[], w: number) => Promise<LookInput>) => Promise<T>) {
  const work = mkdtempSync(join(tmpdir(), 'look-')), rendered: string[] = [];
  try {
    return await look(work, async (source, frames, w) => {
      const input = await source.input(frames, w);
      if (input.dir) rendered.push(input.dir);
      return input;
    });
  } finally {
    for (const dir of [work, ...rendered]) rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Compares `after` with `before` on the chosen frames: counts each frame's changed pixels (CHANGED_LUMA_STEP) in the
 * region, and lays out before | after | the changed pixels (white) a row per frame, the most changed rows when there
 * are too many. Prints the changed frames, and writes every frame's count beside the sheet (.txt).
 */
export async function lookAgainst(before: OpenLookSource, after: OpenLookSource, frames: number[], { crop, cols, w, out }: {
  crop?: LookCrop; cols: number; w: number; out: string;
}) {
  checkFramesIn(before, frames);
  checkFramesIn(after, frames);
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(`${before.name} is ${before.width}×${before.height} and ${after.name} ${after.width}×${after.height}: compare renders of one size`);
  }
  const region = crop ?? { x: 0, y: 0, w: after.width, h: after.height }, h = evenHeight(w, region), pixels = region.w * region.h;
  return withLookWork(async (work, inputFor) => {
    const stats = join(work, 'changed.txt');
    const inputs = [await inputFor(before, frames, after.width), await inputFor(after, frames, after.width)];
    const each = (i: number, name: string) => `[${i}:v]${inputs[i].chain},${cropFilter(crop)}split[${name}][${name}d];[${name}]scale=${w}:${h}[${name}t];[${name}d]format=gray[${name}g]`;
    const graph = `${each(0, 'a')};${each(1, 'b')};[ag][bg]blend=all_mode=difference:shortest=1,lut=y='gt(val,${CHANGED_LUMA_STEP})*255',` +
      `signalstats,metadata=print:file='${stats}',scale=${w}:${h}[mt]`;
    runFilterGraph(inputs, graph, [imagesOut('at', join(work, 'a')), imagesOut('bt', join(work, 'b')), imagesOut('mt', join(work, 'm'))]);
    const [a, b, m] = ['a', 'b', 'm'].map((d) => readImages(join(work, d), frames));
    const changed = readYavg(stats).map((yavg) => Math.round((yavg / 255) * pixels));
    if (changed.length !== frames.length) throw new Error(`measured ${changed.length} of ${frames.length} frames`);
    const perMille = (i: number) => (changed[i] / pixels) * 1000;
    const describe = (i: number) => `${changed[i].toLocaleString('en-US')} px (${perMille(i).toFixed(1)}‰)`;

    const rows = frames.map((_, i) => i);
    const shown = rows.length <= MAX_AGAINST_ROWS ? rows : [...rows].sort((x, y) => changed[y] - changed[x]).slice(0, MAX_AGAINST_ROWS).sort((x, y) => x - y);
    tileLabelledImages(shown.flatMap((i) => [
      { file: a[i], label: `${frames[i]} before` }, { file: b[i], label: `${frames[i]} after` }, { file: m[i], label: `${frames[i]} changed: ${describe(i)}` },
    ]), out, { cols: 3 * cols, w, h });
    const countsFile = out.replace(/\.[^./]+$/, '') + '.txt';
    writeFileSync(countsFile, `${['frame  changed px  per mille', ...frames.map((f, i) => `${String(f).padStart(5)}  ${String(changed[i]).padStart(10)}  ${perMille(i).toFixed(2).padStart(9)}`)].join('\n')}\n`);

    const moved = rows.filter((i) => perMille(i) > CHANGED_PER_MILLE);
    const worst = rows.reduce((x, y) => (changed[y] > changed[x] ? y : x));
    return [
      `before ${before.name}, after ${after.name}; region ${region.w}×${region.h}${crop ? ` at ${crop.x},${crop.y}` : ''}; a pixel changed when its luma moved over ${CHANGED_LUMA_STEP}`,
      moved.length ? `${moved.length} of ${frames.length} frames changed (over ${CHANGED_PER_MILLE}‰), the most at ${frames[worst]}: ${describe(worst)}` : `unchanged: no frame of ${frames.length} over ${CHANGED_PER_MILLE}‰`,
      ...(moved.length ? [`  ${moved.slice(0, 40).map((i) => `${frames[i]}:${perMille(i).toFixed(1)}‰`).join(' ')}${moved.length > 40 ? ` … and ${moved.length - 40} more` : ''}`] : []),
      ...(shown.length < rows.length ? [`the sheet shows the ${shown.length} most changed of ${rows.length} frames`] : []),
      out, countsFile,
    ];
  });
}

/** Measures `first`–`last` frame by frame (luma, change from the frame before), prints its summary, and writes every frame's numbers to `out`. */
export async function lookMotion(source: OpenLookSource, first: number, last: number, { crop, still, clock, out }: {
  crop?: LookCrop; still: number; clock?: BarClock; out: string;
}) {
  checkFramesIn(source, [first, last]);
  // The frame before the stretch, when the source has one, gives its first frame a change too.
  const from = Math.max(source.first, first - 1), frames = Array.from({ length: last - from + 1 }, (_, i) => from + i);
  return withLookWork(async (work, inputFor) => {
    const lumaFile = join(work, 'luma.txt'), diffFile = join(work, 'diff.txt');
    const input = await inputFor(source, frames, source.width);
    // tblend's frame k is the difference between frames k and k+1: it's credited to k+1, and the first frame has none.
    runFilterGraph([input], `[0:v]${input.chain},${cropFilter(crop)}signalstats,metadata=print:file='${lumaFile}',` +
      `tblend=all_mode=difference,signalstats,metadata=print:file='${diffFile}'[o]`, [['-map', '[o]', '-f', 'null', '-']]);
    const luma = readYavg(lumaFile), diff = [null, ...readYavg(diffFile)];
    if (luma.length !== frames.length) throw new Error(`measured ${luma.length} of ${frames.length} frames`);
    const skip = first - from;
    const { summary, table } = formatFrameMotion({ first, luma: luma.slice(skip), diff: diff.slice(skip) }, { still, clock });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${table.join('\n')}\n`);
    return [`${source.name}${crop ? `, region ${crop.w}×${crop.h} at ${crop.x},${crop.y}` : ''}`, ...summary, '', out];
  });
}

// library-frame-decoder.ts: a library track's pictures, frame by frame, as JPEGs, for a render's pages to draw
// (library-video.tsx). ffmpeg decodes a file forward from a seek onto a fixed frame grid, so a render's frames, asked
// for in rough order by its several tabs, cost one decode each; a jump back or far ahead starts another decoder.
// Node only.
import type { ChildProcess } from 'node:child_process';
import type { Socket } from 'node:net';
import { spawnFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';

/** Frames a decoder keeps behind its head, for tabs a little behind the others; and how far ahead it reads on. */
const KEPT_FRAMES = 90, READ_AHEAD_FRAMES = 90;
/** Seconds decoded before the asked-for time on a seek, so the grid's first frame shows what was on screen then. */
const SEEK_LEAD_SECONDS = 0.5;
/** Decoders open at once, across files; and how long an unused one lives. */
const MAX_DECODERS = 8, IDLE_MS = 15_000;

/** What to decode: a file, at a width, on a grid of `fps` frames a second. */
export type LibraryFrameSource = { path: string; width: number; fps: number };

type Decoder = {
  key: string;
  start: number;
  fps: number;
  /** Decoded frames by grid index from `start`, the newest KEPT_FRAMES. */
  frames: Map<number, Buffer>;
  /** The grid index the next decoded frame will have. */
  next: number;
  ended: boolean;
  /** Ended at the file's end, so its last frame stands for any time past it; not when killed. */
  reachedEnd: boolean;
  failure: Error | null;
  /** Wakes whoever waits on the next frame or the end. */
  waiters: Set<() => void>;
  child: ChildProcess;
  /** Reads are served one at a time, in the order asked. */
  queue: Promise<unknown>;
  idle: NodeJS.Timeout | null;
  /** When it was last asked for a frame, to close the least recently used first. */
  used: number;
};

const decoders: Decoder[] = [];

process.on('exit', () => {
  for (const decoder of decoders) decoder.child.kill('SIGKILL');
});

/** Splits an MJPEG stream into its JPEGs: each runs from its SOI (FFD8) to its EOI (FFD9), which ffmpeg never escapes. */
function onJpegs(child: ChildProcess, take: (jpeg: Buffer) => void) {
  let pending: Buffer = Buffer.alloc(0);
  child.stdout!.on('data', (data: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, data]) : data;
    for (;;) {
      const end = pending.indexOf(EOI);
      if (end < 0) break;
      take(pending.subarray(0, end + 2));
      pending = pending.subarray(end + 2);
    }
  });
}
const EOI = Buffer.from([0xff, 0xd9]);

function openDecoder(source: LibraryFrameSource, key: string, start: number): Decoder {
  // VideoToolbox decodes 4K/5K HEVC and H.264 several times faster on a Mac; elsewhere ffmpeg won't open an input
  // with a hwaccel it doesn't have, so it's asked for only there.
  const hwaccel = process.platform === 'darwin' ? ['-hwaccel', 'videotoolbox'] : [];
  const child = spawnFfmpeg([
    '-v', 'error', ...hwaccel, '-ss', start.toFixed(6), '-i', source.path, '-an',
    // start_time=0 pads the grid back to the seek, so frame k is always `start + k / fps`.
    '-vf', `fps=fps=${source.fps}:start_time=0,scale=${source.width}:-2:flags=lanczos`,
    '-c:v', 'mjpeg', '-q:v', '2', '-pix_fmt', 'yuvj444p', '-f', 'image2pipe', '-',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const decoder: Decoder = { key, start, fps: source.fps, frames: new Map(), next: 0, ended: false, reachedEnd: false, failure: null, waiters: new Set(), child, queue: Promise.resolve(), idle: null, used: Date.now() };
  const wake = () => {
    // Taken before they run: a waiter still short of its frame waits again.
    const waiting = [...decoder.waiters];
    decoder.waiters.clear();
    for (const waiter of waiting) waiter();
  };
  let stderr = '';
  child.stderr!.on('data', (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-2000);
  });
  onJpegs(child, (jpeg) => {
    decoder.frames.set(decoder.next, jpeg);
    decoder.frames.delete(decoder.next - KEPT_FRAMES);
    decoder.next++;
    // Decoding runs ahead only as far as the reads need: past that, the pipe fills and ffmpeg waits.
    if (decoder.waiters.size === 0) child.stdout!.pause();
    wake();
  });
  child.on('error', (error) => {
    decoder.failure = error;
    wake();
  });
  child.on('close', (code) => {
    decoder.ended = true;
    decoder.reachedEnd = code === 0;
    if (code && !decoder.frames.size) decoder.failure = new Error(`ffmpeg couldn't decode ${source.path} from ${start.toFixed(3)} s: ${stderr.trim() || `exit ${code}`}`);
    wake();
  });
  // Neither the decoder nor its pipes keep a finished render's process alive.
  child.unref();
  // SAFETY: a spawned child's piped stdio streams are sockets, which unref as a socket does.
  for (const stream of [child.stdout, child.stderr]) (stream as Socket).unref();
  return decoder;
}

function closeDecoder(decoder: Decoder) {
  decoder.child.kill('SIGKILL');
  const at = decoders.indexOf(decoder);
  if (at >= 0) decoders.splice(at, 1);
}

/** The decoder that reaches grid time `seconds` soonest, or a new one seeking there. */
function decoderFor(source: LibraryFrameSource, seconds: number): { decoder: Decoder; index: number } {
  const key = `${source.path}|${source.width}|${source.fps}`;
  const reaching = decoders.filter((d) => d.key === key).map((d) => ({ decoder: d, index: Math.round((seconds - d.start) * d.fps) }))
    .filter(({ decoder, index }) => decoder.frames.has(index)
      // An ended decoder holds its last frame for any time past it; a running one reads on a little way.
      || (index >= decoder.next && (decoder.ended ? decoder.reachedEnd && decoder.frames.size > 0 : index < decoder.next + READ_AHEAD_FRAMES)));
  const found = reaching.toSorted((a, b) => Math.max(0, a.index - a.decoder.next) - Math.max(0, b.index - b.decoder.next))[0];
  if (found) return found;
  if (decoders.length >= MAX_DECODERS) closeDecoder(decoders.reduce((a, b) => (a.used <= b.used ? a : b)));
  const start = Math.max(0, seconds - SEEK_LEAD_SECONDS), decoder = openDecoder(source, key, start);
  decoders.push(decoder);
  return { decoder, index: Math.round((seconds - start) * decoder.fps) };
}

/**
 * Frame `index` of `decoder`'s grid, or its last when the file ends first: a track holds its last picture. Null when
 * this decoder can no longer give it: the frame fell out of its window, or it was closed (for another, or idle).
 */
function readFrame(decoder: Decoder, index: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    // Looked at again on each frame decoded, until it's there or the file ends.
    const look = () => {
      if (decoder.failure) return reject(decoder.failure);
      const frame = decoder.frames.get(index) ?? (decoder.reachedEnd && index >= decoder.next ? decoder.frames.get(decoder.next - 1) : undefined);
      if (frame) return resolve(frame);
      if (index < decoder.next || (decoder.ended && !decoder.reachedEnd)) return resolve(null);
      if (decoder.ended) return reject(new Error(`the file ended before ${(decoder.start + index / decoder.fps).toFixed(3)} s, and decoded nothing`));
      decoder.waiters.add(look);
      decoder.child.stdout!.resume();
      return undefined;
    };
    look();
  });
}

/** The JPEG of `source`'s picture at `seconds` of its media time, on its grid. */
export async function libraryFrameAt(source: LibraryFrameSource, seconds: number): Promise<Buffer> {
  // A decoder chosen as the read was asked for may have moved past it, or closed, by its turn: then one that can.
  return (await readFrameAt(source, seconds)) ?? libraryFrameAt(source, seconds);
}

function readFrameAt(source: LibraryFrameSource, seconds: number): Promise<Buffer | null> {
  const { decoder, index } = decoderFor(source, seconds);
  decoder.used = Date.now();
  if (decoder.idle) clearTimeout(decoder.idle);
  const read = decoder.queue.then(() => readFrame(decoder, index)).finally(() => {
    if (decoder.idle) clearTimeout(decoder.idle);
    decoder.idle = setTimeout(() => closeDecoder(decoder), IDLE_MS);
    decoder.idle.unref();
  });
  decoder.queue = read.catch(() => {});
  return read;
}

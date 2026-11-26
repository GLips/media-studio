// sound-mix.ts: a video's soundtrack from its clips (sound-clip.ts), mixed in Node at 48 kHz in float. ffmpeg decodes
// and resamples each clip; the gain is applied per sample and the clips summed here, since ffmpeg's `volume` filter
// evaluates an expression once per audio frame, which steps like the render's frames did. A clip played at another
// rate is read between its samples here too, so a run of clips butted end to end plays its source unbroken.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runFfmpegAsync, runFfprobeAsync } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import type { PlacedSoundClip, SoundEnvelope } from '../models/sound-clip.ts';

export const SOUND_MIX_RATE = 48000;
const CHANNELS = 2;
const DECODES_AT_ONCE = 6;

/**
 * Mixes `clips` into `out`, a 32-bit float stereo wav, `seconds` long from video second `from`. `fileOf` turns a clip's
 * URL into what ffmpeg reads: a file, or a URL it can fetch. A clip unheard in the stretch isn't decoded.
 */
export async function mixSoundClips(clips: readonly PlacedSoundClip[], { from, seconds, out, fileOf }: {
  from: number; seconds: number; out: string; fileOf: (src: string) => string;
}): Promise<void> {
  const frames = Math.round(seconds * SOUND_MIX_RATE), mix = new Float32Array(frames * CHANNELS);
  const heard = clips.filter((c) => c.start < from + seconds && (c.duration === null || c.start + c.duration > from));
  await withStudioTemp('sound-mix', async (tmp) => {
    const decoded = new Map<string, Promise<Float32Array>>();
    const decode = (clip: PlacedSoundClip) => {
      const key = JSON.stringify([clip.src, clip.from, clip.loop ? null : clip.duration, clip.rate ?? 1]);
      if (!decoded.has(key)) {
        const file = join(tmp, `${decoded.size}.f32`);
        decoded.set(key, queued(() => decodeClip(clip, fileOf(clip.src), file)));
      }
      return decoded.get(key)!;
    };
    const queued = decodeQueue(DECODES_AT_ONCE);
    const sources = await Promise.all(heard.map(decode));
    heard.forEach((clip, i) => addClip(mix, sources[i], clip, from));
    const raw = join(tmp, 'mix.f32');
    writeFileSync(raw, new Uint8Array(mix.buffer));
    mkdirSync(dirname(out), { recursive: true });
    await runFfmpegAsync(['-y', '-v', 'error', '-f', 'f32le', '-ar', String(SOUND_MIX_RATE), '-ac', String(CHANNELS), '-i', raw, '-c:a', 'pcm_f32le', out]);
  });
}

/** Runs at most `width` of the tasks given it at once. */
function decodeQueue(width: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T,>(task: () => Promise<T>): Promise<T> => {
    if (running >= width) await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
    try {
      return await task();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
}

/** The clip's source as interleaved stereo floats: from `from`, for its duration, or to the end for a loop or none. */
async function decodeClip(clip: PlacedSoundClip, file: string, tmp: string): Promise<Float32Array> {
  // One sample over, so a clip at another rate has its last sample's neighbour to read towards.
  const length = !clip.loop && clip.duration !== null ? ['-t', String(clip.duration * (clip.rate ?? 1) + 1 / SOUND_MIX_RATE)] : [];
  // A mono source plays at full level in both channels, as Remotion played it and the levels were set by ear against;
  // ffmpeg's own upmix would take 3 dB off each.
  // Probed without blocking, as a library file comes over the library's server, which this process runs.
  const mono = (await runFfprobeAsync(['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', file])).trim() === '1';
  const channels = mono ? ['-af', 'pan=stereo|c0=c0|c1=c0'] : ['-ac', String(CHANNELS)];
  // -ss before -i seeks the input and then decodes up to the exact sample, as ffmpeg's accurate seek does by default.
  await runFfmpegAsync(['-y', '-v', 'error', '-ss', String(clip.from), ...length, '-i', file, '-vn', ...channels, '-ar', String(SOUND_MIX_RATE), '-f', 'f32le', tmp]);
  const bytes = readFileSync(tmp);
  if (bytes.length === 0) throw new Error(`${clip.id} (${clip.src}) has no sound from ${clip.from} s`);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
}

/** Adds `source`, played as `clip` says, into `mix`, which starts at video second `from`. */
function addClip(mix: Float32Array, source: Float32Array, clip: PlacedSoundClip, from: number) {
  const sourceFrames = source.length / CHANNELS, mixFrames = mix.length / CHANNELS;
  const offset = Math.round((clip.start - from) * SOUND_MIX_RATE);
  const plays = clip.duration === null ? sourceFrames : Math.round(clip.duration * SOUND_MIX_RATE);
  const gainAt = envelopeCursor(clip.gain), rate = clip.rate ?? 1;
  if (rate !== 1) {
    // Negative space: a looped clip at another rate isn't read; no caller asks for one.
    const last = Math.min(plays, Math.floor((sourceFrames - 1) / rate), mixFrames - offset);
    for (let j = Math.max(0, -offset); j < last; j++) {
      const at = j * rate, i = Math.floor(at), f = at - i, g = gainAt(j / SOUND_MIX_RATE), s = i * CHANNELS, m = (offset + j) * CHANNELS;
      mix[m] += (source[s] + (source[s + CHANNELS] - source[s]) * f) * g;
      mix[m + 1] += (source[s + 1] + (source[s + 1 + CHANNELS] - source[s + 1]) * f) * g;
    }
    return;
  }
  const last = Math.min(clip.loop ? plays : Math.min(plays, sourceFrames), mixFrames - offset);
  for (let j = Math.max(0, -offset); j < last; j++) {
    const g = gainAt(j / SOUND_MIX_RATE), s = (j % sourceFrames) * CHANNELS, m = (offset + j) * CHANNELS;
    mix[m] += source[s] * g;
    mix[m + 1] += source[s + 1] * g;
  }
}

/** `envelope`'s gain at a time no earlier than the last asked for, walking its points rather than searching them. */
function envelopeCursor(envelope: SoundEnvelope): (seconds: number) => number {
  if (typeof envelope === 'number') return () => envelope;
  let i = 0;
  return (seconds) => {
    while (i < envelope.length - 1 && envelope[i + 1][0] <= seconds) i++;
    const [t0, g0] = envelope[i];
    if (i === envelope.length - 1 || seconds <= t0) return g0;
    const [t1, g1] = envelope[i + 1];
    return g0 + ((g1 - g0) * (seconds - t0)) / (t1 - t0);
  };
}

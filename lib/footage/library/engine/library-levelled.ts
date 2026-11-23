// library-levelled.ts: an item's speech levelled for the mix, made once. A line spoken in a recording plays from this
// copy, which the mix brings to the voice's level: the mix only lowers a source, and a raw mic can arrive 20 dB under a
// voice line. Node only.
//
// The copy keeps its track's media time, sample for sample, so the track's sync numbers and its transcript's times
// apply to it unchanged. PCM, not AAC: AAC's encoder delay would shift it.
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { measureWithFfmpeg, runFfmpegAsync } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { measureAudibleLoudness } from '#lib/platform/ffmpeg/engine/loudness.ts';
import { LIBRARY_LEVELLED_LUFS, type LibraryItem } from '../models/library-item.ts';
import { onlineLibraryMediaFolder } from '#lib/footage/library-media/engine/library-media-folder.ts';
import { libraryMediaPath, readLibraryItem, writeLibraryItem } from './library-store.ts';

// Speech's usual range and a ceiling under clipping once the mix brings it down to the voice's level.
const LEVELLED_LRA = 11, LEVELLED_TRUE_PEAK = -1.5;

/** Levels `id`'s speech track, if it has one and it isn't yet, and records it in item.json; returns the item. */
export async function levelLibrarySpeech(id: string, log: (line: string) => void): Promise<LibraryItem> {
  const item = readLibraryItem(id);
  const name = item.speech, track = name === undefined ? undefined : item.tracks[name];
  if (!name || !track || track.levelled) return item;
  log(`levelling ${name} for the mix`);
  const source = libraryMediaPath(item, track.file), file = `proxies/${name}-levelled.wav`;
  const out = join(onlineLibraryMediaFolder(), id, file), temp = `${out}.part.wav`;
  const target = `I=${LIBRARY_LEVELLED_LUFS}:TP=${LEVELLED_TRUE_PEAK}:LRA=${LEVELLED_LRA}`;
  // loudnorm's two passes: measure, then apply the gain linearly where the peaks allow it.
  const { stderr } = measureWithFfmpeg(['-hide_banner', '-nostats', '-i', source, '-vn', '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
  // SAFETY: loudnorm prints this JSON object last on stderr, its values as strings.
  const measured = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1)) as Record<'input_i' | 'input_tp' | 'input_lra' | 'input_thresh' | 'target_offset', string>;
  if (!Number.isFinite(Number(measured.input_i))) throw new Error(`${id}'s ${name} is silent: there's no speech to level`);
  const second = `loudnorm=${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
  // loudnorm resamples to 192 kHz inside; the copy goes back to the track's rate.
  await runFfmpegAsync(['-v', 'error', '-y', '-i', source, '-vn', '-af', second, '-ar', String(track.audio?.sampleRate ?? 48000), '-c:a', 'pcm_s16le', temp]);
  renameSync(temp, out);
  const { lufs } = measureAudibleLoudness(out);
  // Re-read: another process may have changed item.json while it ran.
  const now = readLibraryItem(id);
  writeLibraryItem({ ...now, tracks: { ...now.tracks, [name]: { ...now.tracks[name], levelled: { file, lufs: Math.round(lufs * 10) / 10 } } } });
  return readLibraryItem(id);
}

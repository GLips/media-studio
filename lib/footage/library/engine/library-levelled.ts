// library-levelled.ts: an item's spoken tracks levelled for the mix, each made once. A line spoken in a recording plays from this
// copy, which the mix brings to the voice's level: the mix only lowers a source, and a raw mic can arrive 20 dB under a
// voice line. Node only.
//
// The copy keeps its track's media time, sample for sample, so the track's sync numbers and its transcript's times
// apply to it unchanged. PCM, not AAC: AAC's encoder delay would shift it. Mono, as the mix places a voice line: the
// system track is stereo. A mic is denoised first (libraryLevelledProcessing), by RNNoise inside ffmpeg, whose model
// is fetched once into the studio's user cache.
import { Effect, FileSystem, Path, Schema } from 'effect';
import { StudioFfmpeg } from '#lib/platform/ffmpeg/engine/studio-ffmpeg.ts';
import { LibraryMediaFolder } from '#lib/footage/library-media/engine/library-media-folder.ts';
import { LibrarySpeechUnmeasured } from '../models/library-errors.ts';
import { studioUserCacheDir } from '#lib/platform/temp/engine/studio-user-cache.ts';
import { LIBRARY_LEVELLED_LUFS, libraryLevelledProcessing, librarySpokenTracks } from '../models/library-item.ts';
import { LIBRARY_QUIET_WINDOW, libraryQuietSpans } from '../models/library-quiet.ts';
import { LibraryStore } from './library-store.ts';

// Speech's usual range and a ceiling under clipping once the mix brings it down to the voice's level.
const LEVELLED_LRA = 11, LEVELLED_TRUE_PEAK = -1.5;

/** loudnorm's first-pass report, the JSON object it prints last on stderr, its values as strings. */
const LoudnormReport = Schema.fromJsonString(Schema.Struct({
  input_i: Schema.String, input_tp: Schema.String, input_lra: Schema.String, input_thresh: Schema.String, target_offset: Schema.String,
}));

const lastLine = (text: string) => text.trim().split('\n').at(-1) ?? '';

// ebur128 prints silence's integrated loudness as R128's absolute gate.
const ABSOLUTE_GATE_LUFS = -70;

/**
 * Integrated loudness from ebur128's summary on stderr; undefined for silence or a summary it can't find. Measured
 * with `dualmono`, as the mix hears a mono voice line from both speakers, so the levelled copy compares with one.
 */
const ebur128IntegratedLufs = (stderr: string) => {
  const integrated = Number(/I:\s+(-?[\d.]+) LUFS/.exec(stderr.slice(stderr.lastIndexOf('Summary:')))?.[1]);
  return Number.isFinite(integrated) && integrated > ABSOLUTE_GATE_LUFS ? integrated : undefined;
};

// GregorR's somnolent-hogwash model: trained on speech against general noise, the one the vid-223 trial picked by ear.
const RNNOISE_MODEL_URL = 'https://raw.githubusercontent.com/GregorR/rnnoise-models/master/somnolent-hogwash-2018-09-01/sh.rnnn';

// The one request levelling makes; a plain fetch, as Effect's HTTP client is still unstable.
const fetchRnnoiseModel = () => fetch(RNNOISE_MODEL_URL);

/** The RNNoise model's path in the user cache, fetched there on first use. */
const rnnoiseModel = Effect.fn('LibraryLevelled.rnnoiseModel')(function* (id: string, track: string) {
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  const file = path.join(studioUserCacheDir('rnnoise-models'), 'sh.rnnn');
  if (yield* fs.exists(file)) return file;
  yield* Effect.log('fetching the RNNoise model for denoising speech');
  const unfetched = (why: string) => new LibrarySpeechUnmeasured({ id, track, why: `couldn't fetch the RNNoise model: ${why}` });
  const response = yield* Effect.tryPromise({ try: () => fetchRnnoiseModel(), catch: (error) => unfetched(String(error)) });
  if (!response.ok) return yield* unfetched(`${RNNOISE_MODEL_URL} answered ${response.status}`);
  const bytes = yield* Effect.tryPromise({ try: () => response.arrayBuffer(), catch: (error) => unfetched(String(error)) });
  yield* fs.makeDirectory(path.dirname(file), { recursive: true });
  yield* fs.writeFile(`${file}.part`, new Uint8Array(bytes));
  yield* fs.rename(`${file}.part`, file);
  return file;
});

/** Levels each of `id`'s spoken tracks not levelled yet, or levelled another way, recording each in item.json; returns the item. */
export const levelLibrarySpokenTracks = Effect.fn('LibraryLevelled.levelSpokenTracks')(function* (id: string) {
  const store = yield* LibraryStore;
  for (const name of librarySpokenTracks(yield* store.readItem(id))) yield* levelLibraryTrack(id, name);
  return yield* store.readItem(id);
});

const levelLibraryTrack = Effect.fn('LibraryLevelled.levelTrack')(function* (id: string, name: string) {
  const store = yield* LibraryStore, media = yield* LibraryMediaFolder, ffmpeg = yield* StudioFfmpeg;
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  const item = yield* store.readItem(id);
  const track = item.tracks[name], processing = libraryLevelledProcessing(name);
  if (track.levelled?.processing === processing && track.levelled.quiet) return item;
  yield* Effect.log(`levelling ${name} for the mix (${processing})`);
  // Measured and levelled after the denoise, so the loudness is the cleaned speech's. A path inside a filter is quoted.
  const denoise = processing === 'loudnorm' ? '' : `highpass=f=80:poles=2,arnndn=m='${yield* rnnoiseModel(id, name)}':mix=0.8,`;
  const source = yield* media.itemFile(id, track.file), file = `proxies/${name}-levelled.wav`;
  const out = path.join(yield* media.online(), id, file), temp = `${out}.part.wav`;
  const target = `I=${LIBRARY_LEVELLED_LUFS}:TP=${LEVELLED_TRUE_PEAK}:LRA=${LEVELLED_LRA}`;
  // loudnorm's two passes: measure, then apply the gain linearly where the peaks allow it.
  const { stderr, exitCode } = yield* ffmpeg.report(['-hide_banner', '-nostats', '-i', source, '-vn', '-af', `${denoise}loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
  if (exitCode !== 0) return yield* new LibrarySpeechUnmeasured({ id, track: name, why: lastLine(stderr) });
  const measured = yield* Schema.decodeUnknownEffect(LoudnormReport)(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1)).pipe(
    Effect.mapError((error) => new LibrarySpeechUnmeasured({ id, track: name, why: `its loudness report isn't loudnorm's: ${error.message}` })),
  );
  // A silent track (a muted mic, a call with no sound) leaves the item otherwise whole: it's said, not refused.
  if (!Number.isFinite(Number(measured.input_i))) {
    yield* Effect.log(`${name} is silent: nothing to level, so no line can be spoken from it`);
    return item;
  }
  const second = `${denoise}loudnorm=${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
  // loudnorm resamples to 192 kHz inside; the copy goes back to the track's rate.
  yield* fs.makeDirectory(path.dirname(out), { recursive: true });
  yield* ffmpeg.run(['-v', 'error', '-y', '-i', source, '-vn', '-af', second, '-ac', '1', '-ar', String(track.audio?.sampleRate ?? 48000), '-c:a', 'pcm_s16le', temp]);
  yield* fs.rename(temp, out);
  const check = yield* ffmpeg.report(['-nostats', '-hide_banner', '-i', out, '-af', 'ebur128=dualmono=true', '-f', 'null', '-']);
  if (check.exitCode !== 0) return yield* new LibrarySpeechUnmeasured({ id, track: name, why: lastLine(check.stderr) });
  const lufs = ebur128IntegratedLufs(check.stderr);
  if (lufs === undefined) return yield* new LibrarySpeechUnmeasured({ id, track: name, why: `its levelled copy ${file} measures silent` });
  const quiet = libraryQuietSpans(yield* windowLevels(out));
  return yield* store.updateItem(id, (now) => ({ ...now, tracks: { ...now.tracks, [name]: { ...now.tracks[name], levelled: { file, lufs: Math.round(lufs * 10) / 10, processing, quiet } } } }));
});

// Digital silence reads -inf; a floor this low is as quiet as any.
const SILENT_DB = -120;

/** `wav`'s RMS level in dBFS per LIBRARY_QUIET_WINDOW, through a file beside it: ffmpeg's stderr comes back cut short. */
const windowLevels = Effect.fn('LibraryLevelled.windowLevels')(function* (wav: string) {
  const ffmpeg = yield* StudioFfmpeg, fs = yield* FileSystem.FileSystem;
  const rate = 16000, levels = `${wav}.levels.txt`;
  const graph = `aresample=${rate},asetnsamples=n=${Math.round(rate * LIBRARY_QUIET_WINDOW)}:p=0,astats=metadata=1:reset=1:measure_overall=RMS_level:measure_perchannel=none,`
    + `ametadata=print:key=lavfi.astats.Overall.RMS_level:file='${levels}'`;
  yield* ffmpeg.run(['-v', 'error', '-y', '-i', wav, '-af', graph, '-f', 'null', '-']);
  const text = yield* fs.readFileString(levels);
  yield* fs.remove(levels);
  return [...text.matchAll(/RMS_level=(\S+)/g)].map(([, db]) => Number.isFinite(Number.parseFloat(db)) ? Math.max(SILENT_DB, Number.parseFloat(db)) : SILENT_DB);
});

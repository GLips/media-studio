// library-grade.ts: `studio grade`'s machinery: measure a camera track once, then draw a look over it as before/after
// stills or a graded copy with the item's speech in sync. Node only; needs the media online, uv and ffmpeg.
//
// library-grade.py draws the pixels, one process per chunk, all at once. The copy is kept in the item's media
// folder (graded/), named by what made it, so asking again reads it back and a changed look makes a new one.
//
// No scene plays the copy yet: library-video.tsx plays the camera's proxy. To play it, name it on the track as
// `levelled` is named, and pick it there.
import { availableParallelism, homedir } from 'node:os';
import { Duration, Effect, FileSystem, Path, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { textSha256Hex } from '#lib/platform/hash/models/sha256.ts';
import { StudioFfmpeg } from '#lib/platform/ffmpeg/engine/studio-ffmpeg.ts';
import { STUDIO_CHILD_PROCESS } from '#lib/platform/process/engine/studio-child-process.ts';
import { toolStderrReason } from '#lib/platform/process/models/tool-stderr-reason.ts';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';
import { studioUserCacheDir } from '#lib/platform/temp/engine/studio-user-cache.ts';
import { LibraryMediaFolder } from '#lib/footage/library-media/engine/library-media-folder.ts';
import { LibraryGradeFailed, LibraryRequestRefused } from '../models/library-errors.ts';
import {
  LIBRARY_GRADE_LOOKS, LIBRARY_GRADE_METHOD, libraryGradeGainsOf, LibraryGradeMeasurement, planLibraryGradeChunks,
  type LibraryGradeLookName,
} from '../models/library-grade.ts';
import { type LibraryItem, libraryItemTimeOf, libraryMediaTimeOf, type LibraryTrack } from '../models/library-item.ts';
import { LibraryStore } from './library-store.ts';

const GRADE_SCRIPT = new URL('./library-grade.py', import.meta.url).pathname;
// The models download here once, shared by every checkout, as whisper's do.
const GRADE_MODELS = studioUserCacheDir('grade-models');
// Film-emulation LUTs come with apps whose licences allow personal use only, so they stay on this Mac, never in a repo.
const GRADE_LUTS = `${homedir()}/Library/Application Support/studio/luts`;
// Graded output runs at NTSC 30, the camera's nominal rate; the Cam Link delivers it variable, a little under.
const GRADE_FPS = { text: '30000/1001', value: 30000 / 1001 };
const MEASURE_SAMPLES = 24;
// Long enough for the masks' smoothing and the face's steadied crop to settle before a chunk's first written frame.
const WARM_SECONDS = 1;
// Each chunk's segmenter and parser take a few cores of their own.
const DEFAULT_CHUNKS = Math.max(1, Math.floor(availableParallelism() / 3));

/** What to grade: an item's camera track (`track`, by default `camera`) in a look. */
export type LibraryGradeTarget = { item: string; track?: string; look: LibraryGradeLookName };

const streamText = <E>(stream: Stream.Stream<Uint8Array, E>) => stream.pipe(Stream.decodeText(), Stream.mkString);

const runGradeScript = Effect.fn('LibraryGrade.script')(function* (id: string, step: 'measure' | 'grade' | 'still', args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const failed = (why: string) => new LibraryGradeFailed({ id, step, why });
  const handle = yield* spawner.spawn(ChildProcess.make('uv', ['run', '--quiet', '--script', GRADE_SCRIPT, step, ...args], STUDIO_CHILD_PROCESS))
    .pipe(Effect.mapError((error) => failed(`uv couldn't start: ${error.message}`)));
  const [stdout, stderr, exitCode] = yield* Effect.all([streamText(handle.stdout), streamText(handle.stderr), handle.exitCode], { concurrency: 'unbounded' })
    .pipe(Effect.mapError((error) => failed(error.message)));
  // MediaPipe and TensorFlow Lite log their start-up on stderr; the script's own reason is its last line.
  if (Number(exitCode) !== 0) return yield* failed(toolStderrReason(stderr, /^(?:[WI]\d{4} |INFO:)/) || `exited with ${exitCode}`);
  return stdout;
}, Effect.scoped);

/** The track, its pixel size at `height`, and the seconds of item time it plays. */
function gradedTrackOf(item: LibraryItem, name: string, height: number) {
  const track = item.tracks[name];
  if (!track?.video) return undefined;
  const width = Math.round((height * track.video.width) / track.video.height / 2) * 2;
  return { name, track, width, height, starts: Math.max(0, libraryItemTimeOf(track, 0)), ends: Math.min(item.durationSeconds, libraryItemTimeOf(track, track.mediaSeconds)) };
}
type GradedTrack = NonNullable<ReturnType<typeof gradedTrackOf>>;

// The script measures; which method it measured by is this code's to say.
const { method: _method, ...scriptMeasurementFields } = LibraryGradeMeasurement.fields;
const ScriptMeasurement = Schema.fromJsonString(Schema.Struct(scriptMeasurementFields));

/**
 * The item and its graded track, measured: a track never measured, or measured by another method, is measured now
 * and the measurement written to item.json.
 */
const measuredTrack = Effect.fn('LibraryGrade.measured')(function* ({ item: asked, track: name = 'camera' }: Pick<LibraryGradeTarget, 'item' | 'track'>, height: number) {
  const store = yield* LibraryStore, media = yield* LibraryMediaFolder;
  let item = yield* store.readItem(yield* store.resolveItemId(asked));
  const graded = gradedTrackOf(item, name, height);
  if (!graded) return yield* new LibraryRequestRefused({ reason: `${item.id} has no ${name} track with a picture to grade` });
  if (graded.track.grade?.method !== LIBRARY_GRADE_METHOD) {
    yield* Effect.log(`measuring ${item.id}'s ${name}: ${MEASURE_SAMPLES} frames across it`);
    const { mediaSeconds } = graded.track;
    const times = Array.from({ length: MEASURE_SAMPLES }, (_, i) => ((i + 0.5) * mediaSeconds / MEASURE_SAMPLES).toFixed(3));
    // Measured at 720p whatever the render's size: the means don't need more, and a re-render at another size reuses them.
    const stdout = yield* runGradeScript(item.id, 'measure', [
      '--src', yield* media.itemFile(item.id, graded.track.file), '--models', GRADE_MODELS,
      '--width', String(Math.round((720 * graded.track.video!.width) / graded.track.video!.height / 2) * 2), '--height', '720', '--times', times.join(','),
    ]);
    const measured = yield* Schema.decodeUnknownEffect(ScriptMeasurement)(stdout)
      .pipe(Effect.mapError((error) => new LibraryGradeFailed({ id: item.id, step: 'measure', why: `its measurement isn't one this reads: ${error.message}` })));
    item = yield* store.updateItem(item.id, (now) => ({ ...now, tracks: { ...now.tracks, [name]: { ...now.tracks[name], grade: { method: LIBRARY_GRADE_METHOD, ...measured } } } }));
  }
  return { item, graded: gradedTrackOf(item, name, height)! };
});

/**
 * The script's flags for drawing `look` over `graded`, and a key naming everything the pixels depend on: the script's
 * own text among them, so a change to how pixels are drawn makes new copies rather than reading old ones.
 */
function lookFlags(graded: GradedTrack, look: LibraryGradeLookName, script: string) {
  const data = LIBRARY_GRADE_LOOKS[look], gains = libraryGradeGainsOf(graded.track.grade!, data);
  const key = textSha256Hex(JSON.stringify({ method: LIBRARY_GRADE_METHOD, script, data, gains, height: graded.height })).slice(0, 8);
  return {
    key,
    flags: ['--models', GRADE_MODELS, '--luts', GRADE_LUTS, '--width', String(graded.width), '--height', String(graded.height), '--fps', GRADE_FPS.text,
      '--look', JSON.stringify(data), '--gains', JSON.stringify(gains)],
  };
}

const gradeScriptHash = Effect.fn('LibraryGrade.scriptHash')(function* () {
  return textSha256Hex(yield* (yield* FileSystem.FileSystem).readFileString(GRADE_SCRIPT));
});

const secondsLabel = (s: number) => s.toFixed(2).replace('.', '_');

/** Before and after, side by side, at each item second in `at` (by default four across the track); answers their paths. */
export const previewLibraryGrade = Effect.fn('LibraryGrade.preview')(function* ({ at, height = 720, ...target }: LibraryGradeTarget & { at?: readonly number[]; height?: number }) {
  const media = yield* LibraryMediaFolder, fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  const { item, graded } = yield* measuredTrack(target, height);
  const times = at ?? [0.2, 0.4, 0.6, 0.8].map((f) => Math.round((graded.starts + f * (graded.ends - graded.starts)) * 100) / 100);
  const outside = times.find((t) => t < graded.starts || t >= graded.ends);
  if (outside !== undefined) return yield* new LibraryRequestRefused({ reason: `${item.id}'s ${graded.name} plays ${graded.starts.toFixed(2)}–${graded.ends.toFixed(2)} s, not at ${outside}` });
  const { key, flags } = lookFlags(graded, target.look, yield* gradeScriptHash());
  const folder = path.join(yield* media.itemFolder(item.id), 'graded');
  yield* fs.makeDirectory(folder, { recursive: true });
  const src = yield* media.itemFile(item.id, graded.track.file), warm = Math.round(WARM_SECONDS * GRADE_FPS.value);
  return yield* Effect.forEach(times, Effect.fnUntraced(function* (t) {
    const out = path.join(folder, `${graded.name}-${target.look}-${key}-at${secondsLabel(t)}.jpg`);
    if (yield* fs.exists(out)) return out;
    const first = Math.max(0, libraryMediaTimeOf(graded.track, t) - warm / GRADE_FPS.value);
    const skip = Math.round((libraryMediaTimeOf(graded.track, t) - first) * GRADE_FPS.value);
    yield* runGradeScript(item.id, 'still', ['--src', src, ...flags, '--ss', first.toFixed(4), '--skip', String(skip), '--out', out]);
    return out;
  }), { concurrency: DEFAULT_CHUNKS });
});

/** What a render was asked for: item seconds `from`–`to` (the whole track by default), at `height`, in `chunks` processes. */
export type LibraryGradeRenderRequest = LibraryGradeTarget & { from?: number; to?: number; height?: number; chunks?: number };

/** The graded copy of a stretch, with the item's speech in sync; made once per look, measurement and size. Answers its path. */
export const renderLibraryGrade = Effect.fn('LibraryGrade.render')(function* ({ from: askedFrom, to: askedTo, height = 1080, chunks = DEFAULT_CHUNKS, ...target }: LibraryGradeRenderRequest) {
  const media = yield* LibraryMediaFolder, ffmpeg = yield* StudioFfmpeg, fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  const { item, graded } = yield* measuredTrack(target, height);
  const from = askedFrom ?? graded.starts, to = askedTo ?? graded.ends;
  if (!(from >= graded.starts - 1e-3 && to <= graded.ends + 1e-3 && to - from >= 1 / GRADE_FPS.value)) {
    return yield* new LibraryRequestRefused({ reason: `${item.id}'s ${graded.name} plays ${graded.starts.toFixed(2)}–${graded.ends.toFixed(2)} s: ${from}–${to} isn't a stretch of it` });
  }
  const { key, flags } = lookFlags(graded, target.look, yield* gradeScriptHash());
  const folder = path.join(yield* media.itemFolder(item.id), 'graded');
  const out = path.join(folder, `${graded.name}-${target.look}-${key}-${secondsLabel(from)}-${secondsLabel(to)}-${height}p.mp4`);
  if (yield* fs.exists(out)) return out;

  const plan = planLibraryGradeChunks({ from, to, fps: GRADE_FPS.value, count: chunks, warmSeconds: WARM_SECONDS, earliest: graded.starts });
  const frames = plan.reduce((n, c) => n + c.frames, 0);
  yield* Effect.log(`grading ${item.id}'s ${graded.name}, ${from.toFixed(2)}–${to.toFixed(2)} s in ${target.look}: ${frames} frames at ${height}p in ${plan.length} chunks`);
  const temp = yield* fs.makeTempDirectoryScoped({ directory: yield* Effect.sync(studioTempRoot), prefix: 'library-grade-' });
  const src = yield* media.itemFile(item.id, graded.track.file);
  const [took, parts] = yield* Effect.forEach(plan, Effect.fnUntraced(function* (chunk, i) {
    const part = path.join(temp, `part-${String(i).padStart(3, '0')}.mp4`);
    const ss = libraryMediaTimeOf(graded.track, chunk.from - chunk.warm / GRADE_FPS.value);
    yield* runGradeScript(item.id, 'grade', ['--src', src, ...flags, '--ss', Math.max(0, ss).toFixed(4), '--skip', String(chunk.warm), '--frames', String(chunk.frames), '--out', part]);
    return part;
  }), { concurrency: plan.length }).pipe(Effect.timed);
  const ms = Duration.toMillis(took);
  yield* Effect.log(`${frames} frames in ${(ms / 1000).toFixed(1)} s, ${(ms / frames).toFixed(0)} ms a frame`);

  const list = path.join(temp, 'parts.txt');
  yield* fs.writeFileString(list, parts.map((p) => `file '${p}'`).join('\n'));
  yield* fs.makeDirectory(folder, { recursive: true });
  const partial = `${out}.part.mp4`;
  const speech = item.speech === undefined ? undefined : item.tracks[item.speech];
  const sound = speech ? speechFlags(speech, yield* media.itemFile(item.id, speech.levelled?.file ?? speech.file), from) : { input: [], output: [] };
  yield* ffmpeg.run(['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, ...sound.input, '-map', '0:v', ...sound.output,
    '-c:v', 'copy', '-t', (frames / GRADE_FPS.value).toFixed(4), '-movflags', '+faststart', partial]);
  yield* fs.rename(partial, out);
  return out;
}, Effect.scoped);

/**
 * ffmpeg flags laying `speech`'s `file` (the track's own, or its levelled copy, on the same media time sample for
 * sample) under the picture from item second `from`, silence first where it starts after `from`. Trimmed by filter,
 * not seeked: ffmpeg's seek into AAC lands a frame or so off, 33 ms on the Scarlett's.
 */
function speechFlags(speech: LibraryTrack, file: string, from: number) {
  const at = libraryMediaTimeOf(speech, from);
  const place = at >= 0 ? `atrim=start=${at.toFixed(5)},asetpts=PTS-STARTPTS` : `adelay=${Math.round(-at * 1000)}:all=1`;
  return { input: ['-i', file], output: ['-map', '1:a', '-af', place, '-c:a', 'aac', '-b:a', '192k'] };
}

// add-library-item.ts: taking footage into the library. Its files go to the media folder, its speech is transcribed,
// and its metadata is written to the workspace, so it's searchable; then tracks that need one get an editing proxy.
// Node only. The add's steps, and what a failure at each undoes, are libraryAddMachine's.
//
// Files are copied (an APFS clone where the media folder shares a volume with the source, so free), or moved with
// `move`, as a recorder's own recordings are: the library is their home, and the recorder's folder only an inbox.
// oxlint-disable-next-line arch/effect-native-io -- the FileSystem service has no clone flag; see bringLibraryFile.
import { constants } from 'node:fs';
// oxlint-disable-next-line arch/effect-native-io -- the FileSystem service's copy never clones; see bringLibraryFile.
import { copyFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { DateTime, Effect, FileSystem, Option, Path, PlatformError, Ref, Schema, Stream } from 'effect';
import { FootageTranscriber } from '#lib/footage/transcript/engine/footage-transcriber.ts';
import { streamRecordingClockLog, streamRecordingInputLog } from '#lib/footage/recording/engine/recording-take-logs.ts';
import { LibraryMediaFolder } from '#lib/footage/library-media/engine/library-media-folder.ts';
import { thisStudioProcess } from '#lib/platform/process/engine/studio-process.ts';
import { LIBRARY_ADD_MARKER_FILE, LibraryAddMarkerText, type LibraryAddMarker } from '../models/library-add-marker.ts';
import { libraryAddStarted, libraryAddStep, libraryAddUndo } from '../models/library-add-machine.ts';
import { LibraryFootageAlreadyAdded, LibraryRequestRefused, LibraryTakeStillRecording } from '../models/library-errors.ts';
import { libraryItemDuration, librarySlug, librarySpeechTrack, LIBRARY_ITEM_FORMAT, unusedLibraryItemId, type LibraryItem, type LibraryTrack } from '../models/library-item.ts';
import { namedFilesAddSource, recorderAddSource, type LibraryAddSource, type LibraryTrackValues } from '../models/library-sources.ts';
import { levelLibrarySpeech } from './library-levelled.ts';
import { probeLibrarySeconds, probeLibraryStreams } from './library-probe.ts';
import { makeLibraryProxies } from './library-proxies.ts';
import { RecorderDeviceLatencies } from './library-recorder-latencies.ts';
import { readRecorderTakeFolder } from './recorder-take-folder.ts';
import { LibraryStore } from './library-store.ts';

/** What to add: one file or a recorder's folder by its path, or several files as named tracks (`screen=display.mp4`). */
export type LibraryAddRequest = LibraryTrackValues & {
  paths: readonly string[];
  title?: string;
  move: boolean;
  proxies: boolean;
};

const refused = (reason: string) => new LibraryRequestRefused({ reason });

/** Adds the footage; returns the item, with its proxies when they're made. */
export const addLibraryItem = Effect.fn('LibraryAdd.add')(function* (request: LibraryAddRequest) {
  const store = yield* LibraryStore;
  const source = yield* libraryAddSourceOf(request);
  for (const id of yield* store.itemIds()) {
    // One item.json this studio can't read is that item's problem: it mustn't hold every new take in its folder.
    const item = yield* store.readItem(id).pipe(Effect.map(Option.some), Effect.catchTag('LibraryFileUnreadable', (error) => Effect.as(Effect.logWarning(`skipping ${id} in the already-added check: ${error.message}`), Option.none<LibraryItem>())));
    if (Option.isSome(item) && sameSource(item.value, source)) return yield* new LibraryFootageAlreadyAdded({ source: describeSource(source), id });
  }
  // A take's logs are checked before anything is touched, so a log no reader can use never reaches the library.
  if (source.input) yield* Stream.runDrain(streamRecordingInputLog(source.input.path));
  if (source.clockLog) yield* Stream.runDrain(streamRecordingClockLog(source.clockLog));

  const progress = yield* Ref.make(libraryAddStarted());
  const step = (event: Parameters<typeof libraryAddStep>[1]) => Ref.update(progress, (snapshot) => libraryAddStep(snapshot, event));
  const undo = Effect.gen(function* () {
    yield* step({ type: 'failed' });
    const plan = libraryAddUndo(yield* Ref.get(progress));
    if (!plan) return;
    const fs = yield* FileSystem.FileSystem;
    for (const { from, to } of plan.moves) yield* bringLibraryFile(to, from, true);
    if (plan.media) yield* fs.remove(plan.media, { recursive: true, force: true });
  }).pipe(
    // The add fails with what broke it; an undo that fails too is said beside it, and stops before the media
    // folder is removed, so a file it couldn't move back stays there.
    Effect.catch((error) => Effect.logError(`couldn't undo the add: ${error.message}`)),
  );
  // onError, not tapError: a defect or an interruption undoes the add too.
  return yield* bringIntoLibrary(source, request, step).pipe(Effect.onError(() => undo));
});

const bringIntoLibrary = Effect.fn('LibraryAdd.bring')(function* (source: LibraryAddSource, request: LibraryAddRequest, step: (event: Parameters<typeof libraryAddStep>[1]) => Effect.Effect<void>) {
  const store = yield* LibraryStore, media = yield* LibraryMediaFolder, latencies = yield* RecorderDeviceLatencies;
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  const interrupted = source.source.kind === 'studio-recorder' && source.source.status === 'interrupted';
  const probed = yield* Effect.forEach(source.tracks, (track) => Effect.all({
    streams: probeLibraryStreams(track.path), mediaSeconds: probeLibrarySeconds(track.path, { interrupted }),
  }).pipe(Effect.map((facts) => ({ ...track, ...facts }))));

  const mediaFolder = yield* media.online({ make: true });
  // A media folder left by a failed add holds footage too: its id stays taken.
  const taken = new Set([...(yield* store.itemIds()), ...(yield* fs.readDirectory(mediaFolder))]);
  const id = unusedLibraryItemId(yield* itemIdBase(source), taken), itemMedia = path.join(mediaFolder, id);
  yield* step({ type: 'probed', media: itemMedia });
  yield* fs.makeDirectory(itemMedia, { recursive: true });
  const marker = path.join(itemMedia, LIBRARY_ADD_MARKER_FILE);
  if (source.source.kind === 'studio-recorder') {
    const written: LibraryAddMarker = { take: source.source.folder, process: thisStudioProcess() };
    // A marker always encodes.
    yield* fs.writeFileString(marker, yield* Schema.encodeEffect(LibraryAddMarkerText)(written).pipe(Effect.orDie));
  }
  // Uninterruptible: a move interrupted between its copy and its record would leave a file no undo knows of.
  const bring = (from: string, to: string) => bringLibraryFile(from, to, request.move).pipe(Effect.andThen(step({ type: 'fileBrought', file: { from, to, moved: request.move } })), Effect.uninterruptible);

  const tracks: Record<string, LibraryTrack> = {};
  for (const track of probed) {
    const file = `${track.name}${path.extname(track.path).toLowerCase()}`;
    yield* Effect.log(`${request.move ? 'moving' : 'copying'} ${track.path} → ${path.join(itemMedia, file)}`);
    yield* bring(track.path, path.join(itemMedia, file));
    const latencySeconds = request.latencies?.[track.name] ?? track.latencySeconds ?? (track.device ? yield* latencies.latencyOf(track.device) : undefined);
    tracks[track.name] = {
      file, ...track.streams, mediaSeconds: track.mediaSeconds, startSeconds: track.startSeconds,
      ...(latencySeconds && { latencySeconds }), ...(track.hostDriftSeconds && { hostDriftSeconds: track.hostDriftSeconds }),
      ...(track.device && { device: track.device }), ...(track.display && { display: track.display }),
    };
  }
  if (source.input) yield* bring(source.input.path, path.join(itemMedia, 'input.jsonl'));
  for (const extra of [...(source.clockLog ? [source.clockLog] : []), ...(source.extras ?? [])]) yield* bring(extra, path.join(itemMedia, path.basename(extra)));
  yield* step({ type: 'broughtAll' });

  const speech = librarySpeechTrack(tracks);
  const item: LibraryItem = {
    format: LIBRARY_ITEM_FORMAT, id, title: source.title, source: source.source,
    ...(source.recordedAt && { recordedAt: source.recordedAt }), addedAt: DateTime.formatIso(yield* DateTime.now),
    durationSeconds: libraryItemDuration(tracks), tracks, ...(speech && { speech }),
    ...(source.input && { input: { file: 'input.jsonl', coordinates: source.input.coordinates } }),
    ...(source.problems && { problems: source.problems }), ...(source.leftOut && { leftOut: source.leftOut }),
  };
  yield* store.writeItem(item);
  yield* step({ type: 'metadataWritten' });
  if (request.move && source.source.kind === 'studio-recorder') yield* removeIfEmpty(source.source.folder);
  yield* Effect.log(`added ${id} to ${store.itemDir(id)}`);
  const finished = yield* finishLibraryItem(id, { proxies: request.proxies });
  yield* step({ type: 'finished' });
  yield* fs.remove(marker, { force: true });
  return finished;
});

/**
 * Makes what an item lacks from its media: its transcript, its speech levelled for the mix, then the proxies its tracks
 * need (with `proxies`). An add ends with it; run again, it picks up where a failed or interrupted add stopped. What's
 * made is read from item.json and transcript.json alone.
 */
export const finishLibraryItem = Effect.fn('LibraryAdd.finish')(function* (id: string, { proxies }: { proxies: boolean }) {
  const store = yield* LibraryStore, media = yield* LibraryMediaFolder, transcriber = yield* FootageTranscriber;
  const item = yield* store.readItem(id);
  if (item.speech && Option.isNone(yield* store.readTranscript(id))) {
    yield* Effect.log(`transcribing ${item.speech}`);
    const transcript = yield* transcriber.transcribe(yield* media.itemFile(id, item.tracks[item.speech].file));
    yield* store.writeTranscript(id, { track: item.speech, ...transcript });
  }
  // Levelling is a quick pass over the sound alone, so it's made even when proxies are left for later.
  yield* levelLibrarySpeech(id);
  return proxies ? yield* makeLibraryProxies(id) : yield* store.readItem(id);
});

/** What an add's paths name, judged before any file is touched. */
const libraryAddSourceOf = Effect.fn('LibraryAdd.sourceOf')(function* ({ paths, title, starts, devices, latencies }: LibraryAddRequest) {
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  if (!paths.length) return yield* refused('name a file, a recorder folder, or tracks as name=path');
  const named = paths.filter((p) => /^[\w-]+=/.test(p));
  if (named.length && named.length !== paths.length) return yield* refused('name every track as name=path, or add one file or folder alone');
  if (named.length) {
    return yield* Effect.fromResult(namedFilesAddSource(named.map((spec) => spec.replace(/=(.*)$/, (_, p: string) => `=${path.resolve(p)}`)), { title, starts, latencies, devices }));
  }
  if (paths.length > 1) return yield* refused('several files make one item only as named tracks: screen=a.mp4 camera=b.mp4');
  const target = path.resolve(paths[0]);
  if (!(yield* fs.exists(target))) return yield* refused(`${paths[0]} isn't there`);
  if ((yield* fs.stat(target)).type === 'Directory') {
    if (Object.keys({ ...starts, ...devices, ...latencies }).length) return yield* refused("a recorder's folder carries its own starts and latencies");
    const source = yield* recorderTakeSource(target, paths[0]);
    return title ? { ...source, title } : source;
  }
  // A lone file is named by what it holds.
  const streams = yield* probeLibraryStreams(target);
  return yield* Effect.fromResult(namedFilesAddSource([`${streams.video ? 'video' : 'audio'}=${target}`], { title, starts, latencies, devices }));
});

/** A recorder take's folder as an add source, refused while the recorder is still writing it. */
const recorderTakeSource = Effect.fn('LibraryAdd.recorderTake')(function* (folder: string, named: string) {
  const path = yield* Path.Path;
  const { recording, files, ending } = yield* readRecorderTakeFolder(folder, named);
  if (!ending) return yield* new LibraryTakeStillRecording({ named });
  return yield* Effect.fromResult(recorderAddSource(folder, path.basename(folder), recording, files, ending));
});

/** `2026-11-22-181929` for a recording, on its own clock; `2026-11-22-<title>` for files, dated today here. */
const itemIdBase = Effect.fn('LibraryAdd.itemIdBase')(function* ({ source, recordedAt, title }: LibraryAddSource) {
  if (source.kind === 'studio-recorder' && recordedAt) return recordedAt.slice(0, 19).replace('T', '-').replaceAll(':', '');
  const today = DateTime.formatIsoDate(DateTime.setZone(yield* DateTime.now, DateTime.zoneMakeLocal()));
  return `${today}-${librarySlug(title)}`;
});

const describeSource = ({ source }: LibraryAddSource) => (source.kind === 'studio-recorder' ? source.folder : source.paths.join(', '));

function sameSource(item: LibraryItem, { source }: LibraryAddSource): boolean {
  if (item.source.kind === 'studio-recorder' && source.kind === 'studio-recorder') return basename(item.source.folder) === basename(source.folder);
  return item.source.kind === 'files' && source.kind === 'files' && item.source.paths.join('\n') === source.paths.join('\n');
}

/**
 * `from` brought to `to`: renamed when moved within a volume, else copied (an APFS clone where it can be) and, when
 * moved, deleted. Node's copy is called directly: the FileSystem service's copy never clones.
 */
const bringLibraryFile = Effect.fn('LibraryAdd.bringFile')(function* (from: string, to: string, move: boolean) {
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  if (move && (yield* fs.stat(from)).dev === (yield* fs.stat(path.dirname(to))).dev) {
    yield* fs.rename(from, to);
    return;
  }
  yield* Effect.tryPromise({
    try: () => copyFile(from, to, constants.COPYFILE_FICLONE),
    catch: (cause) => PlatformError.systemError({ _tag: 'Unknown', module: 'FileSystem', method: 'copyFile', pathOrDescriptor: from, cause }),
  });
  if (move) yield* fs.remove(from);
});

const removeIfEmpty = Effect.fn('LibraryAdd.removeIfEmpty')(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem;
  const left = (yield* fs.readDirectory(folder)).filter((f) => f !== '.DS_Store');
  if (!left.length) yield* fs.remove(folder, { recursive: true });
});

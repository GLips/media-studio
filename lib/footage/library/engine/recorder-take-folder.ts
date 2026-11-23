// recorder-take-folder.ts: a Studio Recorder take's folder read from outside the recorder: its recording.json, its
// files, and whether the recorder is done with it (library-take-machine.ts). Node only.
import { Clock, Effect, FileSystem, Option, Path, Schema } from 'effect';
import { StudioRecordingJsonText } from '#lib/footage/recording/models/studio-recording-json.ts';
import { LibraryFileUnreadable, LibraryRequestRefused } from '../models/library-errors.ts';
import { observeRecorderTake, recorderTakeEnding, recorderTakeUnread } from '../models/library-take-machine.ts';

/** A take's folder as read now. No `ending` while the recorder is still writing it. */
export const readRecorderTakeFolder = Effect.fn('LibraryRecorderTake.read')(function* (folder: string, named: string) {
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  const recordingFile = path.join(folder, 'recording.json');
  if (!(yield* fs.exists(recordingFile))) return yield* new LibraryRequestRefused({ reason: `${named} is a folder without a recording.json: add its files as named tracks (name=path)` });
  const recording = yield* Schema.decodeUnknownEffect(StudioRecordingJsonText)(yield* fs.readFileString(recordingFile)).pipe(
    Effect.mapError((error) => new LibraryFileUnreadable({ path: recordingFile, reason: `isn't a recording this studio reads: ${error.message}` })),
  );
  const files = yield* fs.readDirectory(folder);
  const changes = yield* Effect.forEach(files, (file) => Effect.map(fs.stat(path.join(folder, file)), (info) => Option.getOrElse(Option.map(info.mtime, (at) => at.getTime()), () => 0)));
  const take = observeRecorderTake(
    observeRecorderTake(recorderTakeUnread(), { type: 'recordingRead', recording }),
    { type: 'filesSeen', newestChangeMs: Math.max(0, ...changes), nowMs: yield* Clock.currentTimeMillis },
  );
  return { recording, files: new Set(files), ending: recorderTakeEnding(take) };
});

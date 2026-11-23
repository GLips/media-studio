// recording-take-logs.ts: a take's line logs, input.jsonl, clock.jsonl and window.jsonl, read as Streams of decoded
// lines, by the recorder's line rule (recorder-log-lines.ts: a torn last line is dropped, any other bad line refuses
// the log). Node only.
import type { PlatformError } from 'effect';
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { InputEventLine, type InputEvent } from '#lib/footage/input-log/models/input-log.ts';
import { recorderLogLineStep, type RecorderLogHeldLine, type RecordingLogLineUnreadable } from '#lib/footage/input-log/models/recorder-log-lines.ts';
import { RecordingClockSampleLine, type RecordingClockSample } from '#lib/footage/recording/models/recording-clock-log.ts';
import { RecordingWindowPlacementLine, type RecordingWindowPlacement } from '#lib/footage/recording/models/recording-window-log.ts';

function streamRecordingLog<S extends Schema.Decoder<unknown>>(path: string, lineSchema: S, holds: string) {
  const decodeLine = Schema.decodeUnknownResult(lineSchema);
  return Stream.unwrap(Effect.map(FileSystem.FileSystem, (fs) => fs.stream(path))).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.zipWithIndex,
    Stream.filter(([text]) => text.trim() !== ''),
    Stream.mapAccumEffect((): RecorderLogHeldLine => undefined, (held, [text, index]) =>
      Effect.fromResult(recorderLogLineStep({ path, holds }, held, index + 1, decodeLine(text)))),
  );
}

/** A take's input.jsonl, event by event. */
export const streamRecordingInputLog = (path: string): Stream.Stream<InputEvent, RecordingLogLineUnreadable | PlatformError.PlatformError, FileSystem.FileSystem> =>
  streamRecordingLog(path, InputEventLine, 'an input event');

/** A take's clock.jsonl, sample by sample. */
export const streamRecordingClockLog = (path: string): Stream.Stream<RecordingClockSample, RecordingLogLineUnreadable | PlatformError.PlatformError, FileSystem.FileSystem> =>
  streamRecordingLog(path, RecordingClockSampleLine, 'a clock sample');

/** A window capture's window.jsonl, placement by placement. */
export const streamRecordingWindowLog = (path: string): Stream.Stream<RecordingWindowPlacement, RecordingLogLineUnreadable | PlatformError.PlatformError, FileSystem.FileSystem> =>
  streamRecordingLog(path, RecordingWindowPlacementLine, 'a window placement');

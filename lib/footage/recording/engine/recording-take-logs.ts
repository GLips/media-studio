// recording-take-logs.ts: a take's line logs, input.jsonl and clock.jsonl, read as Streams of decoded lines. Node
// only. The recorder appends a line per event; one killed mid-take can leave its last line torn, which is dropped as
// the lines before it stand. Any other line that isn't what the log holds refuses the log, naming the file and line.
import type { PlatformError } from 'effect';
import { Effect, FileSystem, Option, Schema, Stream } from 'effect';
import { InputEventLine, type InputEvent } from '#lib/footage/input-log/models/input-log.ts';
import { RecordingClockSampleLine, type RecordingClockSample } from '#lib/footage/recording/models/recording-clock-log.ts';

/** A line of a take's log that isn't what the log holds, and isn't its torn last line. `line` counts from 1. */
export class RecordingLogLineUnreadable extends Schema.TaggedError<RecordingLogLineUnreadable>()('RecordingLogLineUnreadable', {
  path: Schema.String,
  line: Schema.Finite,
  holds: Schema.String,
  why: Schema.String,
}) {
  override get message(): string {
    return `${this.path} line ${this.line} isn't ${this.holds}: ${this.why}`;
  }
}

/** A bad line held back until the next line shows it wasn't the last. */
type HeldLine = { line: number; why: string };

function streamRecordingLog<S extends Schema.Decoder<unknown>>(path: string, lineSchema: S, holds: string) {
  const decodeLine = Schema.decodeUnknownEffect(lineSchema);
  return Stream.unwrap(Effect.map(FileSystem.FileSystem, (fs) => fs.stream(path))).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.zipWithIndex,
    Stream.filter(([text]) => text.trim() !== ''),
    Stream.mapAccumEffect(Option.none<HeldLine>, (held, [text, index]) => Option.match(held, {
      onSome: ({ line, why }) => Effect.fail(new RecordingLogLineUnreadable({ path, line, holds, why })),
      onNone: () => decodeLine(text).pipe(Effect.match({
        onSuccess: (value): readonly [Option.Option<HeldLine>, readonly S['Type'][]] => [Option.none(), [value]],
        onFailure: (error): readonly [Option.Option<HeldLine>, readonly S['Type'][]] => [Option.some({ line: index + 1, why: error.message }), []],
      })),
    })),
  );
}

/** A take's input.jsonl, event by event. */
export const streamRecordingInputLog = (path: string): Stream.Stream<InputEvent, RecordingLogLineUnreadable | PlatformError.PlatformError, FileSystem.FileSystem> =>
  streamRecordingLog(path, InputEventLine, 'an input event');

/** A take's clock.jsonl, sample by sample. */
export const streamRecordingClockLog = (path: string): Stream.Stream<RecordingClockSample, RecordingLogLineUnreadable | PlatformError.PlatformError, FileSystem.FileSystem> =>
  streamRecordingLog(path, RecordingClockSampleLine, 'a clock sample');

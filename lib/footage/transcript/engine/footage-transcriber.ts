// footage-transcriber.ts: transcription as an Effect service, the contract every Effect caller (the library's add)
// transcribes through. A test provides a fake layer instead of whisper.
import { Context, Effect, Layer, Schema } from 'effect';
import type { FootageTranscript } from '../models/footage-transcript.ts';
import { transcribeFootage } from './transcribe-footage.ts';

/** Whisper, or reading the file's sound, failed: `reason` says how. */
export class TranscriptionFailed extends Schema.TaggedError<TranscriptionFailed>()('TranscriptionFailed', {
  path: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `couldn't transcribe ${this.path}: ${this.reason}`;
  }
}

export class FootageTranscriber extends Context.Service<FootageTranscriber, {
  /** What's said in `path` and when, from the user cache when it was heard before. */
  readonly transcribe: (path: string) => Effect.Effect<FootageTranscript, TranscriptionFailed>;
}>()('FootageTranscriber') {}

/** The transcriber over local whisper.cpp; needs only Node's services beneath it. */
export const footageTranscriberLayer = Layer.succeed(FootageTranscriber, FootageTranscriber.of({
  transcribe: (path) => Effect.tryPromise({
    try: () => transcribeFootage(path),
    catch: (error) => new TranscriptionFailed({ path, reason: error instanceof Error ? error.message : String(error) }),
  }),
}));

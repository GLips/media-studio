// footage-transcriber.ts: transcription as an Effect service, the contract every caller (the library's add, `studio
// transcribe`, the voice cutter) transcribes through, and its implementation over local whisper.cpp. A test provides
// fake whisper and ffmpeg layers beneath it, or a fake transcriber instead.
//
// Whisper over a whole long file drifts by seconds across pauses and folds a repeated phrase into one, so the audio is
// split at its pauses into pieces whisper hears one at a time, in one run that loads the model once. The job's steps,
// and where each can fail, are transcription-job-machine.ts; this file runs the step each state waits on.
import { Context, Effect, FileSystem, Layer, Option, Path, Result, Schema } from 'effect';
import { initialTransition, transition } from 'xstate';
import type { FootageTranscript } from '../models/footage-transcript.ts';
import type { TranscriptAudio } from '../models/transcription-job-machine.ts';
import { transcriptionJobMachine, transcriptionStepDue, TranscriptionStepDue } from '../models/transcription-job-machine.ts';
import type { TranscriptPiece } from '../models/transcript-audio.ts';
import { TranscriptCache, transcriptCacheLayer } from './transcript-cache.ts';
import { WhisperCpp, whisperCppLayer } from './whisper-cpp.ts';
import { StudioFfmpeg, studioFfmpegLayer } from '#lib/platform/ffmpeg/engine/studio-ffmpeg.ts';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';
import { samplesFromWav, wavFromSamples } from '#lib/platform/wav/models/wav.ts';

// whisper.cpp only reads 16 kHz mono.
const WHISPER_RATE = 16000;

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
  /**
   * What's said in `path` (any file ffmpeg reads with an audio track) and when, from the user cache when it was heard
   * before. Whisper's spelling is not a script's; see alignSpokenWords.
   */
  readonly transcribe: (path: string) => Effect.Effect<FootageTranscript, TranscriptionFailed>;
}>()('FootageTranscriber') {}

/** The samples a piece keeps, back to back, as whisper hears them. */
function pieceSamples({ samples, rate }: TranscriptAudio, piece: TranscriptPiece): Int16Array {
  const kept = piece.kept.map((span) => samples.subarray(Math.round(span.start * rate), Math.round(span.end * rate)));
  const joined = new Int16Array(kept.reduce((sum, span) => sum + span.length, 0));
  kept.reduce((at, span) => (joined.set(span, at), at + span.length), 0);
  return joined;
}

/** The transcriber over whatever whisper, cache and ffmpeg are beneath it. */
export const whisperFootageTranscriberLayer = Layer.effect(FootageTranscriber, Effect.gen(function* () {
  const whisper = yield* WhisperCpp, cache = yield* TranscriptCache, ffmpeg = yield* StudioFfmpeg;
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;

  /** Runs the step `due` names, in `work` (the job's temp folder), and answers with the event its outcome is. */
  const runStep = (footage: string, work: string, due: TranscriptionStepDue) => TranscriptionStepDue.$match(due, {
    CheckCache: () => Effect.gen(function* () {
      const cacheKey = yield* cache.keyOf(footage, whisper.transcriber);
      return Option.match(yield* cache.read(cacheKey), {
        onSome: (transcript) => ({ type: 'cacheHit' as const, transcript }),
        onNone: () => ({ type: 'cacheMissed' as const, cacheKey }),
      });
    }),
    InstallWhisper: () => whisper.install.pipe(Effect.as({ type: 'whisperInstalled' as const })),
    ExtractAudio: () => Effect.gen(function* () {
      const audio = path.join(work, 'audio.wav');
      yield* ffmpeg.run(['-v', 'error', '-y', '-i', footage, '-vn', '-ar', String(WHISPER_RATE), '-ac', '1', '-c:a', 'pcm_s16le', audio]);
      const wav = yield* fs.readFile(audio);
      const { samples, rate } = yield* Effect.try({
        try: () => samplesFromWav(Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength)),
        // samplesFromWav throws only Errors, saying what the WAV lacks.
        catch: (error) => new TranscriptionFailed({ path: footage, reason: error instanceof Error ? error.message : String(error) }),
      });
      return { type: 'audioExtracted' as const, samples, rate };
    }),
    HearPieces: ({ audio }) => Effect.gen(function* () {
      const wavs = yield* Effect.forEach(audio.pieces, (piece, i) => {
        const file = path.join(work, `piece-${i}.wav`);
        return fs.writeFile(file, wavFromSamples(pieceSamples(audio, piece), audio.rate)).pipe(Effect.as(file));
      });
      return { type: 'piecesHeard' as const, tokens: yield* whisper.hear(wavs) };
    }),
    CacheTranscript: ({ cacheKey, transcript }) => cache.write(cacheKey, transcript).pipe(Effect.as({ type: 'transcriptCached' as const })),
  }).pipe(Effect.catch((error) => Effect.succeed({ type: 'stepFailed' as const, reason: error.message })));

  const transcribe = Effect.fn('FootageTranscriber.transcribe')(function* (footage: string) {
    const work = yield* fs.makeTempDirectoryScoped({ directory: yield* Effect.sync(studioTempRoot), prefix: 'transcribe-' })
      .pipe(Effect.mapError((error) => new TranscriptionFailed({ path: footage, reason: error.message })));
    let [job] = initialTransition(transcriptionJobMachine, { path: footage });
    while (job.status === 'active') [job] = transition(transcriptionJobMachine, job, yield* runStep(footage, work, transcriptionStepDue(job)));
    // A job only stops in a final state; an error snapshot is a transition that threw, a bug here.
    if (job.status !== 'done') return yield* Effect.die(job.error);
    return yield* Result.match(job.output, {
      onSuccess: Effect.succeed,
      onFailure: ({ step, reason }) => Effect.fail(new TranscriptionFailed({ path: footage, reason: `${step}: ${reason}` })),
    });
  }, Effect.scoped);

  return FootageTranscriber.of({ transcribe });
}));

/** The transcriber over local whisper.cpp, its cache in the user cache; needs only Node's services beneath it. */
export const footageTranscriberLayer = whisperFootageTranscriberLayer.pipe(Layer.provide([whisperCppLayer, transcriptCacheLayer, studioFfmpegLayer]));

// transcription-job-machine.ts: one file's transcription, from asking the cache to a transcript or the step that
// failed, as one machine. Pure: each working state names the step its driver runs next (footage-transcriber.ts), and
// the step's outcome comes back as an event; the steps that only compute (planning pieces, timing words) happen here.
//
// checkingCache ─cacheHit─────────────────────────────────────────────────────────────────────────▶ transcribed
//      └─cacheMissed▶ installingWhisper ─▶ extractingAudio ─▶ hearingPieces ─▶ timingWords ─▶ caching ─▶ transcribed
// Every working state but timingWords and caching goes to its own failed state on stepFailed; a failed write to the
// cache ends in transcribedUncached, which still delivers the transcript. Every final state ends the job.
import { Data, Option, Result } from 'effect';
import { setup, types } from 'xstate';
import type { SnapshotFrom } from 'xstate';
import type { FootageTranscript } from './footage-transcript.ts';
import { audioFrameLevels, audioPauses, planTranscriptPieces, quietAudioLevel, wordsTimedAtPauses, type TranscriptPiece } from './transcript-audio.ts';
import { whisperWordsInFile, type WhisperToken } from './whisper-heard-words.ts';

/** A file's sound as whisper hears it (16-bit mono), with where it's quiet and the pieces it's split into. */
export interface TranscriptAudio {
  readonly samples: Int16Array;
  readonly rate: number;
  readonly levels: readonly number[];
  readonly quiet: number;
  readonly pieces: readonly TranscriptPiece[];
}

interface CacheKeyed { readonly cacheKey: string }
interface AudioHeard extends CacheKeyed { readonly audio: TranscriptAudio; readonly tokens: readonly (readonly WhisperToken[])[] }
interface StepFailure { readonly reason: string }

/** The step a job failed at, as a sentence's start ("installing whisper.cpp"), and why. */
export interface TranscriptionStepFailure extends StepFailure { readonly step: string }

const failedAt = (step: string) => ({ input }: { input: StepFailure }): Result.Result<FootageTranscript, TranscriptionStepFailure> =>
  Result.fail({ step, reason: input.reason });

const s = setup({
  schemas: {
    context: types<{ readonly path: string }>(),
    input: types<{ readonly path: string }>(),
    events: {
      /** The cache holds a transcript for the file as it is now. */
      cacheHit: types<{ readonly transcript: FootageTranscript }>(),
      cacheMissed: types<CacheKeyed>(),
      whisperInstalled: types<object>(),
      audioExtracted: types<{ readonly samples: Int16Array; readonly rate: number }>(),
      /** Whisper's tokens for each piece, in the pieces' order. */
      piecesHeard: types<{ readonly tokens: readonly (readonly WhisperToken[])[] }>(),
      transcriptCached: types<object>(),
      stepFailed: types<StepFailure>(),
    },
  },
  states: {
    checkingCache: {},
    installingWhisper: { id: 'installingWhisper', schemas: { input: types<CacheKeyed>() } },
    extractingAudio: { id: 'extractingAudio', schemas: { input: types<CacheKeyed>() } },
    hearingPieces: { id: 'hearingPieces', schemas: { input: types<CacheKeyed & { readonly audio: TranscriptAudio }>() } },
    timingWords: { id: 'timingWords', schemas: { input: types<AudioHeard>() } },
    caching: { id: 'caching', schemas: { input: types<CacheKeyed & { readonly transcript: FootageTranscript }>() } },
    transcribed: { id: 'transcribed', type: 'final', schemas: { input: types<{ readonly transcript: FootageTranscript }>() } },
    // Heard, but not kept for next time: `reason` says why the cache refused it.
    transcribedUncached: { id: 'transcribedUncached', type: 'final', schemas: { input: types<StepFailure & { readonly transcript: FootageTranscript }>() } },
    // The footage's own bytes couldn't be read for its cache key: it's missing or unreadable.
    footageUnreadable: { id: 'footageUnreadable', type: 'final', schemas: { input: types<StepFailure>() } },
    whisperInstallFailed: { id: 'whisperInstallFailed', type: 'final', schemas: { input: types<StepFailure>() } },
    audioExtractionFailed: { id: 'audioExtractionFailed', type: 'final', schemas: { input: types<StepFailure>() } },
    hearingFailed: { id: 'hearingFailed', type: 'final', schemas: { input: types<StepFailure>() } },
  },
});

/** The job for one file, its path given as input. */
export const transcriptionJobMachine = s.createMachine({
  id: 'transcriptionJob',
  context: ({ input }) => ({ path: input.path }),
  initial: 'checkingCache',
  states: {
    checkingCache: {
      on: {
        cacheHit: ({ event }) => ({ target: '#transcribed', input: { transcript: event.transcript } }),
        cacheMissed: ({ event }) => ({ target: '#installingWhisper', input: { cacheKey: event.cacheKey } }),
        stepFailed: ({ event }) => ({ target: '#footageUnreadable', input: { reason: event.reason } }),
      },
    },
    installingWhisper: {
      on: {
        whisperInstalled: ({ input }) => ({ target: '#extractingAudio', input: { cacheKey: input.cacheKey } }),
        stepFailed: ({ event }) => ({ target: '#whisperInstallFailed', input: { reason: event.reason } }),
      },
    },
    extractingAudio: {
      on: {
        audioExtracted: ({ input, event: { samples, rate } }) => {
          const levels = audioFrameLevels(samples, rate), quiet = quietAudioLevel(levels);
          const audio = { samples, rate, levels, quiet, pieces: planTranscriptPieces(levels, quiet) };
          return { target: '#hearingPieces', input: { cacheKey: input.cacheKey, audio } };
        },
        stepFailed: ({ event }) => ({ target: '#audioExtractionFailed', input: { reason: event.reason } }),
      },
    },
    hearingPieces: {
      on: {
        piecesHeard: ({ input, event }) => ({ target: '#timingWords', input: { ...input, tokens: event.tokens } }),
        stepFailed: ({ event }) => ({ target: '#hearingFailed', input: { reason: event.reason } }),
      },
    },
    // Whisper says which words it heard and roughly where; the audio's pauses place their edges.
    timingWords: {
      always: ({ input: { cacheKey, audio, tokens } }) => {
        const { samples, rate, levels, quiet, pieces } = audio;
        const pauses = audioPauses(levels, quiet), duration = samples.length / rate;
        const heard = pieces.flatMap((piece, i) => whisperWordsInFile(tokens[i] ?? [], piece));
        return { target: '#caching', input: { cacheKey, transcript: { duration, words: wordsTimedAtPauses(heard, pauses, duration), pauses } } };
      },
    },
    caching: {
      on: {
        transcriptCached: ({ input }) => ({ target: '#transcribed', input: { transcript: input.transcript } }),
        // A whole whisper run is worth more than the cache entry, so the job delivers the transcript anyway.
        stepFailed: ({ input, event }) => ({ target: '#transcribedUncached', input: { transcript: input.transcript, reason: event.reason } }),
      },
    },
    transcribed: { output: ({ input }) => Result.succeed(input.transcript) },
    transcribedUncached: { output: ({ input }) => Result.succeed(input.transcript) },
    footageUnreadable: { output: failedAt('reading the file') },
    whisperInstallFailed: { output: failedAt('installing whisper.cpp') },
    audioExtractionFailed: { output: failedAt('reading its sound') },
    hearingFailed: { output: failedAt('hearing it with whisper') },
  },
});

export type TranscriptionJobSnapshot = SnapshotFrom<typeof transcriptionJobMachine>;

/** The step an active job waits on, which its driver runs and answers with the event its outcome is. */
export type TranscriptionStepDue = Data.TaggedEnum<{
  CheckCache: {};
  InstallWhisper: {};
  ExtractAudio: {};
  HearPieces: { readonly audio: TranscriptAudio };
  CacheTranscript: { readonly cacheKey: string; readonly transcript: FootageTranscript };
}>;
export const TranscriptionStepDue = Data.taggedEnum<TranscriptionStepDue>();

/**
 * The step an active `job` waits on; none for a state with no step, which a driver treats as a bug, never as a step
 * to retry. Only the active state has an input; timingWords is never at rest. A finished job's outcome is its output:
 * the transcript, or the step that failed.
 */
export function transcriptionStepDue(job: TranscriptionJobSnapshot): Option.Option<TranscriptionStepDue> {
  const inputs = job.getInputs();
  if (job.matches('checkingCache')) return Option.some(TranscriptionStepDue.CheckCache());
  if (inputs.installingWhisper) return Option.some(TranscriptionStepDue.InstallWhisper());
  if (inputs.extractingAudio) return Option.some(TranscriptionStepDue.ExtractAudio());
  if (inputs.hearingPieces) return Option.some(TranscriptionStepDue.HearPieces({ audio: inputs.hearingPieces.audio }));
  if (inputs.caching) return Option.some(TranscriptionStepDue.CacheTranscript(inputs.caching));
  return Option.none();
}

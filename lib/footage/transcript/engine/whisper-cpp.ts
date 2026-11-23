// whisper-cpp.ts: local whisper.cpp as an Effect service: installed on first use, then run over WAV files. Node only.
//
// whisper.cpp and its model live outside the repo, in the studio's user cache (~/.cache/media-studio), so worktrees
// share one ~1.5 GB model and one build.
import { downloadWhisperModel, installWhisperCpp } from '@remotion/install-whisper-cpp';
import { Context, Effect, FileSystem, Layer, Path, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { WhisperFullJson, type WhisperToken } from '../models/whisper-heard-words.ts';
import { STUDIO_CHILD_PROCESS } from '#lib/platform/process/engine/studio-child-process.ts';
import { toolStderrReason } from '#lib/platform/process/models/tool-stderr-reason.ts';
import { studioUserCacheDir } from '#lib/platform/temp/engine/studio-user-cache.ts';

const WHISPER_CPP_VERSION = '1.8.6';
// On a 21-minute raw mic recording, medium.en's words, edged by the pauses, start and end within 0.1 s of the pauses
// around them at 85% of pauses (median 0); it hears the file in about a twelfth of its length on an M-series GPU.
const WHISPER_MODEL = 'medium.en';

/** Installing whisper.cpp or its model failed, or whisper-cli failed over a run's files. */
export class WhisperFailed extends Schema.TaggedError<WhisperFailed>()('WhisperFailed', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

export class WhisperCpp extends Context.Service<WhisperCpp, {
  /**
   * Names everything a transcript depends on besides its file and this code's planning: the build, the model, and
   * how pieces are heard. A cached transcript is keyed by it, so a change here re-hears every file.
   */
  readonly transcriber: string;
  /** Installs whisper.cpp and its model if the user cache lacks them; once per layer, however often it's asked. */
  readonly install: Effect.Effect<void, WhisperFailed>;
  /** Whisper's tokens for each of `wavs` (16 kHz mono), in order, from one run that loads the model once. */
  readonly hear: (wavs: readonly string[]) => Effect.Effect<readonly (readonly WhisperToken[])[], WhisperFailed>;
}>()('WhisperCpp') {}

const whisperFailed = (error: { readonly message: string }) => new WhisperFailed({ reason: error.message });

export const whisperCppLayer = Layer.effect(WhisperCpp, Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path, spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const home = studioUserCacheDir(`whisper.cpp-${WHISPER_CPP_VERSION}`);

  // Both installers return at once when their files are there, so a fresh layer per run costs two stats.
  const install = yield* Effect.cached(Effect.tryPromise({
    try: async () => {
      await installWhisperCpp({ to: home, version: WHISPER_CPP_VERSION, printOutput: false });
      await downloadWhisperModel({ model: WHISPER_MODEL, folder: home, printOutput: false });
    },
    catch: (error) => new WhisperFailed({ reason: `couldn't install whisper.cpp ${WHISPER_CPP_VERSION}: ${String(error)}` }),
  }));

  const readTokens = Effect.fn('WhisperCpp.readTokens')(function* (wav: string) {
    const json = yield* fs.readFileString(`${wav}.json`);
    const { transcription } = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(WhisperFullJson))(json);
    return transcription.flatMap((segment) => segment.tokens);
  }, Effect.mapError(whisperFailed));

  const hear = Effect.fn('WhisperCpp.hear')(function* (wavs: readonly string[]) {
    if (!wavs.length) return [];
    const run = ChildProcess.make(path.join(home, 'build', 'bin', 'whisper-cli'), [
      // whisper.cpp skips DTW, and so every token's t_dtw, when flash attention is on, as it is by default.
      '-m', path.join(home, `ggml-${WHISPER_MODEL}.bin`), '--dtw', WHISPER_MODEL, '-nfa',
      // A segment per token, each JSON beside its WAV; -mc 0 keeps one piece's words from steering the next's.
      '-ml', '1', '-oj', '-ojf', '-mc', '0', '-np', ...wavs,
    ], STUDIO_CHILD_PROCESS);
    const handle = yield* spawner.spawn(run).pipe(Effect.mapError(whisperFailed));
    const [stderr, exitCode] = yield* Effect.all([
      handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
      handle.exitCode,
      handle.stdout.pipe(Stream.runDrain),
    ], { concurrency: 'unbounded' }).pipe(Effect.mapError(whisperFailed));
    if (exitCode !== 0) {
      // whisper-cli's stderr is a log of loading the model; its last lines say why a run failed.
      const why = toolStderrReason(stderr);
      return yield* new WhisperFailed({ reason: `whisper-cli exited with ${exitCode}${why ? `: ${why}` : ''}` });
    }
    return yield* Effect.forEach(wavs, readTokens);
  }, Effect.scoped);

  return WhisperCpp.of({ transcriber: `whisper.cpp-${WHISPER_CPP_VERSION}/${WHISPER_MODEL}/pieces-1`, install, hear });
}));

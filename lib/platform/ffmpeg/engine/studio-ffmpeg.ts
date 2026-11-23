// studio-ffmpeg.ts: ffmpeg and ffprobe as an Effect service, for Effect code. The same binaries ffmpeg.ts starts for
// the studio's promise-and-sync code; this owner wraps them in typed failures so a caller recovers by tag, and a test
// provides a fake layer instead of a binary.
import { Context, Effect, Layer, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

/** ffmpeg or ffprobe exited non-zero, or couldn't start. `stderr` is its last lines, where it says why. */
export class FfmpegFailed extends Schema.TaggedError<FfmpegFailed>()('FfmpegFailed', {
  tool: Schema.Literals(['ffmpeg', 'ffprobe']),
  args: Schema.Array(Schema.String),
  exitCode: Schema.optional(Schema.Number),
  stderr: Schema.String,
}) {
  override get message(): string {
    const why = this.stderr.trim().split('\n').at(-1) ?? '';
    return `${this.tool} ${this.exitCode === undefined ? "couldn't start" : `exited with ${this.exitCode}`}${why ? `: ${why}` : ''}`;
  }
}

/** A run whose report is on stderr (loudnorm, ebur128): its stderr and exit code, whatever the code. */
export type FfmpegReport = { readonly stderr: string; readonly exitCode: number };

export class StudioFfmpeg extends Context.Service<StudioFfmpeg, {
  /** ffmpeg to completion; fails with its stderr on a non-zero exit. */
  readonly run: (args: readonly string[]) => Effect.Effect<void, FfmpegFailed>;
  /** ffprobe's stdout; fails with its stderr on a non-zero exit. */
  readonly probe: (args: readonly string[]) => Effect.Effect<string, FfmpegFailed>;
  /** ffmpeg whose stderr is the answer: never fails on its exit code, which the caller reads beside the text. */
  readonly report: (args: readonly string[]) => Effect.Effect<FfmpegReport, FfmpegFailed>;
}>()('StudioFfmpeg') {}

// ffmpeg's stderr on a long encode is progress noise; only its end says why it failed.
const STDERR_TAIL = 8000;

const decodeText = <E>(stream: Stream.Stream<Uint8Array, E>) => stream.pipe(Stream.decodeText(), Stream.mkString);

export const studioFfmpegLayer = Layer.effect(StudioFfmpeg, Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const exec = Effect.fn('StudioFfmpeg.exec')(function* (tool: 'ffmpeg' | 'ffprobe', args: readonly string[]) {
    const failed = (stderr: string, exitCode?: number) => new FfmpegFailed({ tool, args: [...args], stderr: stderr.slice(-STDERR_TAIL), ...(exitCode !== undefined && { exitCode }) });
    const handle = yield* spawner.spawn(ChildProcess.make(tool, [...args])).pipe(Effect.mapError((error) => failed(error.message)));
    const [stdout, stderr, exitCode] = yield* Effect.all([decodeText(handle.stdout), decodeText(handle.stderr), handle.exitCode], { concurrency: 'unbounded' })
      .pipe(Effect.mapError((error) => failed(error.message)));
    return { stdout, stderr: stderr.slice(-STDERR_TAIL), exitCode: Number(exitCode), failed };
  }, Effect.scoped);

  return StudioFfmpeg.of({
    run: Effect.fn('StudioFfmpeg.run')(function* (args) {
      const { stderr, exitCode, failed } = yield* exec('ffmpeg', args);
      if (exitCode !== 0) yield* failed(stderr, exitCode);
    }),
    probe: Effect.fn('StudioFfmpeg.probe')(function* (args) {
      const { stdout, stderr, exitCode, failed } = yield* exec('ffprobe', args);
      if (exitCode !== 0) return yield* failed(stderr, exitCode);
      return stdout;
    }),
    report: Effect.fn('StudioFfmpeg.report')(function* (args) {
      const { stderr, exitCode } = yield* exec('ffmpeg', args);
      return { stderr, exitCode };
    }),
  });
}));

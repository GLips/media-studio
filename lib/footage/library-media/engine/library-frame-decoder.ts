// library-frame-decoder.ts: a library track's pictures, frame by frame, as JPEGs, for a render's pages to draw
// (library-video.tsx). ffmpeg decodes a file forward from a seek onto a fixed frame grid, so a render's frames, asked
// for in rough order by its several tabs, cost one decode each; a jump back or far ahead starts another decoder.
//
// The pool of open decoders lives in its layer's scope: each decoder is a child scope holding its ffmpeg and the
// fiber reading its frames, closed when it idles, when a newer one needs its place, or with the layer. Each
// decoder's life is libraryFrameDecoderMachine's, which its reads wait on. Node only.
import { Clock, Context, Data, Duration, Effect, Exit, FiberHandle, Layer, Option, Predicate, Ref, Schedule, Schema, Scope, Semaphore, Stream, SubscriptionRef, SynchronizedRef } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { startStudioFfmpegOutput, StudioFfmpeg } from '#lib/platform/ffmpeg/engine/studio-ffmpeg.ts';
import { libraryFrameDecoderFailure, libraryFrameDecoderStarted, libraryFrameDecoderStep, type LibraryFrameDecoderEvent, type LibraryFrameDecoderSnapshot } from '../models/library-frame-decoder-machine.ts';

/** Frames a decoder keeps behind its head, for tabs a little behind the others; and how far ahead it reads on. */
const KEPT_FRAMES = 90, READ_AHEAD_FRAMES = 90;
/** Seconds decoded before the asked-for time on a seek, so the grid's first frame shows what was on screen then. */
const SEEK_LEAD_SECONDS = 0.5;
/** Decoders open at once, across files; and how long an unused one lives. */
const MAX_DECODERS = 8, DECODER_IDLE = Duration.seconds(15);
/** Times a read is asked again after the decoder it went to closed or moved past its frame, before it gives up. */
const MISSED_READ_RETRIES = 4;

/** What to decode: a file, at a width, on a grid of `fps` frames a second. */
export type LibraryFrameSource = { path: string; width: number; fps: number };

/** ffmpeg couldn't give a picture of the file from a decoder's seek, `seekSeconds` into it. */
export class LibraryFrameUndecodable extends Schema.TaggedError<LibraryFrameUndecodable>()('LibraryFrameUndecodable', {
  path: Schema.String,
  seekSeconds: Schema.Finite,
  why: Schema.String,
}) {
  override get message(): string {
    return `ffmpeg couldn't decode ${this.path} from ${this.seekSeconds.toFixed(3)} s: ${this.why}`;
  }
}

/** The decoder a read went to closed, or moved past its frame, before the read's turn; another may give it. */
class LibraryFrameMissed extends Schema.TaggedError<LibraryFrameMissed>()('LibraryFrameMissed', { path: Schema.String, seconds: Schema.Finite }) {
  override get message(): string {
    return `every decoder of ${this.path} stopped short of ${this.seconds.toFixed(3)} s`;
  }
}

export class LibraryFrameDecoders extends Context.Service<LibraryFrameDecoders, {
  /**
   * The JPEG of `source`'s picture at `seconds` of its media time, on its grid, or its last when the file ends
   * first: a track holds its last picture.
   */
  readonly frameAt: (source: LibraryFrameSource, seconds: number) => Effect.Effect<Buffer, LibraryFrameUndecodable>;
}>()('LibraryFrameDecoders') {}

type DecoderView = {
  readonly process: LibraryFrameDecoderSnapshot;
  /** Decoded frames by grid index from the seek, the newest KEPT_FRAMES. */
  readonly frames: ReadonlyMap<number, Buffer>;
  /** The grid index the read being served waits for, or -1: ffmpeg is read only while a read waits. */
  readonly wanted: number;
};

type Decoder = {
  readonly key: string;
  readonly path: string;
  readonly start: number;
  readonly fps: number;
  readonly view: SubscriptionRef.SubscriptionRef<DecoderView>;
  readonly scope: Scope.Closeable;
  /** Reads are served one at a time, in the order asked. */
  readonly turn: Semaphore.Semaphore;
  /** The close an idle decoder has coming, restarted by each read. */
  readonly idle: FiberHandle.FiberHandle;
};

/** What a read of one decoder came to. */
type FrameRead = Data.TaggedEnum<{ Frame: { jpeg: Buffer }; Missed: {}; Undecodable: { why: string } }>;
const FrameRead = Data.taggedEnum<FrameRead>();

/** The grid index the next decoded frame will have. */
const nextIndex = (view: DecoderView) => view.process.context.decoded;

/** Whether a decoder in `view` will hold grid frame `index`: it has it, or reads on to it, or it's past a clean end. */
function reaches(view: DecoderView, index: number): boolean {
  if (view.frames.has(index)) return true;
  if (index < nextIndex(view)) return false;
  if (view.process.matches('decoding')) return index < nextIndex(view) + READ_AHEAD_FRAMES;
  return view.process.matches('finished') && view.frames.size > 0;
}

/** What a read of frame `index` comes to with the decoder in `view`, or undefined while it must wait. */
function frameReadOf(decoder: Decoder, view: DecoderView, index: number): FrameRead | undefined {
  const failure = libraryFrameDecoderFailure(view.process);
  if (failure !== undefined) return FrameRead.Undecodable({ why: failure });
  const finished = view.process.matches('finished');
  const frame = view.frames.get(index) ?? (finished && index >= nextIndex(view) ? view.frames.get(nextIndex(view) - 1) : undefined);
  if (frame) return FrameRead.Frame({ jpeg: frame });
  if (index < nextIndex(view) || view.process.matches('stopped')) return FrameRead.Missed();
  if (finished) return FrameRead.Undecodable({ why: `the file ended before ${(decoder.start + index / decoder.fps).toFixed(3)} s, and decoded nothing` });
  return undefined;
}

const EOI = Buffer.from([0xff, 0xd9]);

/** An MJPEG stream's JPEGs: each runs from its SOI (FFD8) to its EOI (FFD9), which ffmpeg never escapes. */
const splitJpegs = <E>(bytes: Stream.Stream<Uint8Array, E>) => bytes.pipe(
  Stream.mapAccum((): Buffer => Buffer.alloc(0), (pending, chunk) => {
    const jpegs: Buffer[] = [];
    let rest = pending.length ? Buffer.concat([pending, chunk]) : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (let end = rest.indexOf(EOI); end >= 0; end = rest.indexOf(EOI)) {
      jpegs.push(rest.subarray(0, end + 2));
      rest = rest.subarray(end + 2);
    }
    return [rest, jpegs] as const;
  }),
);

/** ffmpeg's arguments to read `source` from `start`, up to its output. */
function decoderInput(source: LibraryFrameSource, start: number): string[] {
  // VideoToolbox decodes 4K/5K HEVC and H.264 several times faster on a Mac; elsewhere ffmpeg won't open an input
  // with a hwaccel it doesn't have, so it's asked for only there.
  const hwaccel = process.platform === 'darwin' ? ['-hwaccel', 'videotoolbox'] : [];
  return [
    '-v', 'error', ...hwaccel, '-ss', start.toFixed(6), '-i', source.path, '-an',
    // start_time=0 pads the grid back to the seek, so frame k is always `start + k / fps`.
    '-vf', `fps=fps=${source.fps}:start_time=0,scale=${source.width}:-2:flags=lanczos`,
  ];
}

const step = (decoder: Decoder, event: LibraryFrameDecoderEvent) =>
  SubscriptionRef.update(decoder.view, (view) => ({ ...view, process: libraryFrameDecoderStep(view.process, event) }));

/**
 * Effect's clock with sleeps that don't keep the process alive. A decoder's idle close is housekeeping: a render whose
 * frames are all drawn should exit then, not when its last decoder idles out.
 */
function processReleasingClock(clock: Clock.Clock): Clock.Clock {
  return {
    currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
    currentTimeMillis: clock.currentTimeMillis,
    currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
    currentTimeNanos: clock.currentTimeNanos,
    monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: clock.monotonicTimeNanos,
    sleep: (duration) => Effect.callback<void>((resume) => {
      // @effect-diagnostics-next-line globalTimersInEffect:off
      const timer = setTimeout(() => resume(Effect.void), Duration.toMillis(duration));
      timer.unref();
      return Effect.sync(() => clearTimeout(timer));
    }),
  };
}

export const libraryFrameDecodersLayer = Layer.effect(LibraryFrameDecoders, Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner, ffmpeg = yield* StudioFfmpeg;
  const poolScope = yield* Effect.scope, idleClock = processReleasingClock(yield* Clock.Clock);
  /** Open decoders, the least recently read first. */
  const pool = yield* SynchronizedRef.make<readonly Decoder[]>([]);

  /** Ends `decoder`: its reads see it stopped before its process and fibers go. Already out of the pool. */
  const retire = (decoder: Decoder) => step(decoder, { type: 'closed' }).pipe(Effect.andThen(Scope.close(decoder.scope, Exit.void)));

  const closeIdle = (decoder: Decoder) => SynchronizedRef.update(pool, (open) => open.filter((d) => d !== decoder)).pipe(Effect.andThen(retire(decoder)));

  /** Follows `decoder`'s running ffmpeg, keeping the frames its reads ask for, until it ends or its scope closes. */
  const follow = Effect.fn('LibraryFrameDecoders.follow')(function* (decoder: Decoder, handle: ChildProcessSpawner.ChildProcessHandle, input: readonly string[]) {
    // The child keeps the process alive only while a read waits on it, so a finished render exits with decoders
    // open. A child left unreferenced is left running by its scope, so the decoder kills it itself, referenced again:
    // the kill waits on its exit, which an unreferenced child may never report.
    const reref = yield* Ref.make<Effect.Effect<void>>(Effect.void);
    yield* Effect.addFinalizer(() => Effect.flatten(Ref.getAndSet(reref, Effect.void)).pipe(Effect.andThen(Effect.ignore(handle.kill({ killSignal: 'SIGKILL' })))));
    yield* SubscriptionRef.changes(decoder.view).pipe(
      Stream.map((view) => view.wanted >= 0),
      Stream.changes,
      Stream.runForEach((reading) => (reading
        ? Effect.flatten(Ref.getAndSet(reref, Effect.void))
        : handle.unref.pipe(Effect.flatMap((back) => Ref.set(reref, Effect.ignore(back))), Effect.ignore))),
      Effect.forkScoped,
    );
    // Decoding runs ahead only as far as the reads need: past that the pipe fills and ffmpeg waits.
    const awaitDemand = SubscriptionRef.changes(decoder.view).pipe(Stream.filter((view) => view.wanted >= nextIndex(view)), Stream.runHead);
    yield* splitJpegs(handle.stdout).pipe(
      Stream.runForEach((jpeg) => SubscriptionRef.update(decoder.view, (view) => {
        const frames = new Map(view.frames).set(nextIndex(view), jpeg);
        frames.delete(nextIndex(view) - KEPT_FRAMES);
        return { ...view, frames, process: libraryFrameDecoderStep(view.process, { type: 'frameDecoded' }) };
      }).pipe(Effect.andThen(awaitDemand))),
      // A broken pipe ends the frames; the exit says what happened.
      Effect.ignore,
    );
    // A failed exit code is a signal's end.
    const code = yield* handle.exitCode.pipe(Effect.map(Number), Effect.orElseSucceed(() => null));
    yield* step(decoder, { type: 'exited', code });
    if ((yield* SubscriptionRef.get(decoder.view)).process.matches('diagnosing')) {
      const reason = yield* ffmpeg.run([...input, '-frames:v', '1', '-f', 'null', '-']).pipe(Effect.match({
        onSuccess: () => `ffmpeg exited with ${code}`,
        onFailure: (failed) => failed.stderr.trim() || failed.message,
      }));
      yield* step(decoder, { type: 'diagnosed', reason });
    }
  });

  /** Runs `decoder`'s ffmpeg, reading `source` from its seek. */
  const decode = (decoder: Decoder, source: LibraryFrameSource) => {
    const input = decoderInput(source, decoder.start);
    return startStudioFfmpegOutput([...input, '-c:v', 'mjpeg', '-q:v', '2', '-pix_fmt', 'yuvj444p', '-f', 'image2pipe', '-']).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.matchEffect({
        onFailure: (failed) => step(decoder, { type: 'spawnFailed', reason: failed.message }),
        onSuccess: (handle) => follow(decoder, handle, input),
      }),
    );
  };

  const open = Effect.fn('LibraryFrameDecoders.open')(function* (source: LibraryFrameSource, key: string, start: number) {
    const scope = yield* Scope.fork(poolScope);
    const decoder: Decoder = {
      key, path: source.path, start, fps: source.fps, scope,
      view: yield* SubscriptionRef.make<DecoderView>({ process: libraryFrameDecoderStarted(), frames: new Map(), wanted: -1 }),
      turn: yield* Semaphore.make(1),
      idle: yield* FiberHandle.make().pipe(Scope.provide(scope)),
    };
    yield* decode(decoder, source).pipe(Scope.provide(scope), Effect.forkIn(scope));
    return decoder;
  });

  /** The decoder that reaches grid time `seconds` soonest, or a new one seeking there; it becomes the most recent. */
  const decoderFor = (source: LibraryFrameSource, seconds: number) => SynchronizedRef.modifyEffect(pool, Effect.fnUntraced(function* (open_) {
    const key = `${source.path}|${source.width}|${source.fps}`;
    const reaching = [];
    for (const decoder of open_.filter((d) => d.key === key)) {
      const view = yield* SubscriptionRef.get(decoder.view), index = Math.round((seconds - decoder.start) * decoder.fps);
      if (reaches(view, index)) reaching.push({ decoder, index, ahead: Math.max(0, index - nextIndex(view)) });
    }
    const found = reaching.toSorted((a, b) => a.ahead - b.ahead)[0];
    if (found) return [found, [...open_.filter((d) => d !== found.decoder), found.decoder]] as const;
    const [oldest, ...kept] = open_;
    if (oldest && open_.length >= MAX_DECODERS) yield* retire(oldest);
    const start = Math.max(0, seconds - SEEK_LEAD_SECONDS), decoder = yield* open(source, key, start);
    return [{ decoder, index: Math.round((seconds - start) * decoder.fps) }, [...(open_.length >= MAX_DECODERS ? kept : open_), decoder]] as const;
  }));

  /** Frame `index` of `decoder`'s grid, waiting on it as it decodes; Missed when this decoder can no longer give it. */
  const readFrame = (decoder: Decoder, index: number) => Effect.gen(function* () {
    yield* FiberHandle.clear(decoder.idle);
    yield* SubscriptionRef.update(decoder.view, (view) => ({ ...view, wanted: index }));
    const read = yield* SubscriptionRef.changes(decoder.view).pipe(
      Stream.map((view) => frameReadOf(decoder, view, index)),
      Stream.filter((settled): settled is FrameRead => settled !== undefined),
      Stream.runHead,
    );
    // The changes never end, so a read always settles; Missed stands for the end that can't come.
    return Option.getOrElse(read, () => FrameRead.Missed());
  }).pipe(
    Effect.ensuring(SubscriptionRef.update(decoder.view, (view) => ({ ...view, wanted: -1 })).pipe(
      // The close is forked into the pool's scope: run in the decoder's own, it would interrupt itself.
      Effect.andThen(FiberHandle.run(decoder.idle)(Effect.sleep(DECODER_IDLE).pipe(Effect.andThen(Effect.forkIn(closeIdle(decoder), poolScope)), Effect.provideService(Clock.Clock, idleClock)))),
    )),
    Semaphore.withPermit(decoder.turn),
  );

  const readFrameAt = Effect.fn('LibraryFrameDecoders.readFrameAt')(function* (source: LibraryFrameSource, seconds: number) {
    const { decoder, index } = yield* decoderFor(source, seconds);
    return yield* FrameRead.$match(yield* readFrame(decoder, index), {
      Frame: ({ jpeg }) => Effect.succeed(jpeg),
      Missed: () => Effect.fail(new LibraryFrameMissed({ path: source.path, seconds })),
      Undecodable: ({ why }) => Effect.fail(new LibraryFrameUndecodable({ path: source.path, seekSeconds: decoder.start, why })),
    });
  });

  return LibraryFrameDecoders.of({
    // A decoder chosen as the read was asked for may have moved past it, or closed, by its turn: the read is asked
    // again, and goes to one that can give it, a few times before it gives up.
    frameAt: (source, seconds) => readFrameAt(source, seconds).pipe(
      Effect.retry({ while: Predicate.isTagged('LibraryFrameMissed'), schedule: Schedule.recurs(MISSED_READ_RETRIES) }),
      Effect.catchTag('LibraryFrameMissed', (missed) => Effect.fail(new LibraryFrameUndecodable({ path: source.path, seekSeconds: Math.max(0, seconds - SEEK_LEAD_SECONDS), why: missed.message }))),
    ),
  });
}));

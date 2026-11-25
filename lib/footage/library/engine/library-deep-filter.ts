// library-deep-filter.ts: DeepFilterNet's command-line denoiser, which a mic's levelled copy runs through. A pinned
// release binary, its model built in, fetched once into the studio's user cache for this machine's platform, so every
// checkout and a remote container alike get the same one on first use. Node only.
import { Effect, FileSystem, Path, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { STUDIO_CHILD_PROCESS } from '#lib/platform/process/engine/studio-child-process.ts';
import { toolStderrReason } from '#lib/platform/process/models/tool-stderr-reason.ts';
import { studioUserCacheDir } from '#lib/platform/temp/engine/studio-user-cache.ts';
import { LibrarySpeechUnmeasured } from '../models/library-errors.ts';
import { LIBRARY_DEEP_FILTER_ATTEN_LIMIT_DB, LIBRARY_DEEP_FILTER_VERSION } from '../models/library-item.ts';

// Release assets by Node's platform and arch. Linux takes the static musl build on x86_64, so a slim container runs it.
const RELEASE_TARGETS: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};

// The one request denoising makes; a plain fetch, as Effect's HTTP client is still unstable.
const fetchDeepFilterRelease = (url: string) => fetch(url);

/** deep-filter's path in the user cache, fetched there on first use. */
const deepFilterBinary = Effect.fn('LibraryDeepFilter.binary')(function* (id: string, track: string) {
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  const file = path.join(studioUserCacheDir(`deep-filter-${LIBRARY_DEEP_FILTER_VERSION}`), 'deep-filter');
  if (yield* fs.exists(file)) return file;
  const unfetched = (why: string) => new LibrarySpeechUnmeasured({ id, track, why: `couldn't fetch DeepFilterNet ${LIBRARY_DEEP_FILTER_VERSION}: ${why}` });
  const target = RELEASE_TARGETS[`${process.platform}-${process.arch}`];
  if (!target) return yield* unfetched(`no release is built for ${process.platform}-${process.arch}`);
  const url = `https://github.com/Rikorose/DeepFilterNet/releases/download/v${LIBRARY_DEEP_FILTER_VERSION}/deep-filter-${LIBRARY_DEEP_FILTER_VERSION}-${target}`;
  yield* Effect.log(`fetching DeepFilterNet ${LIBRARY_DEEP_FILTER_VERSION} for denoising speech`);
  const response = yield* Effect.tryPromise({ try: () => fetchDeepFilterRelease(url), catch: (error) => unfetched(String(error)) });
  if (!response.ok) return yield* unfetched(`${url} answered ${response.status}`);
  const bytes = yield* Effect.tryPromise({ try: () => response.arrayBuffer(), catch: (error) => unfetched(String(error)) });
  yield* fs.makeDirectory(path.dirname(file), { recursive: true });
  yield* fs.writeFile(`${file}.part`, new Uint8Array(bytes));
  yield* fs.chmod(`${file}.part`, 0o755);
  yield* fs.rename(`${file}.part`, file);
  return file;
});

const streamText = <E>(stream: Stream.Stream<Uint8Array, E>) => stream.pipe(Stream.decodeText(), Stream.mkString);

/**
 * Denoises `wav` (48 kHz, DeepFilterNet's rate) into `outDir`, under the same name; returns that file. Its delay is
 * compensated, so the copy keeps the track's media time.
 */
export const libraryDeepFilter = Effect.fn('LibraryDeepFilter.denoise')(function* (id: string, track: string, wav: string, outDir: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner, path = yield* Path.Path;
  const failed = (why: string) => new LibrarySpeechUnmeasured({ id, track, why: `DeepFilterNet failed: ${why}` });
  const binary = yield* deepFilterBinary(id, track);
  const handle = yield* spawner.spawn(ChildProcess.make(binary, ['-D', '-a', String(LIBRARY_DEEP_FILTER_ATTEN_LIMIT_DB), '-o', outDir, wav], STUDIO_CHILD_PROCESS))
    .pipe(Effect.mapError((error) => failed(error.message)));
  const [stderr, exitCode] = yield* Effect.all([streamText(handle.stderr), handle.exitCode, handle.stdout.pipe(Stream.runDrain)], { concurrency: 'unbounded' })
    .pipe(Effect.mapError((error) => failed(error.message)));
  if (Number(exitCode) !== 0) return yield* failed(toolStderrReason(stderr) || `exited with ${exitCode}`);
  return path.join(outDir, path.basename(wav));
}, Effect.scoped);

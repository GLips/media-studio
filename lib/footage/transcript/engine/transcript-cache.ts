// transcript-cache.ts: transcripts already heard, kept in the studio's user cache (~/.cache/media-studio/transcripts)
// so asking again for a file costs a few reads, from any checkout. Node only.
import { createHash, randomUUID } from 'node:crypto';
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { FootageTranscript } from '../models/footage-transcript.ts';
import { studioUserCacheDir } from '#lib/platform/temp/engine/studio-user-cache.ts';

// Bytes read from the start, middle and end of a file for its cache key, beside its size and modified time. The time
// catches an edit that keeps the size and misses the samples (a word patched mid-WAV); a copy is transcribed afresh.
const KEY_SAMPLE = 2 ** 20;

const TranscriptEntryJson = Schema.fromJsonString(FootageTranscript);

export class TranscriptCache extends Context.Service<TranscriptCache, {
  /**
   * The key for `path`'s transcript by `transcriber` (WhisperCpp's): from the file's size, modified time and three
   * sampled megabytes, not a hash of all of it, so a multi-GB file costs a few reads.
   */
  readonly keyOf: (path: string, transcriber: string) => Effect.Effect<string, PlatformError>;
  /** The transcript kept under `key`; none when there's no entry, or one that doesn't read as a transcript. */
  readonly read: (key: string) => Effect.Effect<Option.Option<FootageTranscript>>;
  /** Keeps `transcript` under `key`, whole: a reader at any moment finds the old entry or the new one. */
  readonly write: (key: string, transcript: FootageTranscript) => Effect.Effect<void, PlatformError | Schema.SchemaError>;
}>()('TranscriptCache') {}

/** The cache kept in `folder`; transcriptCacheLayer is the user cache's. */
export const transcriptCacheLayerIn = (folder: string) => Layer.effect(TranscriptCache, Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  const entry = (key: string) => path.join(folder, `${key}.json`);

  const keyOf = Effect.fn('TranscriptCache.keyOf')(function* (footage: string, transcriber: string) {
    const file = yield* fs.open(footage);
    const info = yield* file.stat;
    const size = Number(info.size), modified = Option.getOrUndefined(info.mtime)?.getTime();
    const hash = createHash('sha256').update(`${transcriber}\n${size}\n${modified}\n`);
    for (const at of new Set([0, Math.max(0, Math.floor(size / 2) - KEY_SAMPLE / 2), Math.max(0, size - KEY_SAMPLE)])) {
      const block = yield* file.readAlloc(KEY_SAMPLE, { position: BigInt(at) });
      if (Option.isSome(block)) hash.update(block.value);
    }
    return hash.digest('hex').slice(0, 32);
  }, Effect.scoped);

  return TranscriptCache.of({
    keyOf,
    // An entry that can't be read or decoded (cut short, or written by older code) is a miss, so the file is heard
    // again and the entry replaced.
    read: Effect.fn('TranscriptCache.read')(function* (key: string) {
      return yield* fs.readFileString(entry(key)).pipe(Effect.flatMap(Schema.decodeEffect(TranscriptEntryJson)), Effect.option);
    }),
    write: Effect.fn('TranscriptCache.write')(function* (key: string, transcript: FootageTranscript) {
      const json = yield* Schema.encodeEffect(TranscriptEntryJson)(transcript);
      const temp = `${entry(key)}.${randomUUID()}.tmp`;
      yield* fs.makeDirectory(folder, { recursive: true });
      yield* fs.writeFileString(temp, json);
      yield* fs.rename(temp, entry(key));
    }),
  });
}));

export const transcriptCacheLayer = transcriptCacheLayerIn(studioUserCacheDir('transcripts'));

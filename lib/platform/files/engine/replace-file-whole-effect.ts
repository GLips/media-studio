// replace-file-whole-effect.ts: replaceFileWhole for Effect code, through Effect's FileSystem, so a test or another
// platform provides its own. Node only.
import { randomUUID } from 'node:crypto';
import { Effect, FileSystem, Path } from 'effect';
import type { PlatformError } from 'effect/PlatformError';

/** Replaces `file` with `data` whole; makes its folder if missing. */
export type ReplaceFileWholeEffect = (file: string, data: string | Uint8Array) => Effect.Effect<void, PlatformError>;

/**
 * A writer that puts `data` in a temp file beside `file` and renames it over, so a reader finds the old file or the
 * new one, never half; a failed or interrupted write removes its temp file. Made once in a layer, over the
 * FileSystem and Path it's given.
 */
export const makeReplaceFileWholeEffect = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  const replaceFileWholeEffect: ReplaceFileWholeEffect = Effect.fn('replaceFileWholeEffect')(function* (file, data) {
    const temp = `${file}.${randomUUID()}.tmp`;
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* (typeof data === 'string' ? fs.writeFileString(temp, data) : fs.writeFile(temp, data)).pipe(
      Effect.andThen(fs.rename(temp, file)),
      Effect.onError(() => Effect.ignore(fs.remove(temp, { force: true }))),
    );
  });
  return replaceFileWholeEffect;
});

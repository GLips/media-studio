// review-store.ts: how review state persists, whatever its scope: one JSON file per scope (a project's
// review/review.json, a library item's flags.json), versioned, carrying a `revision` every write bumps, and replaced
// whole by rename under a lock file. The page's server function and the CLI are separate processes, so the lock is a
// file, and a reader learns of a change from one number.
//
// What the file holds and how it changes is the scope's own (review-ops.ts for a project, library-flags.ts for the
// library); this module only reads, locks and replaces.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { replaceFileWhole } from '#lib/platform/files/engine/replace-file-whole.ts';
import { releaseStudioLockFile, tryStudioLockFile } from '#lib/platform/files/engine/studio-lock-file.ts';

/** How long a writer waits for another's lock, and how often it tries again. Writers hold it for milliseconds. */
const REVIEW_STORE_LOCK_WAIT_MS = 2000;
const REVIEW_STORE_LOCK_RETRY_MS = 5;

/** What every scope's file carries: its format's version, and the revision each write bumps. */
export type ReviewStoreFile<V extends number = number> = { version: V; revision: number };

/** A scope's file: where it is, the version it's written at, and what it holds before its first write. */
export type ReviewStoreScope<F extends ReviewStoreFile> = { path: string; version: F['version']; empty: () => F };

function parseReviewStoreFile<F extends ReviewStoreFile>({ path, version }: ReviewStoreScope<F>): F {
  // SAFETY: writeReviewStore is the file's only writer; the version check below refuses any other shape.
  const read = JSON.parse(readFileSync(path, 'utf8')) as F;
  if (read.version !== version) throw new Error(`${path} is version ${String(read.version)}, not ${String(version)}`);
  return read;
}

// Every write renames a new file into place, so its inode alone says whether the file changed; mtime and size guard a
// filesystem that reuses inodes.
const parsed = new Map<string, { key: string; file: ReviewStoreFile }>();

/**
 * The scope's file as on disk now, its empty state before the first write. A repeat read costs a stat. Read-only: the
 * object is shared between callers until the file changes.
 */
export function readReviewStore<F extends ReviewStoreFile>(scope: ReviewStoreScope<F>): F {
  if (!existsSync(scope.path)) return scope.empty();
  const { ino, mtimeMs, size } = statSync(scope.path);
  const key = `${ino}:${mtimeMs}:${size}`;
  const cached = parsed.get(scope.path);
  // SAFETY: a path is one scope's file, always read with that scope's type.
  if (cached?.key === key) return cached.file as F;
  const file = parseReviewStoreFile(scope);
  parsed.set(scope.path, { key, file });
  return file;
}

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Runs `write` holding the scope's lock, taken over from a holder that ended without letting go. */
function withReviewStoreLock<T>(path: string, write: () => T): T {
  const lock = `${path}.lock`, deadline = Date.now() + REVIEW_STORE_LOCK_WAIT_MS;
  mkdirSync(dirname(lock), { recursive: true });
  for (;;) {
    const tried = tryStudioLockFile(lock);
    if ('held' in tried) {
      try {
        return write();
      } finally {
        releaseStudioLockFile(tried.held);
      }
    }
    if (Date.now() > deadline) throw new Error(`${path} has been locked by process ${tried.holder.pid} for over ${REVIEW_STORE_LOCK_WAIT_MS / 1000} s`);
    sleepSync(REVIEW_STORE_LOCK_RETRY_MS);
  }
}

/**
 * Hands `update` the newest file under the scope's lock, and writes the file `written` finds in its result; one it
 * finds none in (a stale change) writes nothing. `update` runs inside the lock, so files it writes beside the scope's
 * (a note's frame image) land with it. Returns what `update` returned.
 */
export function writeReviewStore<F extends ReviewStoreFile, R>(scope: ReviewStoreScope<F>, update: (current: F) => R, written: (result: R) => F | undefined): R {
  return withReviewStoreLock(scope.path, () => {
    const result = update(existsSync(scope.path) ? parseReviewStoreFile(scope) : scope.empty()), file = written(result);
    if (file) replaceFileWhole(scope.path, `${JSON.stringify(file, null, 2)}\n`);
    return result;
  });
}

// review-file.ts: review/review.json on disk. Every write goes through applyReviewOps, which takes the file's lock,
// reads the newest file, applies the ops (review-ops.ts) and replaces it whole by rename, writing and deleting frame
// images inside the same lock. The page's server function and the CLI are separate processes, so the lock is a file.
//
// Negative space: nothing here reads an older notes file (review/notes-*.json); a file of another version is refused.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { archiveRender } from '#lib/output/render/engine/render-archive.ts';
import { loadRenderSnapshot } from '#lib/output/render/engine/render-snapshot.ts';
import { replaceFileWhole } from '#lib/platform/files/engine/replace-file-whole.ts';
import { releaseStudioLockFile, tryStudioLockFile } from '#lib/platform/files/engine/studio-lock-file.ts';
import { applyReviewOpsToFile, ReviewOpRefused, type ReviewOp, type ReviewOpsApplied, type ReviewOpsConflict, type ReviewRenderRef } from '../models/review-ops.ts';
import { emptyReviewFile, REVIEW_FILE_VERSION, type ReviewFile, type ReviewAuthor, type ReviewWrittenOn } from '../models/review-threads.ts';

/** How long a writer waits for another's lock, and how often it tries again. Writers hold it for milliseconds. */
const REVIEW_LOCK_WAIT_MS = 2000;
const REVIEW_LOCK_RETRY_MS = 5;

export const reviewFilePathOf = (projectDir: string) => join(projectDir, 'review', 'review.json');

function parseReviewFile(file: string): ReviewFile {
  // SAFETY: applyReviewOps is the file's only writer; the version check below refuses any other shape.
  const read = JSON.parse(readFileSync(file, 'utf8')) as Omit<ReviewFile, 'version'> & { version: number };
  if (read.version !== REVIEW_FILE_VERSION) throw new Error(`${file} is review file version ${String(read.version)}, not ${String(REVIEW_FILE_VERSION)}`);
  return { ...read, version: REVIEW_FILE_VERSION };
}

// Every write renames a new file into place, so its inode alone says whether the file changed; mtime and size guard a
// filesystem that reuses inodes.
const parsed = new Map<string, { key: string; file: ReviewFile }>();

/**
 * The project's review as on disk now, an empty one before the first note. A repeat read costs a stat. Read-only: the
 * object is shared between callers until the file changes.
 */
export function readReviewFile(projectDir: string): ReviewFile {
  const path = reviewFilePathOf(projectDir);
  if (!existsSync(path)) return emptyReviewFile();
  const { ino, mtimeMs, size } = statSync(path);
  const key = `${ino}:${mtimeMs}:${size}`;
  const cached = parsed.get(path);
  if (cached?.key === key) return cached.file;
  const file = parseReviewFile(path);
  parsed.set(path, { key, file });
  return file;
}

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Runs `write` holding the review file's lock, taken over from a holder that ended without letting go. */
function withReviewFileLock<T>(projectDir: string, write: () => T): T {
  const lock = `${reviewFilePathOf(projectDir)}.lock`, deadline = Date.now() + REVIEW_LOCK_WAIT_MS;
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
    if (Date.now() > deadline) throw new Error(`review/review.json has been locked by process ${tried.holder.pid} for over ${REVIEW_LOCK_WAIT_MS / 1000} s`);
    sleepSync(REVIEW_LOCK_RETRY_MS);
  }
}

/** A project-relative path from a client, refused when it climbs out of the project. */
function insideProject(projectDir: string, path: string): string {
  const file = resolve(projectDir, path);
  if (!file.startsWith(resolve(projectDir) + sep)) throw new ReviewOpRefused(`${path} isn't inside the project`);
  return file;
}

/**
 * A note's render, with the commits its snapshot names when the snapshot is of those bytes. Those bytes are archived
 * too, if nothing has yet (a render replaced outside `studio render`), so a later render can be compared against them.
 */
function writtenOnIn(projectDir: string, render: ReviewRenderRef): ReviewWrittenOn {
  const file = insideProject(projectDir, render.path);
  const loaded = existsSync(file) ? loadRenderSnapshot(file) : undefined;
  const snapshot = loaded?.kind === 'snapshot' && loaded.snapshot.render.hash === render.hash ? loaded.snapshot : undefined;
  if (snapshot) archiveRender(projectDir, file, snapshot);
  return { path: render.path, hash: render.hash, ...(snapshot && { commit: snapshot.source }) };
}

/**
 * Applies `ops` as `author` to the newest review file under its lock, all or none: a refusal throws ReviewOpRefused,
 * a stale edit returns the conflict and writes nothing.
 */
export function applyReviewOps(projectDir: string, ops: readonly ReviewOp[], author: ReviewAuthor): ReviewOpsApplied | ReviewOpsConflict {
  for (const op of ops) {
    if (op.op !== 'decision.put') continue;
    for (const { media } of op.decision.candidates) {
      if (media && !existsSync(insideProject(projectDir, media.path))) throw new ReviewOpRefused(`candidate ${media.path} isn't in the project`);
    }
  }
  return withReviewFileLock(projectDir, () => {
    const path = reviewFilePathOf(projectDir);
    const current = existsSync(path) ? parseReviewFile(path) : emptyReviewFile();
    const applied = applyReviewOpsToFile(current, ops, { author, now: new Date().toISOString(), writtenOnOf: (render) => writtenOnIn(projectDir, render) });
    if ('conflict' in applied) return applied;
    for (const { path: image, bytes } of applied.writes) replaceFileWhole(insideProject(projectDir, image), bytes);
    for (const image of applied.deletes) rmSync(insideProject(projectDir, image), { force: true });
    replaceFileWhole(path, `${JSON.stringify(applied.file, null, 2)}\n`);
    return applied;
  });
}

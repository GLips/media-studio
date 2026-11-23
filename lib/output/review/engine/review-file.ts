// review-file.ts: a project's review scope, review/review.json, kept by review-store.ts. Every write goes through
// applyReviewOps, which applies the ops (review-ops.ts) to the newest file under its lock, writing and deleting frame
// images inside the same lock.
//
// Negative space: nothing here reads an older notes file (review/notes-*.json); a file of another version is refused.
import { existsSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { archiveRender } from '#lib/output/render/engine/render-archive.ts';
import { loadRenderSnapshot } from '#lib/output/render/engine/render-snapshot.ts';
import { replaceFileWhole } from '#lib/platform/files/engine/replace-file-whole.ts';
import { applyReviewOpsToFile, ReviewOpRefused, type ReviewOp, type ReviewOpsApplied, type ReviewOpsConflict, type ReviewRenderRef } from '../models/review-ops.ts';
import { emptyReviewFile, REVIEW_FILE_VERSION, type ReviewFile, type ReviewAuthor, type ReviewWrittenOn } from '../models/review-threads.ts';
import { readReviewStore, writeReviewStore, type ReviewStoreScope } from './review-store.ts';

export const reviewFilePathOf = (projectDir: string) => join(projectDir, 'review', 'review.json');

const projectReviewScope = (projectDir: string): ReviewStoreScope<ReviewFile> => ({ path: reviewFilePathOf(projectDir), version: REVIEW_FILE_VERSION, empty: emptyReviewFile });

/**
 * The project's review as on disk now, an empty one before the first note. A repeat read costs a stat. Read-only: the
 * object is shared between callers until the file changes.
 */
export const readReviewFile = (projectDir: string): ReviewFile => readReviewStore(projectReviewScope(projectDir));

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
  return writeReviewStore(projectReviewScope(projectDir), (current) => {
    const applied = applyReviewOpsToFile(current, ops, { author, now: new Date().toISOString(), writtenOnOf: (render) => writtenOnIn(projectDir, render) });
    if ('conflict' in applied) return applied;
    for (const { path: image, bytes } of applied.writes) replaceFileWhole(insideProject(projectDir, image), bytes);
    for (const image of applied.deletes) rmSync(insideProject(projectDir, image), { force: true });
    return applied;
  }, (applied) => ('conflict' in applied ? undefined : applied.file));
}

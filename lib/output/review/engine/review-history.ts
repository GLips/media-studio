// review-history.ts: the versions of one render path a project has kept in out/.history/<hash>/ (render-archive.ts),
// numbered for the screen's `r14 ▾` menu and for compare.
import { listRenderVersions } from '#lib/output/render/engine/render-archive.ts';
import type { RenderSource } from '#lib/output/render/models/render-snapshot-model.ts';
import { projectFolderNamed, projectPathOf } from './project-media.ts';

/**
 * One kept version of a render path: `r` is its 1-based place among the path's versions, oldest first; `file` the
 * archived copy's path in the project, which /media/$project serves.
 */
export type ReviewRenderVersion = { r: number; hash: string; at: string; source: RenderSource; file: string };

/**
 * Every kept version of the render at `path` in `project`, oldest first. A prune renumbers what's left, so `r` names
 * a version for a session, and its hash names it for good.
 */
export function listReviewRenderVersions(project: string, path: string): ReviewRenderVersion[] {
  const dir = projectFolderNamed(project);
  return listRenderVersions(dir, path).map(({ r, hash, snapshot, file }) => ({ r, hash, at: snapshot.made, source: snapshot.source, file: projectPathOf(dir, file) }));
}

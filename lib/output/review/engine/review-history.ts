// review-history.ts: the versions of one render path a project has kept in out/.history/<hash>/ (render-archive.ts),
// numbered for the screen's `r14 ▾` menu and for compare.
import { listRenderArchive } from '#lib/output/render/engine/render-archive.ts';
import type { RenderSource } from '#lib/output/render/engine/render-snapshot.ts';
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
  return listReviewRenderVersionsIn(projectFolderNamed(project), path);
}

/** listReviewRenderVersions on a project by its folder. */
export function listReviewRenderVersionsIn(projectDir: string, path: string): ReviewRenderVersion[] {
  return listRenderArchive(projectDir)
    .filter((entry) => entry.snapshot.render.path === path)
    .map((entry, i) => ({ r: i + 1, hash: entry.hash, at: entry.snapshot.made, source: entry.snapshot.source, file: projectPathOf(projectDir, entry.file) }));
}

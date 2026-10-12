// project-artifacts.ts: what a project has made that a person reviews, newest first: the videos directly in out/ and
// out/wip/ as render-cuts.ts lists them (delivered renders, the animatic, a remote joined.mp4), and the stills in out/,
// out/wip/, out/stills/ and out/still-sheets/. The app's switcher, project page and dashboard read this list; a file
// outside it still opens by its path (resolveProjectMedia decides what may be served).
//
// Negative space: slices in out/wip/slices/ aren't listed. They reach the page only as the render a reply names, laid
// into the cut (review-splices.ts).
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listProjectOutVideos } from '#lib/output/render/engine/render-cuts.ts';
import { transparentPairOf, type ProjectArtifact } from '../models/review-artifact.ts';
import { projectFolderNamed, projectMediaTypeOf, projectPathOf } from './project-media.ts';

const STILL_FOLDERS = ['out', 'out/wip', 'out/stills', 'out/still-sheets'] as const;

/** The project's reviewable files, newest first. */
export function listProjectArtifacts(project: string): ProjectArtifact[] {
  const dir = projectFolderNamed(project);
  const stills = STILL_FOLDERS.flatMap((folder) => {
    const at = join(dir, ...folder.split('/'));
    if (!existsSync(at)) return [];
    return readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
      const file = join(at, entry.name);
      return entry.isFile() && projectMediaTypeOf(entry.name)?.kind === 'still' ? [{ path: projectPathOf(dir, file), file, kind: 'still' as const }] : [];
    });
  });
  const found = [...listProjectOutVideos(dir).map(({ path, file }) => ({ path, file, kind: 'video' as const })), ...stills]
    .map(({ path, file, kind }) => ({ path, kind, modified: statSync(file).mtime.toISOString() }));
  const paths = new Set(found.map((a) => a.path));
  return found
    .map((artifact) => {
      const pair = transparentPairOf(artifact.path);
      return pair && paths.has(pair) ? { ...artifact, pair } : artifact;
    })
    .toSorted((a, b) => b.modified.localeCompare(a.modified));
}

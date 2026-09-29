// project-artifacts.ts: what a project has made that a person reviews, newest first: the videos directly in out/ and
// out/wip/ (delivered renders, the animatic, slices named by hand), the stills in out/stills/ and the variant sheets in
// out/still-sheets/. The app's switcher and a project's landing page read this list; a file outside it still opens by
// its path (resolveProjectMedia decides what may be served).
//
// Negative space: deeper folders (out/wip/bars, out/reel, out/check, out/storyboard) hold pieces, passes and review
// sheets of a cut, not the cut, so they aren't listed.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { transparentPairOf, type ProjectArtifact, type ProjectListing } from '../models/review-artifact.ts';
import { projectFolderNamed, projectMediaTypeOf, projectPathOf } from './project-media.ts';

const ARTIFACT_FOLDERS = ['out', 'out/wip', 'out/stills', 'out/still-sheets'] as const;

/** The project's reviewable files, newest first. */
export function listProjectArtifacts(project: string): ProjectArtifact[] {
  const dir = projectFolderNamed(project);
  const found = ARTIFACT_FOLDERS.flatMap((folder) => {
    const at = join(dir, ...folder.split('/'));
    if (!existsSync(at)) return [];
    return readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
      const kind = entry.isFile() ? projectMediaTypeOf(entry.name)?.kind : undefined;
      if (kind !== 'video' && kind !== 'still') return [];
      const file = join(at, entry.name);
      return [{ path: projectPathOf(dir, file), kind, modified: statSync(file).mtime.toISOString() }];
    });
  });
  const paths = new Set(found.map((a) => a.path));
  return found
    .map((artifact) => {
      const pair = transparentPairOf(artifact.path);
      return pair && paths.has(pair) ? { ...artifact, pair } : artifact;
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

/** Every project with what it has made, the most recently active first. */
export function listProjectsWithArtifacts(projects: readonly string[]): ProjectListing[] {
  return projects.map((project) => ({ project, artifacts: listProjectArtifacts(project) }))
    .sort((a, b) => (b.artifacts[0]?.modified ?? '').localeCompare(a.artifacts[0]?.modified ?? '') || a.project.localeCompare(b.project));
}

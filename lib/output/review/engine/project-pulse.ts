// project-pulse.ts: what every screen of the app polls once a second, one poll a project: the review's revision, its
// files with their hashes, the plan's hashes, whether an agent is watching and whether a render is under way. Every
// other query is fetched once per part of it that moved (models/project-pulse.ts), so the screens never disagree.
// Each part costs a stat while nothing changes: hashes are cached by mtime (renderFileStamp), the review file by inode.
//
// Negative space: a file outside listProjectArtifacts' folders (a slice in out/wip/slices/, a decision's audio
// candidate) isn't in `files`. A slice reaches the page through a reply, which moves `revision`.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readRenderProgress, type RenderProgress } from '#lib/output/render/engine/render-progress.ts';
import { renderFileStamp } from '#lib/output/render/engine/render-snapshot.ts';
import { listStudioProjects } from '#lib/platform/project/engine/studio-project.ts';
import type { ProjectArtifact } from '../models/review-artifact.ts';
import { projectPulseBeatOf, type ProjectPulseFacts } from '../models/project-pulse.ts';
import { listProjectArtifacts } from './project-artifacts.ts';
import { projectFolderNamed, resolveProjectMedia } from './project-media.ts';
import { readReviewFile } from './review-file.ts';
import { readReviewWatchPresence } from './review-watch.ts';

/** A reviewable file as it is on disk now: a new hash is a new render. */
export type ProjectPulseFile = ProjectArtifact & { hash: string };

export type ProjectPulse = Omit<ProjectPulseFacts, 'files'> & {
  /** Newest first, as listProjectArtifacts lists them. */
  files: ProjectPulseFile[];
  /** An agent watching (`studio review watch`), and since when; absent when none is. */
  agent?: { since: string };
  /** A render drawing in the project now. */
  rendering?: RenderProgress;
};

/** The files the plan is timed from, by their hashes. */
function planPulseOf(dir: string): ProjectPulse['plan'] {
  const storyboard = join(dir, 'storyboard.ts');
  if (!existsSync(storyboard)) return null;
  const hashOf = (...path: string[]) => (existsSync(join(dir, ...path)) ? renderFileStamp(join(dir, ...path)).hash : null);
  return { storyboard: renderFileStamp(storyboard).hash, manifest: hashOf('audio', 'manifest.json'), take: hashOf('audio', 'take.wav') };
}

/** `project`'s pulse, by its folder name under work/projects/. */
export function readProjectPulse(project: string): ProjectPulse {
  const dir = projectFolderNamed(project);
  const agent = readReviewWatchPresence(dir), rendering = readRenderProgress(dir);
  return {
    revision: readReviewFile(dir).revision,
    files: listProjectArtifacts(project).map((artifact): ProjectPulseFile => Object.assign(artifact, { hash: renderFileStamp(resolveProjectMedia(project, artifact.path)).hash })),
    plan: planPulseOf(dir),
    ...(agent && { agent }), ...(rendering && { rendering }),
  };
}

/** One hash over every project's beat: what the dashboard and quick-open key the project summaries on. */
export function readStudioPulseBeat(): string {
  const beats = listStudioProjects().map((project) => `${project}=${projectPulseBeatOf(readProjectPulse(project))}`);
  return createHash('sha256').update(beats.join('\n')).digest('hex').slice(0, 10);
}

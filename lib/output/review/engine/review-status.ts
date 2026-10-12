// review-status.ts: what the review screen polls each second: the review's revision (a change means refetch the
// threads), the open file as it is on disk now, the project's files, whether an agent is watching, and whether a
// render is on its way. Each part costs a stat while nothing changes.
import { readRenderProgress, type RenderProgress } from '#lib/output/render/engine/render-progress.ts';
import { renderFileStamp } from '#lib/output/render/engine/render-snapshot.ts';
import type { ProjectArtifact } from '../models/review-artifact.ts';
import type { ReviewRenderStamp } from '../models/review-context.ts';
import { listProjectArtifacts } from './project-artifacts.ts';
import { projectFolderNamed, resolveProjectMedia } from './project-media.ts';
import { readReviewFile } from './review-file.ts';
import { readReviewWatchPresence } from './review-watch.ts';

export type ReviewStatus = {
  revision: number;
  /** The file at the screen's path as it is on disk now: a new hash is a new render. */
  render: ReviewRenderStamp;
  artifacts: ProjectArtifact[];
  /** An agent watching (`studio review watch`), and since when; absent when none is. */
  agent?: { since: string };
  /** A render drawing in the project now. */
  rendering?: RenderProgress;
};

export function readReviewStatus(project: string, path: string): ReviewStatus {
  const dir = projectFolderNamed(project);
  const agent = readReviewWatchPresence(dir), rendering = readRenderProgress(dir);
  return {
    revision: readReviewFile(dir).revision, render: renderFileStamp(resolveProjectMedia(project, path)), artifacts: listProjectArtifacts(project),
    ...(agent && { agent }), ...(rendering && { rendering }),
  };
}

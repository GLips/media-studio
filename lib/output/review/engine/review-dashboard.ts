// review-dashboard.ts: every project as the studio's front page, a project's page and quick-open show it, read off
// disk: its files with a picture of each, its review (review/review.json) and its script's hash. What waits on whom is
// worked out in models/review-dashboard.ts.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadRenderSnapshot, renderFileStamp } from '#lib/output/render/engine/render-snapshot.ts';
import { listStudioProjects } from '#lib/platform/project/engine/studio-project.ts';
import type { ProjectArtifact } from '../models/review-artifact.ts';
import { summarizeReviewProject, type ReviewProjectFacts, type ReviewProjectSummary, type ReviewProjectThumbnail } from '../models/review-dashboard.ts';
import { listProjectArtifacts } from './project-artifacts.ts';
import { projectFolderNamed, resolveProjectMedia } from './project-media.ts';
import { readReviewFile, reviewFilePathOf } from './review-file.ts';
import { readReviewScript } from './review-script-source.ts';

export type { ReviewProjectSummary } from '../models/review-dashboard.ts';

/**
 * Without a snapshot to say its length and fps, a video's picture is taken a second in, past a fade from black; a
 * slice shorter than that shows no picture.
 */
const THUMBNAIL_FALLBACK = { frame: 30, fps: 30 };

/** A video's middle frame, by its snapshot. Its hash pins the cut to these bytes; it's hashed once per mtime. */
function thumbnailOf(project: string, artifact: ProjectArtifact): ReviewProjectThumbnail {
  if (artifact.kind === 'still') return { kind: 'still', path: artifact.path };
  const media = resolveProjectMedia(project, artifact.path);
  const loaded = loadRenderSnapshot(media);
  const at = loaded.kind === 'snapshot'
    ? { frame: Math.floor((loaded.snapshot.frames.end - loaded.snapshot.frames.from) / 2), fps: loaded.snapshot.timeline.fps }
    : THUMBNAIL_FALLBACK;
  return { kind: 'video', path: artifact.path, hash: renderFileStamp(media).hash, ...at };
}

function scriptFactsOf(dir: string): ReviewProjectFacts['script'] {
  const file = join(dir, 'voiceover.json');
  return existsSync(file) ? { hash: readReviewScript(dir).hash, modified: statSync(file).mtime.toISOString() } : null;
}

function summarizeOnDisk(project: string): ReviewProjectSummary {
  const dir = projectFolderNamed(project), reviewFile = reviewFilePathOf(dir);
  const files = listProjectArtifacts(project).map((artifact) => ({ artifact, thumbnail: thumbnailOf(project, artifact) }));
  return summarizeReviewProject({
    project, files, review: readReviewFile(dir),
    script: scriptFactsOf(dir),
    reviewedAt: existsSync(reviewFile) ? statSync(reviewFile).mtime.toISOString() : null,
  });
}

/**
 * The named projects' summaries (every project under work/projects/ by default), the most recently active first. The
 * first call hashes each video once; later calls cost a stat per file until one changes.
 */
export function summarizeReviewProjects(projects: readonly string[] = listStudioProjects()): ReviewProjectSummary[] {
  return projects.map((project) => summarizeOnDisk(project))
    .toSorted((a, b) => (b.activeAt ?? '').localeCompare(a.activeAt ?? '') || a.project.localeCompare(b.project));
}

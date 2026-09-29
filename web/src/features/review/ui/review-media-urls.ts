import type { ReviewArtifact } from '#lib/output/review/models/review-artifact.ts';

type ReviewedFile = Pick<ReviewArtifact, 'project' | 'path' | 'render'>;

/**
 * The reviewed file's bytes, pinned to the render the screen loaded: once it's replaced on disk the server answers
 * 410 rather than stream the new file's ranges into a review bound to the old one.
 */
export const reviewMediaUrl = ({ project, path, render }: ReviewedFile) =>
  `/media/${encodeURIComponent(project)}?${new URLSearchParams({ path, render: render.hash })}`;

/** A file beside it in the project, unpinned: a download such as the captions. */
export const projectFileUrl = (project: string, path: string) => `/media/${encodeURIComponent(project)}?${new URLSearchParams({ path })}`;

/** A storyboard still: the reviewed render's own frame, cut on first ask. */
export const reviewStillUrl = ({ project, path, render }: ReviewedFile, frame: number, fps: number) =>
  `/review-stills/${encodeURIComponent(project)}?${new URLSearchParams({ path, render: render.hash, frame: String(frame), fps: String(fps) })}`;

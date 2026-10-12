// media-urls.ts: the app's media routes as URLs, `/media` (a project's file), `/review-stills` (a render's frame) and
// `/review-peaks` (a file's waveform). Every screen builds them here, so a route's query has one spelling.

/** A file at one version: its project, its path there and the hash of the bytes meant. */
export type PinnedProjectFile = { project: string; path: string; render: { hash: string } };

/**
 * A file's bytes pinned to `render`: once it's replaced on disk the server serves the archived copy, or answers 410
 * rather than stream the new file's ranges into a review bound to the old one.
 */
export const reviewMediaUrl = ({ project, path, render }: PinnedProjectFile) =>
  `/media/${encodeURIComponent(project)}?${new URLSearchParams({ path, render: render.hash })}`;

/**
 * A file in the project as it is now, unpinned (a download, a frame image, a candidate re-made in place). `version`
 * only keys the browser's cache, so new bytes posted under the same path are never played from an old copy.
 */
export const projectFileUrl = (project: string, path: string, version?: string) =>
  `/media/${encodeURIComponent(project)}?${new URLSearchParams({ path, ...(version !== undefined && { v: version }) })}`;

/** A render's frame, cut on first ask from the pinned bytes. */
export const reviewStillUrl = ({ project, path, render }: PinnedProjectFile, frame: number, fps: number) =>
  `/review-stills/${encodeURIComponent(project)}?${new URLSearchParams({ path, render: render.hash, frame: String(frame), fps: String(fps) })}`;

/** A file's waveform peaks: of the pinned bytes, or of the file as it is now without `render`. */
export const reviewPeaksUrl = (project: string, path: string, render?: string) =>
  `/review-peaks/${encodeURIComponent(project)}?${new URLSearchParams({ path, ...(render !== undefined && { render }) })}`;

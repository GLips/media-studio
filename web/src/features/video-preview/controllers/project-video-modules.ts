// project-video-modules.ts: a project's video.tsx and the generated modules it plays with, imported in the browser
// through Vite, as storyboard-modules.ts imports its storyboard. Each project loads only when asked for, so one
// project that doesn't build leaves the rest playable.
//
// The generated modules come through `video.tsx?studio-project-modules`, which the app's Vite plugin
// (lib/output/render/engine/studio-app-project-modules.ts) answers by running the writers a render's bundle runs.
//
// Re-timing live: this module accepts its own updates, so an edit to storyboard.ts, a scene, or anything video.tsx
// imports stops here rather than reloading the page. Version and listeners live in `import.meta.hot.data`, shared by
// every copy.
import type { VideoDef } from '#lib/picture/video/studio/video.ts';
import type { VideoProjectModules } from '#lib/picture/composition/studio/Video.tsx';

// Globbed from this file: web/src/features/video-preview/controllers/ is five folders below the repo root, where work/ is.
const VIDEO_PROJECTS_PREFIX = '../../../../../work/projects/';

type ProjectVideoModuleSources = {
  videos: Record<string, () => Promise<{ default?: VideoDef | null }>>;
  generated: Record<string, () => Promise<VideoProjectModules>>;
};

type ProjectVideoModulesShared = { sources?: ProjectVideoModuleSources; version?: number; listeners?: Set<() => void> };

// SAFETY: Vite types `hot.data` as any; this module is the only one that writes it, always in this shape.
const shared = (import.meta.hot?.data ?? {}) as ProjectVideoModulesShared;
shared.sources = {
  videos: import.meta.glob<{ default?: VideoDef | null }>('../../../../../work/projects/*/video.tsx'),
  // The query must match STUDIO_PROJECT_MODULES_QUERY in the plugin; a glob takes only literals.
  generated: import.meta.glob<VideoProjectModules>('../../../../../work/projects/*/video.tsx', { query: '?studio-project-modules' }),
};
shared.version = (shared.version ?? -1) + 1;
shared.listeners ??= new Set();
import.meta.hot?.accept(() => {
  for (const listener of shared.listeners ?? []) listener();
});

/** Bumped each time a module any project's video imports changes on disk: a query key part. */
export const projectVideoModulesVersion = (): number => shared.version ?? 0;

/** Calls `listener` after each such change; returns the unsubscribe. */
export function onProjectVideoModulesChange(listener: () => void): () => void {
  shared.listeners?.add(listener);
  return () => shared.listeners?.delete(listener);
}

/** A project's video ready to play: its definition, and what it plays from generated/. */
export type ProjectVideoModules = VideoProjectModules & { video: VideoDef };

/**
 * `project`'s video, or null for a project with no video.tsx (or one exporting no video, a stills-only project).
 * Throws when one doesn't load: a syntax error mid-edit, a scene that throws as it's defined, a cue that won't render.
 */
export async function importProjectVideoModules(project: string): Promise<ProjectVideoModules | null> {
  const { videos, generated } = shared.sources ?? {};
  const key = `${VIDEO_PROJECTS_PREFIX}${project}/video.tsx`;
  const loadVideo = videos?.[key], loadGenerated = generated?.[key];
  if (!loadVideo || !loadGenerated) return null;
  const [{ default: video }, { footage, sfxCues }] = await Promise.all([loadVideo(), loadGenerated()]);
  return video ? { video, footage, sfxCues } : null;
}

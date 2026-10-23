// storyboard-modules.ts: a project's storyboard.ts and what it's timed against (audio/manifest.ts, music/index.ts,
// audio/comp.json), imported in the browser through Vite. The long-running app server never imports a project's
// TypeScript, so the page does: Vite transforms each file as it's asked for, and re-sends it when it changes.
//
// Re-timing live: this module accepts its own updates, so an edit to a file it imports stops here rather than
// reloading the page, and its new copy's globs import the file afresh. The version and listeners live in
// `import.meta.hot.data`, shared by every copy, so screens subscribed to the first copy hear it.
//
// Negative space: a clean clone has no work/, and the globs are then empty: every project reads as having no storyboard.
import type { Storyboard } from '#lib/timing/storyboard/models/storyboard.ts';
import type { StoryboardMusic } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import type { MusicTrack } from '#lib/timing/sound/models/mix.ts';
import type { RecordedVoice } from '#lib/timing/voice/models/voice-manifest.ts';

// Globbed from this file: web/src/features/storyboard/controllers/ is five folders below the repo root, where work/ is.
const STORYBOARD_PROJECTS_PREFIX = '../../../../../work/projects/';

type StoryboardModuleSources = {
  storyboards: Record<string, () => Promise<{ storyboard?: Storyboard }>>;
  manifests: Record<string, () => Promise<{ voice?: RecordedVoice }>>;
  music: Record<string, () => Promise<{ music?: Readonly<Record<string, MusicTrack>> }>>;
  comps: Record<string, () => Promise<{ lines?: Readonly<Record<string, { source: string }>> }>>;
};

/** What every copy of this module shares across hot updates: the newest globs, a version, and who's listening. */
type StoryboardModulesShared = { sources?: StoryboardModuleSources; version?: number; listeners?: Set<() => void> };

// SAFETY: Vite types `hot.data` as any; this module is the only one that writes it, always in this shape.
const shared = (import.meta.hot?.data ?? {}) as StoryboardModulesShared;
shared.sources = {
  storyboards: import.meta.glob<{ storyboard?: Storyboard }>('../../../../../work/projects/*/storyboard.ts'),
  manifests: import.meta.glob<{ voice?: RecordedVoice }>('../../../../../work/projects/*/audio/manifest.ts'),
  music: import.meta.glob<{ music?: Readonly<Record<string, MusicTrack>> }>('../../../../../work/projects/*/music/index.ts'),
  comps: import.meta.glob<{ lines?: Readonly<Record<string, { source: string }>> }>('../../../../../work/projects/*/audio/comp.json'),
};
shared.version = (shared.version ?? -1) + 1;
shared.listeners ??= new Set();
import.meta.hot?.accept(() => {
  for (const listener of shared.listeners ?? []) listener();
});

/** Bumped each time a project's storyboard, manifest or music changes on disk: a query key part. */
export const storyboardModulesVersion = (): number => shared.version ?? 0;

/** Calls `listener` after each such change; returns the unsubscribe. */
export function onStoryboardModulesChange(listener: () => void): () => void {
  shared.listeners?.add(listener);
  return () => shared.listeners?.delete(listener);
}

/** A project's storyboard with what it's timed against, each as its module exports it. */
export type StoryboardModules = {
  storyboard: Storyboard;
  /** audio/manifest.ts's recorded lines; empty with no manifest. */
  voice: RecordedVoice;
  /** music/index.ts's tracks, each with its `src` to play; empty with none. */
  music: Readonly<Record<string, MusicTrack>> & StoryboardMusic;
  /** `draft` when any of the manifest's clips is from a `studio voice sync --draft` take (macOS say), for timing only. */
  voiceRead: 'draft' | 'final';
};

/** `project`'s modules, or null for a project with no storyboard.ts. Throws when one doesn't load (a syntax error mid-edit). */
export async function importStoryboardModules(project: string): Promise<StoryboardModules | null> {
  const { storyboards, manifests, music, comps } = shared.sources ?? {};
  const at = (file: string) => `${STORYBOARD_PROJECTS_PREFIX}${project}/${file}`;
  const loadStoryboard = storyboards?.[at('storyboard.ts')];
  if (!loadStoryboard) return null;
  const [board, manifest, tracks, comp] = await Promise.all([
    loadStoryboard(), manifests?.[at('audio/manifest.ts')]?.(), music?.[at('music/index.ts')]?.(), comps?.[at('audio/comp.json')]?.(),
  ]);
  if (!board.storyboard?.scenes) throw new Error(`${project}/storyboard.ts exports no \`storyboard\` made with defineStoryboard`);
  return {
    storyboard: board.storyboard,
    voice: manifest?.voice ?? {},
    music: tracks?.music ?? {},
    voiceRead: Object.values(comp?.lines ?? {}).some((line) => line.source === 'draft') ? 'draft' : 'final',
  };
}

// project-clock.ts: a timed project's plan resolved in Node: its storyboard.ts timed against its audio/manifest.ts
// and music/index.ts, as its video.tsx's defineVideo times it. `studio clock` prints it, `studio look` cuts its bars
// and beats from it, the workspace retime check lengthens its scenes, and every render's snapshot holds it for
// `studio review`, so no tool keeps a frame list of its own.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveStoryboard, storyboardDiagnosticsMessage, type ResolvedStoryboard, type StoryboardMusic } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import { importProjectStoryboard } from '#lib/timing/storyboard/engine/project-storyboard.ts';
import type { Storyboard } from '#lib/timing/storyboard/models/storyboard.ts';
import { timelineClockTable, type Timeline, type TimelineClockTable } from '#lib/timing/timeline/models/timeline.ts';
import { renderVoiceOf } from '#lib/timing/voice/engine/voice-project.ts';
import type { RecordedVoice } from '#lib/timing/voice/models/voice-manifest.ts';

export type ProjectStoryboard = { file: string; storyboard: Storyboard; resolved: ResolvedStoryboard<Storyboard> };

/**
 * The project's storyboard and its resolution against the voice and music it has now, diagnostics and all, or
 * undefined for a project with no storyboard.ts. Never throws for what's wrong with the plan: that's its diagnostics.
 */
export async function readProjectStoryboard(project: string): Promise<ProjectStoryboard | undefined> {
  const found = await importProjectStoryboard(project);
  if (!found) return undefined;
  // The manifest and music/index.ts import their audio: the hooks load it as URLs.
  await import('./tsx-test-hooks.ts');
  const voice = await importExport<RecordedVoice>(join(project, 'audio', 'manifest.ts'), 'voice');
  const music = await importExport<StoryboardMusic>(join(project, 'music', 'index.ts'), 'music');
  const read = renderVoiceOf(project);
  const resolved = resolveStoryboard(found.storyboard, { voice, music, ...(read && { voiceRead: read }) });
  return { ...found, resolved };
}

async function importExport<T>(file: string, name: string): Promise<T | undefined> {
  if (!existsSync(file)) return undefined;
  // SAFETY: both files are written only by their studio command (`studio voice`, `studio music`), with this export.
  return ((await import(pathToFileURL(file).href)) as Record<string, T>)[name];
}

/** The project's resolved timeline, or undefined for a project with no storyboard.ts. Throws, listing them, on any diagnostic. */
export async function readProjectTimeline(project: string): Promise<Timeline | undefined> {
  const found = await readProjectStoryboard(project);
  if (!found) return undefined;
  const { timeline, diagnostics } = found.resolved;
  if (!timeline || diagnostics.length) throw new Error(storyboardDiagnosticsMessage(found.file, diagnostics));
  return timeline;
}

/** The project's clock, or undefined for a project with no storyboard.ts. Throws, listing them, on any diagnostic. */
export async function readProjectClock(project: string): Promise<TimelineClockTable | undefined> {
  const timeline = await readProjectTimeline(project);
  return timeline && timelineClockTable(timeline);
}

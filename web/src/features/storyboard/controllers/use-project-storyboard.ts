import { useQuery } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import { resolveStoryboard, type ResolvedStoryboard } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import type { Storyboard } from '#lib/timing/storyboard/models/storyboard.ts';
import { importStoryboardModules, onStoryboardModulesChange, storyboardModulesVersion, type StoryboardModules } from './storyboard-modules.ts';

/** A project's plan as the browser resolved it: the storyboard, its resolution, and what it was timed against. */
export type ProjectStoryboard = StoryboardModules & { resolved: ResolvedStoryboard<Storyboard> };

/**
 * `loading` until the first import answers; `none` for a project with no storyboard.ts; `failed` when it has never
 * loaded. Once one has, `plan` is the last that did, kept while a newer copy fails to (`error`), so an edit half made
 * doesn't blank the page.
 */
export type ProjectStoryboardLoad =
  | { state: 'loading' }
  | { state: 'none' }
  | { state: 'failed'; error: string }
  | { state: 'ready'; plan: ProjectStoryboard; error: string | null };

async function loadProjectStoryboard(project: string): Promise<ProjectStoryboard | null> {
  const modules = await importStoryboardModules(project);
  if (!modules) return null;
  const { storyboard, voice, music, voiceRead } = modules;
  return { ...modules, resolved: resolveStoryboard(storyboard, { voice, music, voiceRead }) };
}

/** The query for `project`'s storyboard at `version`, one cache entry shared by every hook that reads it. */
export const projectStoryboardQueryOptions = (project: string, version: number) => ({
  queryKey: ['project-storyboard', project, version],
  queryFn: () => loadProjectStoryboard(project),
  staleTime: Infinity,
  retry: false,
});

/**
 * The storyboard modules' version, bumped on each hot update: a part of every storyboard query's key. The server's
 * render reads the same counter: the tab title, rendered from the root, calls this on every page.
 */
export const useStoryboardModulesVersion = (): number => useSyncExternalStore(onStoryboardModulesChange, storyboardModulesVersion, storyboardModulesVersion);

/**
 * `project`'s storyboard, imported and resolved here in the browser, and again whenever storyboard.ts, the manifest or
 * the music changes on disk (Vite's hot update), so the plan re-times as the agent types.
 */
export function useProjectStoryboard(project: string): ProjectStoryboardLoad {
  const query = useQuery(projectStoryboardQueryOptions(project, useStoryboardModulesVersion()));
  const [lastGood, setLastGood] = useState<{ project: string; plan: ProjectStoryboard | null } | null>(null);
  if (query.data !== undefined && (lastGood?.project !== project || lastGood.plan !== query.data)) setLastGood({ project, plan: query.data });
  const lastGoodHere = lastGood?.project === project ? lastGood : null;
  const kept = query.data === undefined ? lastGoodHere : { plan: query.data };
  if (!kept) return query.error ? { state: 'failed', error: String(query.error) } : { state: 'loading' };
  if (!kept.plan) return { state: 'none' };
  return { state: 'ready', plan: kept.plan, error: query.error ? String(query.error) : null };
}

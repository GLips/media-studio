import { useQuery } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import { importProjectVideoModules, onProjectVideoModulesChange, projectVideoModulesVersion, type ProjectVideoModules } from './project-video-modules.ts';

/**
 * `loading` until the first import answers; `none` for a project with no video.tsx; `failed` when it has never
 * loaded. Once one has, `modules` is the last that did, kept while a newer copy fails to (`error`), so an edit half
 * made doesn't blank the player.
 */
export type ProjectVideoLoad =
  | { state: 'loading' }
  | { state: 'none' }
  | { state: 'failed'; error: string }
  | { state: 'ready'; modules: ProjectVideoModules; error: string | null };

// Vite's own message for a module that failed to build names only its URL; the reason is in the overlay and terminal.
const loadErrorText = ({ message }: Error) => (/dynamically imported module/.test(message) ? `${message} (Vite's overlay and the server log say why)` : message);

const projectVideoQueryOptions = (project: string, version: number) => ({
  queryKey: ['project-video', project, version],
  queryFn: () => importProjectVideoModules(project),
  staleTime: Infinity,
  retry: false,
});

const useProjectVideoModulesVersion = (): number => useSyncExternalStore(onProjectVideoModulesChange, projectVideoModulesVersion, projectVideoModulesVersion);

/** `project`'s video, imported in the browser, and again whenever a module it imports changes on disk. */
export function useProjectVideo(project: string): ProjectVideoLoad {
  const query = useQuery(projectVideoQueryOptions(project, useProjectVideoModulesVersion()));
  const [lastGood, setLastGood] = useState<{ project: string; modules: ProjectVideoModules | null } | null>(null);
  if (query.data !== undefined && (lastGood?.project !== project || lastGood.modules !== query.data)) setLastGood({ project, modules: query.data });
  const lastGoodHere = lastGood?.project === project ? lastGood : null;
  const kept = query.data === undefined ? lastGoodHere : { modules: query.data };
  if (!kept) return query.error ? { state: 'failed', error: loadErrorText(query.error) } : { state: 'loading' };
  if (!kept.modules) return { state: 'none' };
  return { state: 'ready', modules: kept.modules, error: query.error ? loadErrorText(query.error) : null };
}

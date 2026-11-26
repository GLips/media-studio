import { createContext, useContext } from 'react';
import type { ProjectFileIsNewTest } from '../controllers/project-seen.ts';

/** Which files a page marks `new` (project-seen.ts); a page that marks none leaves it null. */
export const ProjectFileIsNewContext = createContext<ProjectFileIsNewTest>(null);

/** True when the page marks this file new. */
export function useProjectFileIsNew(path: string, modified: string): boolean {
  return useContext(ProjectFileIsNewContext)?.(path, modified) ?? false;
}

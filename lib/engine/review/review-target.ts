// review-target.ts: what `studio review <target>` opens in the studio app: a project, which lands on its newest file,
// or one file inside a project, by the route the app shows it at.
import { existsSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { resolveStudioProject, STUDIO_PROJECTS_DIR } from '#engine/project/studio-project.ts';
import { listProjectArtifacts } from './project-artifacts.ts';
import { projectMediaTypeOf } from './project-media.ts';

/** The app route that reviews `target`, and what the project holds, newest first, for the command to print. */
export type StudioReviewTarget = { route: string; project: string; artifacts: { path: string; modified: string }[] };

/** A path to a file reviews that file; anything else names a project as `studio` commands do. */
export function resolveStudioReviewTarget(target: string): StudioReviewTarget {
  const file = resolve(target);
  if (existsSync(file) && statSync(file).isFile()) {
    const [project, ...path] = relative(realpathSync(STUDIO_PROJECTS_DIR), realpathSync(file)).split(sep);
    if (project === '..' || !path.length || !projectMediaTypeOf(file)) {
      throw new Error(`${target} isn't a render or still inside a project under projects/: studio review opens a project's files`);
    }
    return { route: `/projects/${encodeURIComponent(project)}/artifacts/${path.map(encodeURIComponent).join('/')}`, project, artifacts: listProjectArtifacts(project) };
  }
  const [project, ...rest] = relative(STUDIO_PROJECTS_DIR, resolveStudioProject(target)).split(sep);
  if (project === '..' || rest.length) throw new Error(`${target} isn't a project under projects/`);
  return { route: `/projects/${encodeURIComponent(project)}`, project, artifacts: listProjectArtifacts(project) };
}

// studio-bundle.ts: bundles the studio's browser entry for one project, for the renderer to serve. Node only.
//
// Apart from project-bundle.ts because that file can't use import.meta (the Remotion CLI bundles it to CommonJS),
// and this one needs STUDIO_ROOT.
import { bundle } from '@remotion/bundler';
import { join } from 'node:path';
import { STUDIO_ROOT } from '../project/studio-project.ts';
import { projectWebpackOverride } from './project-bundle.ts';

/** Bundles the studio's browser entry for one project (its video, its stills or both); returns the serve URL. */
export async function bundleStudioProject(project: string): Promise<string> {
  console.error(`bundling ${project}…`);
  return bundle({ entryPoint: join(STUDIO_ROOT, 'lib/studio/index.ts'), webpackOverride: projectWebpackOverride(project) });
}

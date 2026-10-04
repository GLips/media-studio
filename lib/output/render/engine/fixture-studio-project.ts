// fixture-studio-project.ts: a render test's project, in a throwaway studio whose package.json, lib/ and node_modules/
// link back to this checkout, so its `#studio` resolves as a real project's does, and webpack, following the links,
// loads the same lib/ as the bundle's entry: this checkout's working tree, which is what the test is about.

import { copyFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';

/** Runs `run` on project `name`, its video.tsx copied from `fixtureDir`, in a throwaway studio removed after. */
export function withFixtureStudioProject<T>(name: string, fixtureDir: string, run: (project: string) => Promise<T>): Promise<T> {
  return withStudioTemp(name, (studio) => {
    for (const linked of ['package.json', 'lib', 'node_modules']) symlinkSync(join(STUDIO_ROOT, linked), join(studio, linked));
    const project = join(studio, 'work', 'projects', name);
    mkdirSync(project, { recursive: true });
    copyFileSync(join(fixtureDir, 'video.tsx'), join(project, 'video.tsx'));
    return run(project);
  });
}

// workspace-retime-check.ts: the retime check, a test per timed project in work/projects/: its storyboard.ts resolved
// against its voice and music, as studio clock resolves it, then lengthened scene by scene (assertTimelineRetimes).
// A plan with a diagnostic fails here too. One check for every project, so no project registers a test of its own.
//
// `npm run test:workspace` and `npm test` run it by name. It isn't a `.test.ts`, so the studio's own gate (lib's
// specs, what a clean clone holds) never reads work/, another repository with gitignored audio.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { STUDIO_PROJECTS_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { assertTimelineRetimes } from '#lib/timing/timeline/models/retime.ts';
import { readProjectTimeline } from './project-clock.ts';

const timedProjects = existsSync(STUDIO_PROJECTS_DIR)
  ? readdirSync(STUDIO_PROJECTS_DIR).filter((name) => existsSync(join(STUDIO_PROJECTS_DIR, name, 'storyboard.ts'))).toSorted()
  : [];

for (const name of timedProjects) {
  test(`${name} retimes: a longer scene moves every later one and its cues, and nothing before`, async () => {
    const timeline = await readProjectTimeline(join(STUDIO_PROJECTS_DIR, name));
    assertTimelineRetimes(timeline!);
  });
}

// project-clock.ts: a timed project's resolved timeline, loaded in Node from its timeline.ts (whose `timeline`
// export is defineTimeline's). `studio clock` prints it, `studio look` cuts its bars and beats from it, and
// every render's snapshot holds it for `studio review`, so no tool keeps a frame list of its own.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { timelineClockTable, type Timeline, type TimelineClockTable } from '../models/timeline.ts';

/** The project's resolved timeline, or undefined for a project with no timeline.ts. Throws where it and its music disagree. */
export async function readProjectTimeline(project: string): Promise<Timeline | undefined> {
  const file = join(project, 'timeline.ts');
  if (!existsSync(file)) return undefined;
  // The timeline reads its fitted track from music/index.ts, which imports the audio: the hooks load that as a URL.
  await import('#lib/output/render/engine/tsx-test-hooks.ts');
  const { timeline } = (await import(pathToFileURL(file).href)) as { timeline?: Timeline };
  if (!timeline?.scenes) throw new Error(`${file} exports no \`timeline\` made with defineTimeline`);
  return timeline;
}

/** The project's clock, or undefined for a project with no timeline.ts. Throws where the timeline and its music disagree. */
export async function readProjectClock(project: string): Promise<TimelineClockTable | undefined> {
  const timeline = await readProjectTimeline(project);
  return timeline && timelineClockTable(timeline);
}

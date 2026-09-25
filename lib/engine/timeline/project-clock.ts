// project-clock.ts: a music-led project's resolved timeline, loaded in Node from its timeline.ts (whose `timeline`
// export is the bar timeline). `studio clock` prints it, and `studio look` cuts its bars and beats from it, so no tool
// keeps a frame list of its own.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { barClockTable, type BarClockTable, type BarTimeline } from '../../models/timeline/bar-timeline.ts';

/** The project's clock, or undefined for a project with no timeline.ts. Throws where the table and its music disagree. */
export async function readProjectClock(project: string): Promise<BarClockTable | undefined> {
  const file = join(project, 'timeline.ts');
  if (!existsSync(file)) return undefined;
  // The timeline reads its fitted track from music/index.ts, which imports the audio: the hooks load that as a URL.
  await import('../../studio/tsx-test-hooks.ts');
  const { timeline } = (await import(pathToFileURL(file).href)) as { timeline?: BarTimeline };
  if (!timeline?.bars) throw new Error(`${file} exports no \`timeline\` made with defineBarTimeline`);
  return barClockTable(timeline);
}

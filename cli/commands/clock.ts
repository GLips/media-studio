// studio clock: a music-led project's timeline resolved to frames, as JSON, for the Python and shell tools.
import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'clock',
    description: 'A music-led project\'s timeline as JSON: fps; end (exclusive) and the fade; every beat\'s frame; each bar\'s n, id, frames (from, to exclusive), length in beats and the music\'s beat it cuts in on (1 is the downbeat); each cue\'s frame. Fails where the bar table and the music disagree.',
  },
  args: { project: studioProjectArg },
  async run({ args }) {
    const { resolveStudioProjectWith } = await import('../../lib/engine/project/studio-project.ts');
    const { readProjectClock } = await import('../../lib/engine/timeline/project-clock.ts');
    const project = resolveStudioProjectWith(args.project, 'timeline.ts');
    const clock = await readProjectClock(project);
    if (!clock) throw new Error(`${project} has no timeline.ts: studio clock reads a music-led project`);
    console.log(JSON.stringify(clock));
  },
});

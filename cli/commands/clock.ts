// studio clock: a timed project's timeline resolved to frames, as JSON, for the Python and shell tools.
import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'clock',
    description: 'A timed project\'s resolved timeline as JSON: fps; end (exclusive) and the fade; every beat\'s frame; each scene (as bars) with its n, id, driver, origin, frames (from, to exclusive), visible frames, length in beats and the music\'s beat it cuts in on (1 is the downbeat); each cue\'s frame; the replays, landmarks and the music\'s placement. Fails where the timeline and the music disagree.',
  },
  args: { project: studioProjectArg },
  async run({ args }) {
    const { resolveStudioProjectWith } = await import('../../lib/engine/project/studio-project.ts');
    const { readProjectClock } = await import('../../lib/engine/timeline/project-clock.ts');
    const project = resolveStudioProjectWith(args.project, 'timeline.ts');
    const clock = await readProjectClock(project);
    if (!clock) throw new Error(`${project} has no timeline.ts: studio clock reads a timed project`);
    console.log(JSON.stringify(clock));
  },
});

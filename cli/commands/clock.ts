// studio clock: a timed project's storyboard resolved to frames, as JSON, for the Python and shell tools.
import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'clock',
    description: "Print a timed project's storyboard resolved to frames, as JSON.",
    about: "fps; end (exclusive) and the fade; every beat's frame and the music's downbeats among them; each scene (as bars) with its n, id, driver, origin, frames (from, to exclusive), visible frames, length in beats, the music's beat it cuts in on (1 is the downbeat) and its moments (cues, replays landing, landmarks, lines) in the storyboard's words; each cue's frame; the replays, landmarks and the music's placement. The voice is its audio/manifest.ts, a line it hasn't read (or reads in other words) timed from its word count. Fails, listing them, on any of the storyboard's diagnostics: a cue whose word has gone, a missing or unfitted grid track, a plan past its target's max.",
  },
  args: { project: studioProjectArg },
  async run({ args }) {
    const { resolveStudioProjectWith } = await import('#lib/platform/project/engine/studio-project.ts');
    const { readProjectClock } = await import('#lib/output/render/engine/project-clock.ts');
    const project = resolveStudioProjectWith(args.project, 'storyboard.ts');
    const clock = await readProjectClock(project);
    if (!clock) throw new Error(`${project} has no storyboard.ts: studio clock reads a timed project`);
    console.log(JSON.stringify(clock));
  },
});

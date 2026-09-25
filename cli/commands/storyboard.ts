// studio storyboard: the storyboard page, made from the video itself (lib/engine/render/storyboard-page.ts).
import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'storyboard',
    description: 'Build out/storyboard/index.html: a preview on top, then a card per scene with its note and stills; click a card or a still to play from it. A voiced video gets a still and the audio for each line; a video whose timeline.ts is cut to fitted music gets a still on each cue, replay and landmark, captioned where timeline.ts puts it, and a preview with the music. Prints the page.',
  },
  args: {
    project: studioProjectArg,
  },
  async run({ args }) {
    const { resolveStudioProjectWith } = await import('../../lib/engine/project/studio-project.ts');
    const { buildStoryboardPage } = await import('../../lib/engine/render/storyboard-page.ts');
    console.log(await buildStoryboardPage(resolveStudioProjectWith(args.project, 'video.tsx')));
  },
});

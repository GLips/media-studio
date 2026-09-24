// studio storyboard: the storyboard page, made from the video itself (lib/storyboard-page.ts).
import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'storyboard',
    description: 'Build out/storyboard/index.html: a preview on top, then a card per scene with its note, a still and the audio for each line; click a card to play from it. Prints the page.',
  },
  args: {
    project: studioProjectArg,
  },
  async run({ args }) {
    const { resolveStudioProjectWith } = await import('../../lib/studio-project.ts');
    const { buildStoryboardPage } = await import('../../lib/storyboard-page.ts');
    console.log(await buildStoryboardPage(resolveStudioProjectWith(args.project, 'video.tsx')));
  },
});

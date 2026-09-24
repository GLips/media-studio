// studio mix: the mastered soundtrack alone, to hear the levels.
import { defineCommand } from 'citty';
import { openStudioRenderSession, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'mix',
    description: 'Render just the soundtrack, mastered to −14 LUFS and −2 dBTP, to out/mix.wav, to audition the levels. Prints the file.',
  },
  args: {
    project: studioProjectArg,
  },
  async run({ args }) {
    const { renderMasteredMix } = await import('../../lib/render-pipeline.ts');
    console.log(await renderMasteredMix(await openStudioRenderSession(args.project)));
  },
});

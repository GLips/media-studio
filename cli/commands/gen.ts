// studio gen: paid generation through OpenRouter (lib/paid-generation.ts), one verb per kind of media. Every result is
// cached, so asking again costs nothing.
import { defineCommand } from 'citty';
import { openStudioRenderSession, studioProjectArg } from '../project-arg.ts';

const video = defineCommand({
  meta: {
    name: 'video',
    description: 'Render a previs scene (one with `previs` in its defineScene) into footage with Seedance 2.5: its blockout alone to generated/blockout-<scene>-<hash>.mp4, sent as the reference video with the scene\'s stills. The scene then plays the footage. Prints the blockout, then the footage. Needs OPENROUTER_API_KEY.',
  },
  args: {
    project: studioProjectArg,
    scene: { type: 'positional', required: true, description: 'The scene\'s id' },
    dry: { type: 'boolean', description: 'Render the blockout and print the prompt, without paying for footage' },
  },
  async run({ args }) {
    const { renderPrevisFootage } = await import('../../lib/previs-render.ts');
    const session = await openStudioRenderSession(args.project);
    const { blockout, footage, prompt } = await renderPrevisFootage(session, args.scene, { dry: Boolean(args.dry) });
    if (args.dry) console.error(`prompt:\n${prompt}`);
    console.log(blockout);
    if (footage) console.log(footage);
  },
});

export default defineCommand({
  meta: { name: 'gen', description: 'Paid generation through OpenRouter, cached by request: `studio gen video <project> <scene>`.' },
  subCommands: { video },
});

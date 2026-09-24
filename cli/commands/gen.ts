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

const image = defineCommand({
  meta: {
    name: 'image',
    description: "Generate a still no capture can give (title-card art, a background, a product shot, an icon) and list it in generated/images.ts: `import { images } from './generated/images.ts'`, then images.<name>.src, .w, .h. Default model meta/muse-image ($0.01, takes references, makes 3:2 whatever you ask). Refuses a flag the model would ignore. Needs OPENROUTER_API_KEY. Prints the image, then images.ts.",
  },
  args: {
    project: studioProjectArg,
    prompt: { type: 'positional', required: true, description: 'What to make: subject, composition, light, style, colours as hex' },
    name: { type: 'string', required: true, description: 'What the video calls it: images.<name>' },
    model: { type: 'string', description: 'An OpenRouter image model, e.g. recraft/recraft-v4.1 (brand colours), recraft/recraft-v4.1-vector (SVG), google/gemini-3.1-flash-image, openai/gpt-image-2' },
    ref: { type: 'string', description: 'A reference image sent with the prompt (a product still, brand art). Repeat for more' },
    aspect: { type: 'string', description: 'Aspect ratio, e.g. 16:9, for models that take one' },
    transparent: { type: 'boolean', description: 'A transparent background, for models that can (openai/gpt-image-1-mini)' },
  },
  async run({ args }) {
    const { resolve } = await import('node:path');
    const { resolveStudioProject } = await import('../../lib/studio-project.ts');
    const { generateProjectImage, DEFAULT_IMAGE_MODEL } = await import('../../lib/generated-image.ts');
    // citty gives a repeated flag as an array, a single one as a string.
    const refs: string[] = args.ref === undefined ? [] : ([] as string[]).concat(args.ref);
    const { file, index } = await generateProjectImage(resolveStudioProject(args.project), {
      name: args.name, prompt: args.prompt, model: args.model ?? DEFAULT_IMAGE_MODEL,
      references: refs.map((ref) => resolve(ref)), aspect: args.aspect, transparent: Boolean(args.transparent),
    });
    console.log(file);
    console.log(index);
  },
});

export default defineCommand({
  meta: { name: 'gen', description: 'Paid generation through OpenRouter, cached by request: `studio gen image <project> <prompt> --name <name>`, `studio gen video <project> <scene>`.' },
  subCommands: { image, video },
});

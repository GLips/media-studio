// studio repeatable: proves chosen frames are a pure function of time, or a span draws alike in turn and shuffled.
import { defineCommand } from 'citty';
import { openStudioRenderSession, renderLensArg, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'repeatable',
    description: "Prove chosen frames are a pure function of time, rendering them alone and in other orders.",
    about: "Renders the times alone, then again in other orders and among other frames, and fails if any differ. Run it on anything drawn with randomness (a painted or generative layer): it must be seeded.\n\n--frames a:b instead draws every frame of the span twice, in turn and in a seeded shuffle, one tab each, and fails if any frame's two renders differ (over 50 dB PSNR is alike). It times both orders, and keeps each differing pair in out/check/shuffled/.",
  },
  args: {
    project: studioProjectArg,
    times: { type: 'positional', required: false, description: 'Seconds, comma-separated, e.g. 2,8.5' },
    frames: { type: 'string', valueHint: '72:143', description: 'A span of frames (inclusive) to draw in turn and shuffled, in place of times' },
    lens: renderLensArg,
  },
  async run({ args }) {
    if (!args.times === !args.frames) throw new Error('give times (2,8.5) or --frames a:b, one of them');
    const span = args.frames?.split(':').map(Number);
    if (span && !(span.length === 2 && span.every(Number.isInteger))) throw new Error(`--frames is a first and last frame like 72:143, not ${args.frames}`);
    const session = await openStudioRenderSession(args.project, { lens: args.lens });
    const { ok, report } = span
      ? await (await import('#lib/output/render/engine/render-shuffled.ts')).checkFramesShuffled(session, span[0], span[1])
      : await (await import('#lib/output/render/engine/render-pipeline.ts')).checkFramesRepeatable(session, args.times!.split(',').map(Number));
    for (const line of report) console.log(line);
    if (!ok) process.exitCode = 1;
  },
});

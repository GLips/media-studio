// studio profile: where a span of frames spends its time (lib/output/render/engine/frame-profiling.ts).
import { defineCommand } from 'citty';
import { openStudioRenderSession, renderWorkersArg, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'profile',
    description: "Renders a span of frames three times and says where each frame's time goes: the drawing code that offers its work to be timed (a stamp painting's draw, waited for on the GPU, and its load), in one tab with no screenshot; then each frame's whole render as JPEGs, steady state, in one tab and in the render's tabs. Prints the GL backend it ran on.",
  },
  args: {
    project: studioProjectArg,
    frames: { type: 'string', required: true, valueHint: '330:404', description: 'The first and last frame to profile (inclusive)' },
    workers: renderWorkersArg,
  },
  async run({ args }) {
    const range = args.frames.split(':').map(Number);
    if (!(range.length === 2 && range.every(Number.isInteger) && range[0] >= 0 && range[1] > range[0])) {
      throw new Error(`--frames is a first and last frame like 330:404, not ${args.frames}`);
    }
    const { profileFrames, formatFrameProfile } = await import('#lib/output/render/engine/frame-profiling.ts');
    const session = await openStudioRenderSession(args.project, { workers: args.workers });
    for (const line of formatFrameProfile(await profileFrames(session, { from: range[0], end: range[1] + 1 }))) console.log(line);
  },
});

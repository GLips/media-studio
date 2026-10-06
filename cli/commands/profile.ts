// studio profile: where a span of frames spends its time (lib/output/render/engine/frame-profiling.ts).
import { defineCommand } from 'citty';
import { openStudioRenderSession, renderLensArg, renderWorkersArg, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'profile',
    description: "Renders a span of frames three times and says where each frame's time goes: the drawing code that offers its work to be timed (a stamp painting's draw, waited for on the GPU, and its load), in one tab with no screenshot; then each frame's whole render as JPEGs, steady state, in one tab and in the render's tabs, where the span holds a frame past each tab's first. One frame (--frames 120:120) gives its drawing's cold cost. Prints the GPU backends it ran on (WebGL's renderer and WebGPU's adapter). With --costs, also what the drawing counted each frame cost (a painted shot's evaluations, solves, cache hits and misses, readbacks, bytes).",
  },
  args: {
    project: studioProjectArg,
    frames: { type: 'string', required: true, valueHint: '330:404', description: 'The first and last frame to profile (inclusive; 120:120 is one frame)' },
    workers: renderWorkersArg,
    lens: renderLensArg,
    costs: { type: 'boolean', default: false, description: 'Also table what drawing code counted each profiled frame cost, frame by frame' },
  },
  async run({ args }) {
    const range = args.frames.split(':').map(Number);
    if (!(range.length === 2 && range.every(Number.isInteger) && range[0] >= 0 && range[1] >= range[0])) {
      throw new Error(`--frames is a first and last frame, the last not before the first, like 330:404 or 120:120, not ${args.frames}`);
    }
    const { profileFrames, formatFrameProfile } = await import('#lib/output/render/engine/frame-profiling.ts');
    const session = await openStudioRenderSession(args.project, { workers: args.workers, lens: args.lens });
    const report = await profileFrames(session, { from: range[0], end: range[1] + 1 });
    for (const line of formatFrameProfile(report, { costs: args.costs })) console.log(line);
  },
});

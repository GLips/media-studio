// studio repeatable: proves chosen frames are a pure function of time.
import { defineCommand } from 'citty';
import { openStudioRenderSession, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'repeatable',
    description: "Render chosen times alone, then again in other orders and among other frames, and fail if any differ. Run it on a new painted style (lib/paint): its randomness must be seeded.",
  },
  args: {
    project: studioProjectArg,
    times: { type: 'positional', required: true, description: 'Seconds, comma-separated, e.g. 2,8.5' },
  },
  async run({ args }) {
    const { checkFramesRepeatable } = await import('../../lib/engine/render/render-pipeline.ts');
    const session = await openStudioRenderSession(args.project);
    const { ok, report } = await checkFramesRepeatable(session, args.times.split(',').map(Number));
    for (const line of report) console.log(line);
    if (!ok) process.exitCode = 1;
  },
});

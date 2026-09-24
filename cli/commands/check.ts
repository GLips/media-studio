// studio check: the framing check, and the timeline it measures against.
import { defineCommand } from 'citty';
import { openStudioRenderSession, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'check',
    description: "The framing check: highlights and clicks under tags or the caption, off the frame or cut off by their panel, and each scene's `expect`. Prints each problem as a stretch of time, then out/check/timeline.json (when each scene and line lands, for aiming `studio look`). Fails if there are problems.",
  },
  args: {
    project: studioProjectArg,
    every: { type: 'string', default: '5', description: "Measure every nth frame (plus every frame an `expect` covers); `studio render` measures all" },
  },
  async run({ args }) {
    const every = Number(args.every);
    if (!Number.isInteger(every) || every < 1) throw new Error(`--every must be a whole number of frames, at least 1, not ${args.every}`);
    const { checkProjectFraming, writeTimelineReport } = await import('../../lib/render-pipeline.ts');
    const session = await openStudioRenderSession(args.project);
    const { ok, timeline, report } = await checkProjectFraming(session, every);
    for (const line of report) console.log(line);
    console.log(writeTimelineReport(session, timeline));
    if (!ok) process.exitCode = 1;
  },
});

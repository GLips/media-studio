// studio check: the framing check, and the timeline it measures against.
import { defineCommand } from 'citty';
import { openStudioRenderSession, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'check',
    description: "The framing check: highlights and clicks under tags or the caption, off the frame or cut off by their panel, and each scene's `expect`; warns, without failing, where a fitTake plays its take faster than 1.6× or slower than 0.6×. Prints each problem as a stretch of time, a table of when each scene and line starts and ends (for aiming `studio look`), then out/check/timeline.json, the same as JSON. Fails if there are problems.",
  },
  args: {
    project: studioProjectArg,
    every: { type: 'string', default: '5', description: "Measure every nth frame (plus every frame an `expect` covers); `studio render` measures all" },
  },
  async run({ args }) {
    const every = Number(args.every);
    if (!Number.isInteger(every) || every < 1) throw new Error(`--every must be a whole number of frames, at least 1, not ${args.every}`);
    const { checkProjectFraming, formatTimelineTable, writeTimelineReport } = await import('../../lib/render-pipeline.ts');
    const session = await openStudioRenderSession(args.project);
    const { ok, timeline, report } = await checkProjectFraming(session, every);
    for (const line of [...report, '', ...formatTimelineTable(timeline), '']) console.log(line);
    console.log(writeTimelineReport(session, timeline));
    if (!ok) process.exitCode = 1;
  },
});

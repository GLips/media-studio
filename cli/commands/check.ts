// studio check: the framing check, the motion tracks, and the timeline both measure against.
import { defineCommand } from 'citty';
import { openStudioRenderSession, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'check',
    description: "Measures every frame (or one scene's, or a stretch's) and reports: highlights and clicks under tags or the caption, off the frame or cut off by their panel, and each scene's `expect`; warnings, without failing, where a fitTake plays its take faster than 1.6× or slower than 0.6×; then how many motion tracks it recorded, what it couldn't measure, and any tracking errors. Prints a table of when each scene and line starts and ends (for aiming `studio look`), then writes out/check/timeline.json (scenes, lines, words, crossfades) and out/check/motion.json (the tracks). Fails on framing problems or tracking errors.",
  },
  args: {
    project: studioProjectArg,
    scene: { type: 'string', description: 'Only this scene, its crossfades included' },
    at: { type: 'string', valueHint: '12:20', description: 'Only this stretch, in seconds' },
  },
  async run({ args }) {
    const at = args.at?.split(':').map(Number);
    if (at && !(at.length === 2 && at.every(Number.isFinite) && at[0] < at[1])) throw new Error(`--at is a stretch of seconds like 12:20, not ${args.at}`);
    const { checkProject, formatTimelineTable, writeCheckReports } = await import('../../lib/render-pipeline.ts');
    const session = await openStudioRenderSession(args.project);
    const check = await checkProject(session, { scene: args.scene, at: at && [at[0], at[1]] });
    for (const line of [...check.report, '', ...formatTimelineTable(check.timeline), '']) console.log(line);
    for (const file of writeCheckReports(session, check)) console.log(file);
    if (!check.ok) process.exitCode = 1;
  },
});

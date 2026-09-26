// studio check: the framing check, the motion tracks, and the timeline both measure against.
import { defineCommand } from 'citty';
import { openStudioRenderSession, renderWorkersArg, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'check',
    description: "Measures every frame (or one scene's, or a stretch's) and reports: highlights and clicks under tags or the caption, off the frame or cut off by their panel, and each scene's `expect`; warnings, without failing, where a fitTake plays its take faster than 1.6× or slower than 0.6×; then how many motion tracks it recorded, what it couldn't measure, and any tracking errors; then each `expect` hold, which must stay steady and visible long enough. With a sound-effect cue list (sfx/cues.json), it says which cues override a rule, and, when the video plays it (defineVideo({ sfxCueList: true })), fails on a cue whose event moved or went, or an event with no cue. Prints a table of when each scene and line starts and ends (for aiming `studio look`), then writes out/check/timeline.json (scenes, lines, words, crossfades) and out/check/motion.json (the tracks; a --scene or --at check writes motion-<scope>.json beside it). Fails on framing problems, tracking errors, a hold not kept or a cue list out of step with the video.",
  },
  args: {
    project: studioProjectArg,
    workers: renderWorkersArg,
    scene: { type: 'string', description: 'Only this scene, its crossfades included' },
    at: { type: 'string', valueHint: '12:20', description: 'Only this stretch, in seconds' },
  },
  async run({ args }) {
    const at = args.at?.split(':').map(Number);
    if (at && !(at.length === 2 && at.every(Number.isFinite) && at[0] < at[1])) throw new Error(`--at is a stretch of seconds like 12:20, not ${args.at}`);
    const { checkProject, formatTimelineTable, writeCheckReports } = await import('#engine/render/render-pipeline.ts');
    const { formatRenderPasses } = await import('#engine/render/render-session.ts');
    const session = await openStudioRenderSession(args.project, { workers: args.workers });
    const scope = { scene: args.scene, at: at && ([at[0], at[1]] as const) };
    const check = await checkProject(session, scope);
    for (const line of [...check.report, '', ...formatTimelineTable(check.timeline), '']) console.log(line);
    for (const file of writeCheckReports(session, check, scope)) console.log(file);
    for (const line of formatRenderPasses(session)) console.error(line);
    if (!check.ok) process.exitCode = 1;
  },
});

// studio mix: the mastered soundtrack alone, to hear the levels, and the video's placed sounds against its music.
import { defineCommand } from 'citty';
import { checkedCommandOutFlag } from '../command-flags.ts';
import { openStudioRenderSession, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'mix',
    description: "Render the mastered soundtrack alone to out/mix.wav, and check placed sounds against the music.",
    about: "Mastered to −14 LUFS and −2 dBTP; a draft's beat clicks, with no music yet, to −2 dBTP alone. Fails on a mix that renders silent, and refuses a silent project, which has none. Prints the file.\n\nFor a video with sounds on its own clock (defineVideo({ sounds })) and music, it then prints a row per sound against the music where it lands, before mastering: whether it lands on an attack or swells to a peak, the gap in ms after the music's nearest attack, the sound's and the music's momentary loudness (LUFS) and the difference (LU), flagged FLAM (15–100 ms off, heard as two hits), BURIED (over 8 LU under) or OVER (over 3 LU above); then the music's empty beats, with no attack of its own, where a sound can land alone.\n\n--bed mixes another of the project's tracks under the voice in place of video.tsx's bed, ducked as it would be, for a music-bed decision's candidates: `studio mix <p> --bed bed-b-fit --out out/decisions/music-bed/bed-b.wav`. The rows against the music are left out then: they measure video.tsx's own track.",
  },
  args: {
    project: studioProjectArg,
    'sfx-cues': { type: 'boolean', description: "Play the project's cue list (studio sfx draft) whether or not the video does, into out/mix-sfx-cues.wav, to hear it beside out/mix.wav" },
    check: { type: 'boolean', description: 'Only the rows of placed sounds against the music, without rendering out/mix.wav: to check a change to the sounds while a cut made from the last mix is still in use' },
    bed: { type: 'string', valueHint: 'bed-b-fit', description: "Play this track of the project's music (music/index.ts) as the bed, with video.tsx's bed levels, in place of its track" },
    out: { type: 'string', valueHint: 'out/decisions/music-bed/bed-b.wav', description: 'Write the master here (relative to the project) in place of out/mix.wav' },
  },
  async run({ args }) {
    const { videoSoundCheckReport } = await import('#lib/output/sound-check/engine/sound-check.ts');
    const { resolveStudioProjectWith } = await import('#lib/platform/project/engine/studio-project.ts');
    const project = resolveStudioProjectWith(args.project, 'video.tsx');
    if (args.check) {
      if (args.bed !== undefined || args.out !== undefined) throw new Error('--check renders no mix: leave out --bed and --out');
      console.log((await videoSoundCheckReport(project)).join('\n'));
      return;
    }
    const { join } = await import('node:path');
    const { renderMasteredMix } = await import('#lib/output/render/engine/render-pipeline.ts');
    const out = args.out === undefined ? undefined : checkedCommandOutFlag(args.out, { base: project, writes: ['.wav'], madeIn: join(project, 'out') });
    const session = await openStudioRenderSession(args.project);
    console.log(await renderMasteredMix(session, {
      timeline: await session.readTimeline(), auditionSfxCueList: args['sfx-cues'], ...(args.bed !== undefined && { bedTrack: args.bed }), ...(out !== undefined && { out }),
    }));
    if (args.bed !== undefined) return;
    const report = await videoSoundCheckReport(session.project);
    if (report.length) console.log(['', ...report].join('\n'));
  },
});

// studio mix: the mastered soundtrack alone, to hear the levels, and the video's placed sounds against its music.
import { defineCommand } from 'citty';
import { openStudioRenderSession, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'mix',
    description: "Render just the soundtrack, mastered to −14 LUFS and −2 dBTP, to out/mix.wav, to audition the levels. Prints the file. For a video with sounds on its own clock (defineVideo({ sounds })) and music, then a row per sound against the music where it lands, before mastering: whether it lands on an attack or swells to a peak, the gap in ms after the music's nearest attack, the sound's and the music's momentary loudness (LUFS) and the difference (LU), flagged FLAM (15–100 ms off, heard as two hits), BURIED (over 8 LU under) or OVER (over 3 LU above); then the music's empty beats, with no attack of its own, where a sound can land alone.",
  },
  args: {
    project: studioProjectArg,
    'sfx-cues': { type: 'boolean', description: "Play the project's cue list (studio sfx draft) whether or not the video does, into out/mix-sfx-cues.wav, to hear it beside out/mix.wav" },
    check: { type: 'boolean', description: 'Only the rows of placed sounds against the music, without rendering out/mix.wav: to check a change to the sounds while a cut made from the last mix is still in use' },
  },
  async run({ args }) {
    const { videoSoundCheckReport } = await import('../../lib/sfx/sound-check.ts');
    if (args.check) {
      const { resolveStudioProjectWith } = await import('../../lib/studio-project.ts');
      console.log((await videoSoundCheckReport(resolveStudioProjectWith(args.project, 'video.tsx'))).join('\n'));
      return;
    }
    const { renderMasteredMix } = await import('../../lib/render-pipeline.ts');
    const session = await openStudioRenderSession(args.project);
    console.log(await renderMasteredMix(session, { auditionSfxCueList: args['sfx-cues'] }));
    const report = await videoSoundCheckReport(session.project);
    if (report.length) console.log(['', ...report].join('\n'));
  },
});

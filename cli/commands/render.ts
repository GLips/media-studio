// studio render: the whole pipeline, from framing check to a delivered video.mp4.
import { defineCommand } from 'citty';
import { openStudioRenderSession, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'render',
    description: 'Framing check on every frame (refuses to render on a problem or an estimated line) → the mix, mastered to −14 LUFS → out/video.mp4 with captions, checked for length, audio and loudness → out/video.srt, review sheets in out/check/, out/watch.html. Prints what it delivered.',
  },
  args: {
    project: studioProjectArg,
    plain: { type: 'boolean', description: 'Also render out/video-plain.mp4, without captions' },
  },
  async run({ args }) {
    const { renderDeliveredVideo } = await import('../../lib/render-pipeline.ts');
    const session = await openStudioRenderSession(args.project);
    for (const file of await renderDeliveredVideo(session, { plain: Boolean(args.plain) })) console.log(file);
  },
});

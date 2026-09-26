// studio render: the whole pipeline, from framing check to a delivered video.mp4; the animatic, as the video plays
// now, for studio review; or a slice of the video, and the slices joined back into one.
import { defineCommand } from 'citty';
import { openStudioRenderSession, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'render',
    description: 'Framing check on every frame (refuses to render on a problem or an estimated line) → the mix, mastered to −14 LUFS → out/video.mp4 with captions, checked for length, audio and loudness → out/video.srt, review sheets in out/check/, out/watch.html. With --animatic, the whole video as it plays now (any sound it has, captions on) with no framing check, mix or refusal of an estimated line, to out/wip/animatic.mp4 or --out: the render studio review approves title cards, board frames and blocking on. With --frames, only those frames, silent and unchecked, to re-render what a change touched; --join puts the slices in a folder back together under the mix. Every video it writes has <name>.snapshot.json beside it: the timeline it was rendered from, a timed project\'s clock (bars, beats, cues) and the frames it holds, which studio review and studio look --video read. The bundle is kept between runs until a file it was built from changes. Prints what it delivered.',
  },
  args: {
    project: studioProjectArg,
    plain: { type: 'boolean', description: 'Also render out/video-plain.mp4, without captions' },
    animatic: { type: 'boolean', description: 'Render the video as it plays now, unchecked and unmixed, to out/wip/animatic.mp4 or --out, for studio review' },
    frames: { type: 'string', valueHint: '120:239', description: 'Render only these frames (inclusive), silent, with no framing check or mix, to out/wip/frames-<a>-<b>.mp4 or --out' },
    join: { type: 'string', valueHint: 'out/wip/bars', description: 'Join the --frames renders in this folder (relative to the project unless absolute) into the whole video under the mastered mix, to out/wip/joined.mp4 or --out. Refuses a slice from another timeline than the video\'s now, a gap or an overlap' },
    out: { type: 'string', description: 'Where --frames, --join or --animatic writes, relative to the project unless absolute' },
  },
  async run({ args }) {
    const { isAbsolute, join } = await import('node:path');
    if ([args.frames, args.join, args.animatic].filter(Boolean).length > 1) throw new Error('--frames renders a slice, --join joins slices and --animatic renders the animatic: give one');
    if ((args.frames || args.join || args.animatic) && args.plain) throw new Error('--plain is for the delivered video: leave it out of --frames, --join and --animatic');
    if (args.out && !args.frames && !args.join && !args.animatic) throw new Error('the delivered video goes to out/video.mp4: --out is for --frames, --join and --animatic');
    const range = args.frames?.split(':').map(Number);
    if (range && !(range.length === 2 && range.every(Number.isInteger) && range[0] >= 0 && range[1] >= range[0])) {
      throw new Error(`--frames is a first and last frame like 120:239, not ${args.frames}`);
    }
    const pipeline = await import('../../lib/engine/render/render-pipeline.ts');
    const session = await openStudioRenderSession(args.project);
    const inProject = (file: string) => (isAbsolute(file) ? file : join(session.project, file));
    if (range) {
      const [from, last] = range;
      console.log(await pipeline.renderVideoSlice(session, { from, end: last + 1, out: inProject(args.out ?? `out/wip/frames-${from}-${last}.mp4`) }));
    } else if (args.animatic) {
      console.log(await pipeline.renderAnimatic(session, { out: inProject(args.out ?? 'out/wip/animatic.mp4') }));
    } else if (args.join) {
      console.log(await pipeline.joinVideoSlices(session, { dir: inProject(args.join), out: inProject(args.out ?? 'out/wip/joined.mp4') }));
    } else {
      for (const file of await pipeline.renderDeliveredVideo(session, { plain: Boolean(args.plain) })) console.log(file);
    }
  },
});

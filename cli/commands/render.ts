// studio render: the whole pipeline, from framing check to a delivered video.mp4; the animatic, as the video plays
// now, for studio review; or a slice of the video, and the slices joined back into one.
import { defineCommand } from 'citty';
import { openStudioRenderSession, renderLensArg, renderWorkersArg, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'render',
    description: 'Refuses an estimated line → out/video.mp4 with captions, the framing check measuring every frame as it renders (nothing is delivered on a problem) → the mix, mastered to −14 LUFS, muxed under it → checked for length, audio and loudness → out/video.srt and out/video.vtt, paged by the caption style\'s sidecar rule, review sheets in out/check/, and each pass\'s time with the workers and GPU backends (WebGL and WebGPU) it had. A silent project (project.ts) skips the mix, mastering and loudness check, and writes a sidecar only from a caption table (captionTable in its timeline.ts): its videos must have no audio track. A mix that renders silent in any other project fails. A video cut to a tempo grid (tempoGrid in timeline.ts) with no music yet plays a click on each beat, a draft: its mix is mastered to −2 dBTP alone, with no loudness check, and the render warns it\'s a draft at its start and end. A transparent video (defineVideo({ format: { transparent: true } }), in a silent project) delivers out/video.webm (VP9 with alpha, for Chrome and Firefox) and out/video-hevc.mov (HEVC with alpha through macOS VideoToolbox, for Safari) instead of video.mp4, each checked for an alpha plane the page shows through; studio review plays the one the browser shows alpha in, over a checkerboard or a colour. With --animatic, the whole video as it plays now (any sound it has, captions on) with no framing check, mix or refusal of an estimated line, to out/wip/animatic.mp4 or --out: the render studio review approves the blocking and each scene built since on. With --frames, only those frames, silent and unchecked, to re-render what a change touched, kept lossless beside the video too; --join encodes the slices\' lossless frames in a folder once, under the mix, reading their timeline from their snapshots rather than a page. Every video it writes has <name>.snapshot.json beside it: the timeline it was rendered from, a timed project\'s clock (bars, beats, cues), the frames it holds and whether its voice was the draft, which studio review and studio look --video read. The bundle is kept between runs until a file it was built from changes. Renders run at low priority, in 1 tab for a project that paints (its project.ts names styles) and 3 otherwise, unless --workers or the video\'s renderWorkers says. Frames are drawn in chunks, each in a fresh browser, kept lossless and encoded once at the end; a chunk whose page crashes, loses its GPU or stops making progress (no frame and no painted solve for 2 minutes) is drawn once more, and a render whose browser has only software GL or WebGPU fails. Prints what it delivered; studio review <project> plays it.',
  },
  args: {
    project: studioProjectArg,
    workers: renderWorkersArg,
    lens: renderLensArg,
    plain: { type: 'boolean', description: 'Also render out/video-plain.mp4, without captions' },
    animatic: { type: 'boolean', description: 'Render the video as it plays now, unchecked and unmixed, to out/wip/animatic.mp4 or --out, for studio review' },
    frames: { type: 'string', valueHint: '120:239', description: 'Render only these frames (inclusive), silent, with no framing check or mix, to out/wip/frames-<a>-<b>.mp4 or --out, and lossless beside it (<name>.lossless.mkv) for --join' },
    join: { type: 'string', valueHint: 'out/wip/bars', description: 'Join the --frames renders\' lossless frames in this folder (relative to the project unless absolute) into the whole video, encoded once under the mastered mix, to out/wip/joined.mp4 or --out. Refuses slices from two timelines or another clock than the project\'s now, a gap or an overlap' },
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
    const pipeline = await import('#lib/output/render/engine/render-pipeline.ts');
    const session = await openStudioRenderSession(args.project, { workers: args.workers, lens: args.lens });
    const inProject = (file: string) => (isAbsolute(file) ? file : join(session.project, file));
    if (range) {
      const [from, last] = range;
      for (const file of await pipeline.renderVideoSlice(session, { from, end: last + 1, out: inProject(args.out ?? `out/wip/frames-${from}-${last}.mp4`) })) console.log(file);
    } else if (args.animatic) {
      console.log(await pipeline.renderAnimatic(session, { out: inProject(args.out ?? 'out/wip/animatic.mp4') }));
    } else if (args.join) {
      console.log(await pipeline.joinVideoSlices(session, { dir: inProject(args.join), out: inProject(args.out ?? 'out/wip/joined.mp4') }));
    } else {
      for (const file of await pipeline.renderDeliveredVideo(session, { plain: Boolean(args.plain), onDraft: (warning) => console.error(warning) })) console.log(file);
    }
  },
});

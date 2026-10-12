// studio render: the whole pipeline, from framing check to a delivered video.mp4; the animatic, as the video plays
// now, for studio review; or a slice of the video (some frames, or one scene), which review lays into the cut.
import { defineCommand } from 'citty';
import { checkedCommandOutFlag } from '../command-flags.ts';
import { openStudioRenderSession, renderLensArg, renderWorkersArg, studioProjectArg } from '../project-arg.ts';

/**
 * Archives each video written that has its snapshot (out/.history/<hash>/, for review's render history and compare,
 * and for a slice a reply will name), then prunes the archive, keeping every render the review points at.
 */
async function keepRenderVersions(projectDir: string, written: readonly string[]) {
  const { archiveRender, pruneRenderArchive } = await import('#lib/output/render/engine/render-archive.ts');
  const { loadRenderSnapshot } = await import('#lib/output/render/engine/render-snapshot.ts');
  const { readReviewFile } = await import('#lib/output/review/engine/review-file.ts');
  const { projectMediaTypeOf } = await import('#lib/output/review/engine/project-media.ts');
  const { reviewReferencedHashes } = await import('#lib/output/review/models/review-threads.ts');
  for (const file of written) {
    if (projectMediaTypeOf(file)?.kind !== 'video') continue;
    const loaded = loadRenderSnapshot(file);
    if (loaded.kind === 'snapshot') archiveRender(projectDir, file, loaded.snapshot);
  }
  pruneRenderArchive(projectDir, reviewReferencedHashes(readReviewFile(projectDir)));
}

export default defineCommand({
  meta: {
    name: 'render',
    description: 'Refuses an estimated line → out/video.mp4 with captions, the framing check measuring every frame as it renders (nothing is delivered on a problem) → the mix, mastered to −14 LUFS, muxed under it → checked for length, audio and loudness → out/video.srt and out/video.vtt, paged by the caption style\'s sidecar rule, review sheets in out/check/, and each pass\'s time with the workers and GPU backends (WebGL and WebGPU) it had. A silent project (project.ts) skips the mix, mastering and loudness check, and writes a sidecar only from a caption table (captionTable in its timeline.ts): its videos must have no audio track. A mix that renders silent in any other project fails. A video cut to a tempo grid (tempoGrid in timeline.ts) with no music yet plays a click on each beat, a draft: its mix is mastered to −2 dBTP alone, with no loudness check, and the render warns it\'s a draft at its start and end. A transparent video (defineVideo({ format: { transparent: true } }), in a silent project) delivers out/video.webm (VP9 with alpha, for Chrome and Firefox) and out/video-hevc.mov (HEVC with alpha through macOS VideoToolbox, for Safari) instead of video.mp4, each checked for an alpha plane the page shows through; studio review plays the one the browser shows alpha in, over a checkerboard or a colour. With --animatic, the whole video as it plays now (any sound it has, captions on) with no framing check, mix or refusal of an estimated line, to out/wip/animatic.mp4 or --out: the render studio review approves the blocking and each scene built since on. With --frames or --scene, a slice: only those frames, or the frames one scene is on screen (its crossfades included), silent and unchecked, captions on as in the cut, to out/wip/slices/ or --out, ending with whether the review page will lay it into the newest cut (where, or why not) and the studio review reply line that hands it over. Every video it writes has <name>.snapshot.json beside it: the timeline it was rendered from, a timed project\'s clock (bars, beats, cues), the frames it holds and whether its voice was the draft, which studio review and studio look --video read. The bundle is kept between runs until a file it was built from changes. Renders run at low priority, in 1 tab for a project that paints (its project.ts names styles) and 3 otherwise, unless --workers or the video\'s renderWorkers says. Frames are drawn by two browsers at once, each a run of the frames in chunks, each chunk in a fresh browser, each streamed into its encodes as it draws (kept lossless too when a transparent video wants them); a chunk whose page or browser crashes, loses its GPU or stops making progress (no frame, painted solve or GPU answer for 2 minutes) is drawn again in halves, each in a fresh browser, down to a lone frame, which fails the render, named with its scene, if it fails again; and a render whose browser has only software GL or WebGPU fails. With --remote, the frames are drawn on the deployed remote app\'s GPUs (studio remote deploy; docs/remote.md) and finished here: --frames as a slice, or else the whole video, its pieces kept in out/wip/remote/ and joined under the mastered mix, to out/wip/joined.mp4 or --out; each call prints what it billed. Prints what it delivered; studio review open <project> plays it. Each video it writes with a snapshot is kept by its hash in out/.history/ (the last 8 of each path, every one a review note, reply or decision names, under 5 GB), for the review page\'s render history and compare, and the page shows a render under way while it draws.',
  },
  args: {
    project: studioProjectArg,
    workers: renderWorkersArg,
    lens: renderLensArg,
    plain: { type: 'boolean', description: 'Also render out/video-plain.mp4, without captions' },
    animatic: { type: 'boolean', description: 'Render the video as it plays now, unchecked and unmixed, to out/wip/animatic.mp4 or --out, for studio review' },
    frames: { type: 'string', valueHint: '120:239', description: 'Render only these frames (inclusive), silent, with no framing check or mix, to out/wip/slices/frames-<a>-<b>.mp4 or --out: a slice, which review lays into the cut when its span is unchanged there' },
    scene: { type: 'string', valueHint: 'ink', description: 'Render one scene (its crossfades too), silent, to out/wip/slices/scene-<id>.mp4 or --out. Reply --render with it and the review page lays it into the cut over that scene, under the cut\'s sound. A scene whose length changed can\'t be laid in: render the whole video' },
    remote: { type: 'boolean', description: 'Draw the frames on the remote app\'s GPUs (studio remote deploy), not this machine\'s: a --frames slice (its only slice form: the remote app draws frames and doesn\'t resolve scenes), or else the whole video joined under the mastered mix to out/wip/joined.mp4 or --out, never the delivered video. Prints what each container billed' },
    trace: { type: 'string', valueHint: 'detail:120:239', description: 'Trace these frames\' solves in detail, each sheet entry and GPU step a span (detail for every frame, detail:a:b for frames a to b, inclusive), where the trace npm run trace reads holds each solve whole. A span a step, so a few frames is plenty' },
    out: { type: 'string', valueHint: 'out/wip/v2.mp4', description: 'The .mp4 --frames, --scene, --animatic or --remote writes, relative to the project unless absolute, in a folder that exists or under the project\'s out/; checked before anything renders' },
  },
  async run({ args }) {
    const { join, relative, sep } = await import('node:path');
    if ([args.frames, args.scene, args.animatic].filter(Boolean).length > 1) throw new Error('--frames and --scene render a slice and --animatic the animatic: give one');
    if ((args.frames || args.scene || args.animatic) && args.plain) throw new Error('--plain is for the delivered video: leave it out of --frames, --scene and --animatic');
    if (args.remote && (args.scene || args.animatic || args.plain)) throw new Error('--remote draws frames it is given, a --frames slice or the whole video joined, and resolves no scene: give a scene as --frames (watch\'s scene: line prints its frames), and leave out --animatic and --plain');
    if (args.remote && args.trace) throw new Error('--trace traces a render drawn here: leave it out of --remote');
    if (args.out && !args.frames && !args.scene && !args.animatic && !args.remote) throw new Error('the delivered video goes to out/video.mp4: --out is for --frames, --scene, --animatic and --remote');
    const range = args.frames?.split(':').map(Number);
    if (range && !(range.length === 2 && range.every(Number.isInteger) && range[0] >= 0 && range[1] >= range[0])) {
      throw new Error(`--frames is a first and last frame like 120:239, not ${args.frames}`);
    }
    const sceneSpan = args.scene === undefined ? undefined : { scene: args.scene };
    const span = range ? { from: range[0], end: range[1] + 1 } : sceneSpan;
    const { resolveStudioProjectWith } = await import('#lib/platform/project/engine/studio-project.ts');
    const { openRenderLedger } = await import('#lib/output/render/engine/render-ledger.ts');
    const { withRenderHistory } = await import('#lib/output/render/engine/render-history.ts');
    const { renderSlicePathOf } = await import('#lib/output/render/models/render-splice.ts');
    await withRenderHistory(process.argv.slice(2), async ({ trace, keep }) => {
      const project = resolveStudioProjectWith(args.project, 'video.tsx');
      // Each out is checked before its session opens: a render queues for the GPU and draws for minutes before it writes.
      const outOr = (fallback: string) => checkedCommandOutFlag(args.out ?? fallback, { base: project, writes: ['.mp4'], madeIn: join(project, 'out') });
      const remoteWorkers = args.remote && args.workers !== undefined ? Number(args.workers) : undefined;
      // Checked here, as a local render's session checks them, so a typo fails before anything uploads.
      if (remoteWorkers !== undefined && !(Number.isInteger(remoteWorkers) && remoteWorkers > 0)) throw new Error(`--workers is ${args.workers}: give a whole number above 0`);
      const outOfRender = () => {
        if (span) return outOr(renderSlicePathOf(span));
        if (args.animatic) return outOr('out/wip/animatic.mp4');
        return args.remote ? outOr('out/wip/joined.mp4') : join(project, 'out', 'video.mp4');
      };
      const out = outOfRender();
      const openSession = async () => openStudioRenderSession(project, { workers: args.workers, lens: args.lens, trace: args.trace, ledger: keep(await openRenderLedger(project, trace)) });
      const renderFiles = async (): Promise<string[]> => {
        if (args.remote) {
          const { renderRemotely } = await import('#lib/output/remote-render/engine/remote-render.ts');
          const { lensModeChecked } = await import('#lib/picture/lens/models/lens-mode.ts');
          const frames = range && { from: range[0], end: range[1] + 1 };
          return renderRemotely(keep(await openRenderLedger(project, trace)), {
            out, ...(frames && { frames }),
            ...(args.lens !== undefined && { lens: lensModeChecked(args.lens) }), ...(remoteWorkers !== undefined && { workers: remoteWorkers }),
          });
        }
        const pipeline = await import('#lib/output/render/engine/render-pipeline.ts');
        if (span) {
          const { renderVideoSlice } = await import('#lib/output/render/engine/render-slices.ts');
          return [await renderVideoSlice(await openSession(), { span, out })];
        }
        if (args.animatic) return [await pipeline.renderAnimatic(await openSession(), { out })];
        return pipeline.renderDeliveredVideo(await openSession(), { plain: Boolean(args.plain), onDraft: (warning) => console.error(warning) });
      };
      // The review screen shows a render on its way while this marker stands; a killed render's reads as none.
      const { clearRenderProgress, writeRenderProgress } = await import('#lib/output/render/engine/render-progress.ts');
      const delivered = !span && !args.animatic && !args.remote;
      const paths = delivered ? ['out/video.mp4', 'out/video.webm', 'out/video-hevc.mov'] : [relative(project, out).split(sep).join('/')];
      writeRenderProgress(project, { paths, ...(args.scene && { scene: args.scene }), ...(range && { frames: { from: range[0], end: range[1] + 1 } }) });
      let written: string[];
      try {
        written = await renderFiles();
      } finally {
        clearRenderProgress(project);
      }
      await keepRenderVersions(project, written);
      for (const file of written) console.log(file);
      if (span) await printSpliceVerdict(project, out);
    });
  },
});

/**
 * Where the review page will show the slice at `out`, and the reply that hands it over: the agent fills in the note's
 * id and what changed, which watch's `fix:` line has already filled.
 */
async function printSpliceVerdict(projectDir: string, out: string) {
  const { basename, relative, sep } = await import('node:path');
  const { formatRenderSpliceVerdict } = await import('#lib/output/render/engine/render-cuts.ts');
  const { loadRenderSnapshot } = await import('#lib/output/render/engine/render-snapshot.ts');
  const { formatSliceReplyCommand } = await import('#lib/output/render/models/render-splice.ts');
  const loaded = loadRenderSnapshot(out);
  if (loaded.kind === 'none') throw new Error(loaded.reason);
  const verdict = formatRenderSpliceVerdict(projectDir, loaded.snapshot);
  if (verdict) console.log(verdict);
  console.log(`commit, then ${formatSliceReplyCommand(basename(projectDir), '<id>', relative(projectDir, out).split(sep).join('/'))}`);
}

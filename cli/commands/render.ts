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
    description: "Render the delivered video, the animatic for review, or a slice (some frames, or one scene).",
    about: "With no mode flag, delivers out/video.mp4 with captions: it refuses a line whose timing is still estimated, runs the framing check on every frame as it renders, masters the mix to −14 LUFS under it, and checks length, audio and loudness; then writes out/video.srt and out/video.vtt and review sheets in out/check/. Nothing is delivered on a problem.\n- A silent project skips the mix, mastering and loudness check, and its videos must have no audio track; it writes a sidecar only from a caption table (`captions.table` in its video.tsx). In any other project, a mix that renders silent fails.\n- A video cut to a tempo grid (`grid: { tempo }` in storyboard.ts) with no music yet is a draft: a click on each beat, mastered to −2 dBTP alone with no loudness check, and warned of at the render's start and end.\n- A transparent video (defineVideo({ format: { transparent: true } }), in a silent project) delivers out/video.webm (VP9 with alpha, for Chrome and Firefox) and out/video-hevc.mov (HEVC with alpha, for Safari) instead of video.mp4, each checked for an alpha plane.\n\n--animatic: the whole video as it plays now, captions on, with whatever sound it has (a tempo grid's clicks, a draft voice, the fitted music) unmastered, and no framing check or refusal of an estimated line. Review approves the blocking, and each scene built since, on it.\n\n--frames or --scene: a slice, silent and unchecked, captions as in the cut. It ends saying whether the review page will lay it into the newest cut (where, or why not; a scene whose length changed can't be laid in, so render the whole video) and with the `studio review reply` line that hands it over.\n\n--remote: the frames are drawn on the deployed remote app's GPUs (studio remote deploy) and finished here: a --frames slice (the app resolves no scene, and draws no animatic), or the whole video joined under the mastered mix, never the delivered video. Each call prints what it billed.\n\nEvery video it writes has <name>.snapshot.json beside it (the timeline it was rendered from, a timed project's clock, its frames, and whether its voice was the draft), which studio review and studio look --video read, and is kept by its hash in out/.history/ for the review page's history and compare. A chunk whose browser crashes or stalls is redrawn in halves; the render fails if a lone frame still fails (naming its scene), or if the browser has only software GL or WebGPU. Prints what it delivered; `studio review open <project>` plays it.",
  },
  args: {
    project: studioProjectArg,
    workers: renderWorkersArg,
    lens: renderLensArg,
    plain: { type: 'boolean', description: 'Also render out/video-plain.mp4, without captions' },
    animatic: { type: 'boolean', description: 'Render the animatic, to out/wip/animatic.mp4 or --out' },
    frames: { type: 'string', valueHint: '120:239', description: 'Render a slice of these frames (inclusive), to out/wip/slices/frames-<a>-<b>.mp4 or --out' },
    scene: { type: 'string', valueHint: 'ink', description: 'Render a slice of one scene, its crossfades too, to out/wip/slices/scene-<id>.mp4 or --out' },
    remote: { type: 'boolean', description: 'Draw the frames on the remote app\'s GPUs, not this machine\'s: a --frames slice, or the whole video joined to out/wip/joined.mp4 or --out' },
    trace: { type: 'string', valueHint: 'detail:120:239', description: 'Trace these frames\' solves in detail, each sheet entry and GPU step a span: detail for every frame, detail:a:b for frames a to b (inclusive). A span a step, so a few frames is plenty; `studio trace` reads it' },
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

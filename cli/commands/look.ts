// studio look: every question asked of a render's frames, answered from the composition or a rendered video: sheets of
// chosen frames, before/after against another render, a stretch's motion stats, and graphs of its tracked elements, or
// of its pieces read from their scene models with no render.
import { defineCommand } from 'citty';
import { openStudioRenderSession, renderLensArg, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'look',
    description: 'Look at a render\'s frames without watching it: a labelled sheet of chosen frames, the same frames before and after (--against) with the pixels that changed, a stretch\'s motion stats (--motion), its tracked motion graphed (--graph=a:b), or each piece\'s place and HUD clearance read from its scene model with no render (--graph=models). Frames come from the composition unless --video names a render; --set paints its paintings at other property values. Aim with out/check/timeline.json from `studio check`. Prints its files; open an image with an image viewer or the Read tool.',
  },
  args: {
    project: studioProjectArg,
    frames: { type: 'string', valueHint: '200:210', description: 'What do these frames look like? 200:210 (inclusive), 200:260:5 (every 5th) or 161,176,191' },
    bar: { type: 'string', valueHint: '3', description: 'What does this bar look like, or how does it move? Every frame of a music-led project\'s bar N' },
    sheet: { type: 'string', valueHint: '0.5,4,9', description: 'What do these moments look like? Times in seconds; the end second names the last frame' },
    strip: { type: 'string', valueHint: '4:5', description: 'How does this stretch move? Seconds from:to, every --step seconds' },
    video: { type: 'string', valueHint: 'out/video.mp4', description: 'What does a render show, rather than the code? Read frames from this video (relative to the project unless absolute)' },
    against: { type: 'string', valueHint: 'out/wip/before.mp4', description: 'What did a change move? Each frame of this render (before) beside the composition\'s or --video\'s (after) and the pixels that really changed, with each frame\'s changed-pixel count; with no frames given, every frame, the sheet showing the most changed' },
    'starts-at': { type: 'string', description: 'Where in the project does a render with no snapshot start? The project frame of --video\'s and --against\'s first frame (default 0). A render with a snapshot (studio render made it) starts where its snapshot says, whatever this is' },
    motion: { type: 'boolean', description: 'Does it keep moving? Each frame\'s mean change from the one before over --frames=a:b, a --bar or the whole video, each bar\'s mean, the still runs and the beat frames; every frame\'s numbers go to a .txt' },
    still: { type: 'string', default: '3.5', description: 'For --motion: what counts as still? A mean change from the frame before under this' },
    crop: { type: 'string', valueHint: '0,120,1920,840', description: 'Only this region, x,y,w,h in the video\'s pixels: the sheet shows it, and --against and --motion measure only it (leave out a HUD whose timecode always changes)' },
    graph: { type: 'string', valueHint: 'models | 4:6', description: 'Where does each piece go? models: read from the scene models (bars/<id>-model.ts) over --bar or --frames with no render, each piece\'s position, values and clearance from what it keeps clear of (the HUD) a frame, as a table and graph; the first move before rendering a change. 4:6: a stretch of seconds, rendered and measured: each tracked element\'s position, velocity, size, opacity and reported values, voice words and crossfades marked, trails over one of its frames' },
    tracks: { type: 'string', valueHint: 'push/centre,cursor', description: 'For --graph: these tracks (ids, or parts of them); default the ones that move most (all, for models)' },
    local: { type: 'boolean', description: 'For --graph: plot boxes in their owner\'s frame (a camera\'s page, a group\'s pixels), not on screen' },
    step: { type: 'string', default: '0.1', description: 'Seconds between --strip frames, or --graph trail dots' },
    cols: { type: 'string', description: 'Columns (default 3; 5 for --strip; before/after rows for --against, default 1)' },
    w: { type: 'string', description: 'Width of each frame in pixels (default 640; 384 for --strip)' },
    captions: { type: 'boolean', description: 'Burn captions in (the composition only)' },
    lens: { ...renderLensArg, description: `${renderLensArg.description}; the composition only` },
    set: { type: 'string', valueHint: 'heron.reflection=0.5,dusk.level=0.3', description: 'How would a painting look at another value, in its scene? Paint each named painting (by its factory\'s name) at these property values over the scenes\' own, held to its schema as `studio paint check --set` holds them; the composition only' },
    out: { type: 'string', description: 'Where to write, relative to the project unless absolute (default out/check/sheet.jpg, against.jpg, motion.txt or graph.png)' },
  },
  async run({ args }) {
    const { isAbsolute, join } = await import('node:path');
    const step = Number(args.step);
    if (!(step > 0 && Number.isFinite(step))) throw new Error(`--step must be a positive number of seconds, not ${args.step}`);

    if (args.set !== undefined && (args.video || args.graph === 'models')) throw new Error('--set paints the composition at other painting values: leave out --video and --graph=models');
    if (args.graph === 'models') {
      if ([args.sheet, args.strip, args.video, args.against, args.motion, args.local].some(Boolean)) throw new Error('--graph=models reads the scene models over --bar=N or --frames=a:b: give it no video, times or --motion');
      if (Boolean(args.frames) === Boolean(args.bar)) throw new Error('--graph=models reads a stretch: give it --bar=N or --frames=a:b');
      if (args.out && !/\.png$/i.test(args.out)) throw new Error(`a --graph is an image: give --out a .png name, not ${args.out}`);
      const { resolveStudioProjectWith } = await import('#lib/platform/project/engine/studio-project.ts');
      const { lookBarFrames, parseLookFrames } = await import('#lib/output/look/models/look-frames.ts');
      const { readProjectClock } = await import('#lib/output/render/engine/project-clock.ts');
      const { lookPieceModels } = await import('#lib/output/look/engine/piece-look.ts');
      const project = resolveStudioProjectWith(args.project, 'timeline.ts');
      const frames = args.frames ? parseLookFrames(args.frames) : lookBarFrames(await readProjectClock(project), args.bar ?? '', project);
      const lines = await lookPieceModels(project, {
        frames, tracks: args.tracks?.split(',').map((t) => t.trim()).filter(Boolean),
        out: args.out && isAbsolute(args.out) ? args.out : join(project, args.out ?? 'out/check/models.png'),
      });
      for (const line of lines) console.log(line);
      return;
    }

    if (args.graph) {
      if ([args.frames, args.bar, args.sheet, args.strip, args.video, args.against, args.motion].some(Boolean)) throw new Error('--graph=a:b measures the composition on its own: give it no frames, video or --motion (--graph=models reads a --bar or --frames)');
      const at = args.graph.split(':').map(Number);
      if (!(at.length === 2 && at.every(Number.isFinite) && at[0] < at[1])) throw new Error(`--graph is a stretch of seconds like 4:6, not ${args.graph}`);
      if (args.out && !/\.(png|jpe?g)$/i.test(args.out)) throw new Error(`a --graph is an image: give --out a .png or .jpg name, not ${args.out}`);
      const session = await openStudioRenderSession(args.project, { paintings: args.set });
      const { renderMotionGraph } = await import('#lib/output/render/engine/render-pipeline.ts');
      const graph = await renderMotionGraph(session, {
        at: [at[0], at[1]], tracks: args.tracks?.split(',').map((t) => t.trim()).filter(Boolean), space: args.local ? 'local' : 'screen',
        trailStep: step, captions: Boolean(args.captions), out: args.out && isAbsolute(args.out) ? args.out : join(session.project, args.out ?? 'out/check/graph.png'),
      });
      for (const line of [...graph.summary, '', ...graph.files]) console.log(line);
      return;
    }

    if ([args.frames, args.bar, args.sheet, args.strip].filter(Boolean).length > 1) throw new Error('choose frames one way: --frames, --bar, --sheet or --strip');
    if (args.motion && args.against) throw new Error('--motion measures one render: leave out --against');
    const { resolveStudioProjectWith } = await import('#lib/platform/project/engine/studio-project.ts');
    const { lookAgainst, lookFrameSheet, lookMotion, openLookSource } = await import('#lib/output/look/engine/frame-look.ts');
    const { lookFramesOf, parseLookCrop } = await import('#lib/output/look/models/look-frames.ts');
    const { readProjectClock } = await import('#lib/output/render/engine/project-clock.ts');
    const project = resolveStudioProjectWith(args.project, 'video.tsx');
    const inProject = (file: string) => (isAbsolute(file) ? file : join(project, file));
    const out = inProject(args.out ?? (args.motion ? 'out/check/motion.txt' : args.against ? 'out/check/against.jpg' : 'out/check/sheet.jpg'));
    const givenStart = args['starts-at'] === undefined ? undefined : Number(args['starts-at']);
    if (givenStart !== undefined && !(Number.isInteger(givenStart) && givenStart >= 0)) throw new Error(`--starts-at is a frame number, not ${args['starts-at']}`);
    const crop = args.crop ? parseLookCrop(args.crop) : undefined;
    const cols = Number(args.cols ?? (args.against ? 1 : args.strip ? 5 : 3)), w = Number(args.w ?? (args.strip ? 384 : 640));
    if (!(Number.isInteger(cols) && cols > 0 && Number.isInteger(w) && w > 0)) throw new Error('--cols and --w are positive whole numbers');
    const still = Number(args.still);
    if (args.motion && !(still > 0)) throw new Error(`--still is a positive mean change, not ${args.still}`);
    const { loadRenderSnapshot } = await import('#lib/output/render/engine/render-snapshot.ts');
    // Where a render starts in the project: its snapshot says, and --starts-at places only one without a snapshot.
    const renderSource = (file: string) => {
      const loaded = loadRenderSnapshot(file);
      return { kind: 'video' as const, file, startsAt: loaded.kind === 'snapshot' ? loaded.snapshot.frames.from : givenStart ?? 0 };
    };
    const ask = { frames: args.frames, bar: args.bar, sheet: args.sheet, strip: args.strip, step, every: Boolean(args.motion || args.against) };
    const clock = args.bar || args.motion ? await readProjectClock(project) : undefined;

    type LookSource = Parameters<typeof openLookSource>[0];
    const look = async (opening: LookSource) => {
      const source = await openLookSource(opening);
      // A render names its frames by the clock: it must be the whole reel or one bar, placed by its snapshot or --starts-at.
      if (clock && args.video && !(source.first === 0 && source.end === clock.end) && !clock.bars.some((b) => b.from === source.first && b.to === source.end)) {
        throw new Error(`${source.name} holds frames ${source.first}–${source.end - 1}, which is neither the whole reel (0–${clock.end - 1}) nor one bar: ` +
          'render it again with studio render --frames, whose snapshot places it, or give one without a snapshot --starts-at=<its bar\'s first frame>');
      }
      const frames = lookFramesOf(ask, source, { clock, project });
      if (args.motion) {
        if (frames.some((f, i) => i && f !== frames[i - 1] + 1)) throw new Error('--motion measures a stretch: --frames=a:b or --bar=N');
        return lookMotion(source, frames[0], frames.at(-1)!, { crop, still, clock, out });
      }
      return args.against
        ? lookAgainst(await openLookSource(renderSource(inProject(args.against))), source, frames, { crop, cols, w, out })
        : lookFrameSheet(source, frames, { crop, cols, w, out });
    };
    const lines = await look(args.video
      ? renderSource(inProject(args.video))
      : { kind: 'composition', session: await openStudioRenderSession(project, { lens: args.lens, paintings: args.set }), captions: Boolean(args.captions) });
    for (const line of lines) console.log(line);
  },
});

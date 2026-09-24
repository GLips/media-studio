// studio look: contact sheets of chosen frames, and graphs of a stretch's motion, to check without rendering video.
import { defineCommand } from 'citty';
import { openStudioRenderSession, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'look',
    description: 'Render chosen moments, small, into one labelled image, or graph a stretch\'s motion (open it with an image viewer or the Read tool). Aim with out/check/timeline.json from `studio check`. Prints the image; a --graph also prints its numbers and writes them beside it (.txt).',
  },
  args: {
    project: studioProjectArg,
    sheet: { type: 'string', valueHint: '0.5,4,9', description: 'These times, in seconds' },
    strip: { type: 'string', valueHint: '4:5', description: 'A stretch of time, every --step seconds, for motion' },
    graph: { type: 'string', valueHint: '4:6', description: 'A stretch of time, measured: each tracked element\'s position, velocity, size, opacity and reported values over time, voice words and crossfades marked, trails over its last frame' },
    tracks: { type: 'string', valueHint: 'push/centre,cursor', description: 'For --graph: these tracks (ids, or parts of them); default the ones that move most' },
    local: { type: 'boolean', description: 'For --graph: plot boxes in their owner\'s frame (a camera\'s page, a group\'s pixels), not on screen' },
    step: { type: 'string', default: '0.1', description: 'Seconds between --strip frames, or --graph trail dots' },
    cols: { type: 'string', description: 'Columns (default 3 for --sheet, 5 for --strip)' },
    w: { type: 'string', description: 'Width of each frame in pixels (default 640 for --sheet, 384 for --strip)' },
    captions: { type: 'boolean', description: 'Burn captions in' },
    out: { type: 'string', description: 'The image, relative to the project unless absolute (default out/check/sheet.jpg, or graph.png)' },
  },
  async run({ args }) {
    if ([args.sheet, args.strip, args.graph].filter(Boolean).length !== 1) throw new Error('give one of --sheet=0.5,4,9, --strip=4:5 or --graph=4:6');
    const step = Number(args.step);
    if (!(step > 0 && Number.isFinite(step))) throw new Error(`--step must be a positive number of seconds, not ${args.step}`);
    const { isAbsolute, join } = await import('node:path');
    const session = await openStudioRenderSession(args.project);
    const out = (fallback: string) => (args.out && isAbsolute(args.out) ? args.out : join(session.project, args.out ?? fallback));

    if (args.graph) {
      const at = args.graph.split(':').map(Number);
      if (!(at.length === 2 && at.every(Number.isFinite) && at[0] < at[1])) throw new Error(`--graph is a stretch of seconds like 4:6, not ${args.graph}`);
      const { renderMotionGraph } = await import('../../lib/render-pipeline.ts');
      const graph = await renderMotionGraph(session, {
        at: [at[0], at[1]], tracks: args.tracks?.split(',').map((t) => t.trim()).filter(Boolean), space: args.local ? 'local' : 'screen',
        trailStep: step, captions: Boolean(args.captions), out: out('out/check/graph.png'),
      });
      for (const line of [...graph.summary, '', ...graph.files]) console.log(line);
      return;
    }

    const { renderContactSheet, stripTimes } = await import('../../lib/render-pipeline.ts');
    const strip = args.strip?.split(':').map(Number);
    const times = strip ? stripTimes(strip[0], strip[1], step) : args.sheet!.split(',').map(Number);
    console.log(await renderContactSheet(session, times, out('out/check/sheet.jpg'), {
      cols: Number(args.cols ?? (strip ? 5 : 3)), w: Number(args.w ?? (strip ? 384 : 640)), captions: Boolean(args.captions),
    }));
  },
});

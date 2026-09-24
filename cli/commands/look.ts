// studio look: contact sheets of chosen frames, to check frames without rendering video.
import { defineCommand } from 'citty';
import { openStudioRenderSession, studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'look',
    description: 'Render chosen moments, small, into one labelled image (open it with an image viewer or the Read tool). Aim with out/check/timeline.json from `studio check`. Prints the image.',
  },
  args: {
    project: studioProjectArg,
    sheet: { type: 'string', valueHint: '0.5,4,9', description: 'These times, in seconds' },
    strip: { type: 'string', valueHint: '4:5', description: 'A stretch of time, every --step seconds, for motion' },
    step: { type: 'string', default: '0.1', description: 'Seconds between --strip frames' },
    cols: { type: 'string', description: 'Columns (default 3 for --sheet, 5 for --strip)' },
    w: { type: 'string', description: 'Width of each frame in pixels (default 640 for --sheet, 384 for --strip)' },
    captions: { type: 'boolean', description: 'Burn captions in' },
    out: { type: 'string', default: 'out/check/sheet.jpg', description: 'The image, relative to the project unless absolute' },
  },
  async run({ args }) {
    if (!args.sheet === !args.strip) throw new Error('give one of --sheet=0.5,4,9 or --strip=4:5');
    const step = Number(args.step);
    if (!(step > 0 && Number.isFinite(step))) throw new Error(`--step must be a positive number of seconds, not ${args.step}`);
    const { isAbsolute, join } = await import('node:path');
    const { renderContactSheet, stripTimes } = await import('../../lib/render-pipeline.ts');
    const strip = args.strip?.split(':').map(Number);
    const times = strip ? stripTimes(strip[0], strip[1], step) : args.sheet!.split(',').map(Number);
    const session = await openStudioRenderSession(args.project);
    const out = isAbsolute(args.out) ? args.out : join(session.project, args.out);
    console.log(await renderContactSheet(session, times, out, {
      cols: Number(args.cols ?? (strip ? 5 : 3)), w: Number(args.w ?? (strip ? 384 : 640)), captions: Boolean(args.captions),
    }));
  },
});

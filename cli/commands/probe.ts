// studio probe: a look at a page as the project's capture sees it, for writing shots (lib/engine/capture/page-probe.ts).
import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'probe',
    description: "Open a page the way the project's capture.ts does (signed in by its prepare, with its css) and screenshot the viewport, numbered to match a list of its interactive and landmark elements, each with a selector for capture.ts rects and how many elements it matches. With --at, the element under that point and the meaningful ones around it instead. Prints the screenshot, then the list.",
  },
  args: {
    project: studioProjectArg,
    target: { type: 'positional', required: true, description: "A URL, an HTML file, or a path (/inbox) on the site the capture's prepare signs in to" },
    at: { type: 'string', valueHint: 'x,y', description: 'A point in the viewport, in CSS pixels (as on the screenshot)' },
    device: { type: 'string', description: "One of capture.ts's devices, instead of the main viewport" },
    wait: { type: 'string', default: '2', description: 'Seconds to let the page settle after it loads' },
  },
  async run({ args }) {
    const at = args.at?.split(',').map(Number);
    if (at && (at.length !== 2 || at.some((n) => !Number.isFinite(n)))) throw new Error(`--at must be x,y in viewport pixels, not ${args.at}`);
    const wait = Number(args.wait);
    if (!(wait >= 0)) throw new Error(`--wait must be seconds, not ${args.wait}`);
    const { resolveStudioProjectWith } = await import('../../lib/engine/project/studio-project.ts');
    const { formatPageProbe, probeProjectPage } = await import('../../lib/engine/capture/page-probe.ts');
    const project = resolveStudioProjectWith(args.project, 'capture.ts');
    const probe = await probeProjectPage(project, args.target, { at: at && { x: at[0], y: at[1] }, device: args.device, wait });
    console.log(probe.screenshot);
    for (const line of formatPageProbe(probe)) console.log(line);
  },
});

// studio still: renders a project's stills (stills.tsx) to image files.
import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

const list = (value: string | undefined) => value?.split(',').map((v) => v.trim()).filter(Boolean);

export default defineCommand({
  meta: {
    name: 'still',
    description: "Render the project's stills (its stills.tsx: defineStills designs, each at its presets og 1200×630, youtube 1280×720, square 1080×1080, portrait 1080×1350, story 1080×1920, once per variant) to out/stills/<design>-<preset>-<variant>.png. Prints each file; on stderr, the size and width each FitText settled on, flagging one at its floor or overflowing. Open one with `studio review <file>`.",
  },
  args: {
    project: studioProjectArg,
    design: { type: 'string', valueHint: 'card', description: 'Only these designs (comma-separated)' },
    preset: { type: 'string', valueHint: 'og,youtube', description: 'Only these presets' },
    variant: { type: 'string', valueHint: 'short', description: 'Only these variants' },
    jpg: { type: 'boolean', description: 'JPEG (quality 92), not PNG' },
  },
  async run({ args }) {
    const { resolveStudioProjectWith } = await import('../../lib/studio-project.ts');
    const { describeStillFits, renderProjectStills } = await import('../../lib/render-stills.ts');
    const project = resolveStudioProjectWith(args.project, 'stills.tsx');
    const stills = await renderProjectStills(project, { designs: list(args.design), presets: list(args.preset), variants: list(args.variant) }, { format: args.jpg ? 'jpeg' : 'png' });
    for (const still of stills) {
      for (const line of describeStillFits(still)) console.error(line);
      console.log(still.file);
    }
  },
});

// studio still: renders a project's stills (stills.tsx) to image files, refusing any that fails the still check.
import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

const list = (value: string | undefined) => value?.split(',').map((v) => v.trim()).filter(Boolean);

export default defineCommand({
  meta: {
    name: 'still',
    description: "Render the project's stills (its stills.tsx: defineStills designs, each at its presets og 1200×630, youtube 1280×720, square 1080×1080, portrait 1080×1350, story 1080×1920, once per variant) to out/stills/<design>-<preset>-<variant>.png. Checks each first and refuses to write one with a problem (removing an older file of its name): text cut off, overflowing its box or fitted at its floor; text or a logo under YouTube's duration badge or a story's top and bottom bars; text under 4.5:1 against its ground (3:1 at display sizes); an image drawn at over 1.5× its pixels; a crop showing an empty band of its image. Warns of a variant axis whose values look alike at a preset at feed size (a crop the frame can't show). Prints each file written; on stderr, each FitText's size and every problem. Exits 1 if any still fails. --sheet also lays each design's variants out at each preset, by the design's axes, in out/still-sheets/<design>-<preset>.png: every variant with a row under it at the sizes a feed shows it (YouTube's 168×94 and 320×180, a social image about 300 px wide), refused ones framed red with their problems, and a look-alike axis flagged. Open one with `studio review <file>`, where a note names the variant under it.",
  },
  args: {
    project: studioProjectArg,
    design: { type: 'string', valueHint: 'card', description: 'Only these designs (comma-separated)' },
    preset: { type: 'string', valueHint: 'og,youtube', description: 'Only these presets' },
    variant: { type: 'string', valueHint: 'short', description: 'Only these variants' },
    jpg: { type: 'boolean', description: 'JPEG (quality 92), not PNG' },
    check: { type: 'boolean', description: 'Only check: report the problems, write no stills' },
    sheet: { type: 'boolean', description: 'Also write a sheet of the variants per design and preset, with each at feed size, to pick between them' },
  },
  async run({ args }) {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { resolveStudioProjectWith } = await import('../../lib/studio-project.ts');
    const { describeStillFits, renderProjectStills } = await import('../../lib/render-stills.ts');
    const { stillName } = await import('../../lib/studio/still-presets.ts');
    const project = resolveStudioProjectWith(args.project, 'stills.tsx');
    // A sheet shows refused stills too, so every still is kept as drawn until the sheets are laid out.
    const drawnDir = args.sheet ? mkdtempSync(join(tmpdir(), 'still-sheet-')) : undefined;
    try {
      const stills = await renderProjectStills(project, { designs: list(args.design), presets: list(args.preset), variants: list(args.variant) }, { format: args.jpg ? 'jpeg' : 'png', check: Boolean(args.check), drawnDir });
      for (const still of stills) {
        for (const line of describeStillFits(still)) console.error(line);
        for (const p of still.problems) console.error(`  ✗ ${stillName(still.still)}: ${p.problem}`);
        if (still.file) console.log(still.file);
      }
      const failed = stills.filter((s) => s.problems.length);
      console.error(failed.length
        ? `still check: ${failed.length} of ${stills.length} failed${args.check ? '' : ', not written'}: ${failed.map((s) => stillName(s.still)).join(', ')}`
        : `still check ✓ (${stills.length} still${stills.length > 1 ? 's' : ''})`);
      if (failed.length) process.exitCode = 1;
      const { describeLookAlikeAxis, stillAxesThatLookAlike } = await import('../../lib/still-sheet.ts');
      for (const alike of stillAxesThatLookAlike(stills)) console.error(`⚠ ${describeLookAlikeAxis(alike)}`);
      if (drawnDir) {
        const { renderStillSheets } = await import('../../lib/still-sheet.ts');
        for (const sheet of await renderStillSheets(stills, { outDir: join(project, 'out', 'still-sheets'), workDir: drawnDir, project })) console.log(sheet);
      }
    } finally {
      if (drawnDir) rmSync(drawnDir, { recursive: true, force: true });
    }
  },
});

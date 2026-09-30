// node harness/wet-passage-sheet.ts paint --out <dir> (npm run wet:passages -- --out <dir>): the reference-passages sheet,
// wet paint's six passages painted in watercolour, gouache and crayon from the workspace's styles, and a page to judge
// them by (lib/picture/brush-fidelity/engine/wet-passage-sheet.ts). Notes on what's rough live in <dir>/notes.json.
import { defineCommand } from 'citty';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { writeWetPassageSheet } from '#lib/picture/brush-fidelity/engine/wet-passage-sheet.ts';
import { STUDIO_ROOT, STUDIO_STYLES_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { runHarnessCommand } from './run-harness-command.ts';

const paintCommand = defineCommand({
  meta: { name: 'paint', description: 'Paint the reference passages (a wet-in-wet sky, a softened edge, a hard edge, merged strokes, a graded wash, a lifted cloud) in each medium, with a page to judge them by.' },
  args: {
    out: { type: 'string', required: true, description: 'The folder to write the page and its images into; its notes.json, if any, is read' },
    references: { type: 'string', description: "A folder of reference images to link by absolute path, never copied (default: the watercolor style's references/)" },
  },
  async run({ args }) {
    const referencesDir = resolve(args.references ?? join(STUDIO_STYLES_DIR, 'watercolor', 'references'));
    const references = existsSync(referencesDir) ? readdirSync(referencesDir).filter((file) => /\.(jpe?g|png|webp)$/i.test(file)).map((file) => join(referencesDir, file)) : [];
    for (const file of await writeWetPassageSheet({ stylesDir: STUDIO_STYLES_DIR, out: resolve(args.out), references })) console.log(relative(STUDIO_ROOT, file));
  },
});

await runHarnessCommand(defineCommand({
  meta: { name: 'wet-passage-sheet', description: "Wet paint's reference passages, painted and laid out to be judged" },
  subCommands: { paint: paintCommand },
}));

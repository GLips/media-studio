// node harness/dry-passage-sheet.ts paint --out <dir> (npm run dry:passages -- --out <dir>): the dry passage sheet,
// layered hatching, strokes that turn and burnishing drawn in a dry workspace style
// (lib/paint/studies/engine/dry-passage-sheet.ts), a PNG a passage.
import { defineCommand } from 'citty';
import { relative, resolve } from 'node:path';
import { writeDryPassageSheet } from '#lib/paint/studies/engine/dry-passage-sheet.ts';
import { STUDIO_ROOT, STUDIO_STYLES_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { runHarnessCommand } from './run-harness-command.ts';

const paintCommand = defineCommand({
  meta: { name: 'paint', description: 'Draw the dry passages (tooth through layers, strokes that turn, burnishing) in a dry style, a PNG each.' },
  args: {
    out: { type: 'string', required: true, description: 'The folder to write the PNGs into' },
    style: { type: 'string', default: 'crayon', description: 'The workspace style to draw in, with brushes named stick and side' },
  },
  async run({ args }) {
    for (const file of await writeDryPassageSheet({ stylesDir: STUDIO_STYLES_DIR, style: args.style, out: resolve(args.out) })) console.log(relative(STUDIO_ROOT, file));
  },
});

await runHarnessCommand(defineCommand({
  meta: { name: 'dry-passage-sheet', description: "Dry media's passages, drawn to be judged" },
  subCommands: { paint: paintCommand },
}), 'batch');

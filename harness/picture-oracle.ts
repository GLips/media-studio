// picture-oracle.ts (`npm run picture:oracle -- <project> <frames> [--keep <dir>]`): a project's frames read back as a
// render sends them, held against Remotion's screenshot of the same page (lib/output/render/engine/picture-oracle.ts).
// Prints each frame's largest channel difference, the px past 4, and where the largest lies.
import { defineCommand } from 'citty';
import { mkdirSync } from 'node:fs';
import { openStudioRenderSession } from '../cli/project-arg.ts';
import { comparePictureToScreenshots } from '#lib/output/render/engine/picture-oracle.ts';
import { runHarnessCommand } from './run-harness-command.ts';

/** Frames as `a:b` (inclusive) or a list, `100,140,200`. */
const framesOf = (text: string) => (text.includes(':')
  ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(text.split(':').map(Number))
  : text.split(',').map(Number));

const command = defineCommand({
  meta: { name: 'picture-oracle', description: "A project's frames as a render reads them back, against screenshots of the same page." },
  args: {
    project: { type: 'positional', required: true, description: 'Project slug, part of its name, or a path' },
    frames: { type: 'positional', required: true, description: 'Frames, 100:110 (inclusive) or 100,140,200' },
    keep: { type: 'string', description: 'A folder to write each frame\'s read, screenshot and difference (×8, red) in' },
  },
  async run({ args }) {
    if (args.keep) mkdirSync(args.keep, { recursive: true });
    const session = await openStudioRenderSession(args.project);
    const compared = await comparePictureToScreenshots(session, framesOf(args.frames), { ...(args.keep && { keep: args.keep }) });
    for (const { frame, max, over4, mean, at } of compared) process.stdout.write(`frame ${frame}: max ${max}, ${over4} px past 4, mean ${mean.toFixed(3)}, largest at ${at.x},${at.y}\n`);
  },
});

await runHarnessCommand(command, 'batch');

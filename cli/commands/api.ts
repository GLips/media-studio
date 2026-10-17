// studio api: the reference for what a project imports, read from the code (lib/platform/scaffold/engine/studio-api-reference.ts).
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'api',
    description: "Print what a project imports: #studio for scenes, the storyboard models for storyboard.ts; or one export's signature and doc.",
    about: "Read from the code. With no name, every export under the specifier it's imported by and its file, with its doc's first sentence; with a name, its import line, full signature and doc comment.",
  },
  args: {
    name: { type: 'positional', required: false, description: 'An export, e.g. fitTake' },
  },
  async run({ args }) {
    const { findStudioApiExport, formatStudioApiExport, formatStudioApiIndex, readStudioApiExports } = await import('#lib/platform/scaffold/engine/studio-api-reference.ts');
    const exports = readStudioApiExports();
    console.log(args.name ? formatStudioApiExport(findStudioApiExport(exports, args.name)) : formatStudioApiIndex(exports));
  },
});

// studio api: the reference for what a video.tsx can import, read from lib/studio/api.ts (lib/engine/project/studio-api-reference.ts).
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'api',
    description: "What lib/studio/api.ts exports, read from the code: with no name, every export under its file with its doc's first sentence; with a name, its full signature and doc comment.",
  },
  args: {
    name: { type: 'positional', required: false, description: 'An export, e.g. fitTake' },
  },
  async run({ args }) {
    const { findStudioApiExport, formatStudioApiExport, formatStudioApiIndex, readStudioApiExports } = await import('../../lib/engine/project/studio-api-reference.ts');
    const exports = readStudioApiExports();
    console.log(args.name ? formatStudioApiExport(findStudioApiExport(exports, args.name)) : formatStudioApiIndex(exports));
  },
});

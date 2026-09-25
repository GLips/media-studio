// studio capture: films the shots the project's capture.ts defines (lib/engine/capture/capture.ts).
import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'capture',
    description: "Film the project's shots with its capture.ts: stills (screenshots with the rects scenes point at) and takes (screen recordings with marks). Rebuilds captures/index.ts from every shot captured so far, deleting shots capture.ts no longer makes. Prints captures/index.ts.",
  },
  args: {
    project: studioProjectArg,
    only: { type: 'string', valueHint: 'a,b', description: 'Redo just these shots; the rest keep their last capture' },
  },
  async run({ args }) {
    const { basename } = await import('node:path');
    const { resolveStudioProjectWith } = await import('../../lib/engine/project/studio-project.ts');
    const { captureStudioProject } = await import('../../lib/engine/capture/capture.ts');
    const project = resolveStudioProjectWith(args.project, 'capture.ts');
    const { index, uncaptured } = await captureStudioProject(project, { only: args.only?.split(',') });
    if (uncaptured.length) {
      console.error(`captures/index.ts leaves out ${uncaptured.map((u) => `${u.name} (${u.reason})`).join(', ')}: studio capture ${basename(project)} --only=${uncaptured.map((u) => u.name).join(',')}`);
    }
    console.log(index);
  },
});

// studio capture: films the shots the project's capture.ts defines (lib/capture.ts).
import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'capture',
    description: "Film the project's shots with its capture.ts: stills (screenshots with the rects scenes point at) and takes (screen recordings with marks). Prints captures/index.ts.",
  },
  args: {
    project: studioProjectArg,
    only: { type: 'string', valueHint: 'a,b', description: 'Redo just these shots; the rest keep their last capture' },
  },
  async run({ args }) {
    const { basename } = await import('node:path');
    const { resolveStudioProjectWith } = await import('../../lib/studio-project.ts');
    const { captureStudioProject, ShotsNeedCapturingError } = await import('../../lib/capture.ts');
    const project = resolveStudioProjectWith(args.project, 'capture.ts');
    try {
      console.log(await captureStudioProject(project, { only: args.only?.split(',') }));
    } catch (error) {
      if (!(error instanceof ShotsNeedCapturingError)) throw error;
      throw new Error(`${error.message}; redo them with studio capture ${basename(project)} --only=${error.shots.join(',')}`);
    }
  },
});

// studio preview: the Remotion Studio on one project.
import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'preview',
    description: 'Open the Remotion Studio on the project: scrub it, see scenes and voice lines on the timeline, toggle captions in the props panel. The project\'s stills are there too, a folder per design. Arguments after -- go to `remotion studio` (e.g. -- --port=3001).',
  },
  args: {
    project: studioProjectArg,
  },
  async run({ args }) {
    // Everything after `--` lands in args._ behind the project.
    const passThrough = args._.slice(1);
    const { spawn } = await import('node:child_process');
    const { join } = await import('node:path');
    const { resolveStudioProject, STUDIO_ROOT } = await import('#engine/project/studio-project.ts');
    const project = resolveStudioProject(args.project);
    // remotion.config.ts reads PROJECT, and the Studio finds that config in its working directory.
    const remotion = join(STUDIO_ROOT, 'node_modules', '.bin', 'remotion');
    const child = spawn(remotion, ['studio', ...passThrough], { cwd: STUDIO_ROOT, stdio: 'inherit', env: { ...process.env, PROJECT: project } });
    // code is null when a signal killed it, which is a failure too.
    process.exitCode = await new Promise<number>((done) => child.on('exit', (code) => done(code ?? 1)));
  },
});

// studio workspace: work/, the git repository your own projects and brand kits live in. See lib/engine/project/studio-workspace.ts.
import { defineCommand } from 'citty';

const initWorkspaceCommand = defineCommand({
  meta: {
    name: 'init',
    description: 'Make work/ your workspace, or complete it: work/projects and work/brands, its own git repository (the studio\'s ignores it) whose commits run check:arch, the typecheck and its projects\' tests, its .gitignore, arch-baseline.json and hosts.json. Keeps whatever is already there.',
  },
  async run() {
    const { initStudioWorkspace } = await import('#engine/project/studio-workspace.ts');
    const done = initStudioWorkspace();
    console.error(done.length ? done.map((line) => `workspace: ${line}`).join('\n') : 'workspace: work/ is already complete');
  },
});

export default defineCommand({
  meta: { name: 'workspace', description: 'work/, the git repository of your own projects, brand kits and hosts' },
  subCommands: { init: initWorkspaceCommand },
});

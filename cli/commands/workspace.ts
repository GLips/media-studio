// studio workspace: work/, the git repository your own projects and brand kits live in. See lib/platform/project/engine/studio-workspace.ts.
import { defineCommand } from 'citty';
import { refuseOptionsBeforeSubcommand } from '../command-flags.ts';

const initWorkspaceCommand = defineCommand({
  meta: {
    name: 'init',
    description: "Make work/ your workspace, or complete it, keeping whatever is already there.",
    about: "Makes work/projects and work/brands, its own git repository (the studio's ignores it) whose commits run check:arch, lint, the typecheck and its projects' tests, its .gitignore, arch-baseline.json and hosts.json.",
  },
  async run() {
    const { initStudioWorkspace } = await import('#lib/platform/project/engine/studio-workspace.ts');
    const done = initStudioWorkspace();
    console.error(done.length ? done.map((line) => `workspace: ${line}`).join('\n') : 'workspace: work/ is already complete');
  },
});

const seedWorkspaceCommand = defineCommand({
  meta: {
    name: 'seed',
    description: "Give this checkout's work/ worktree clones of the main workspace checkout's made, gitignored files.",
    about: "Clones (APFS clones, no disk until written) every gitignored path in the main work/ checkout that this worktree lacks: captures, music, audio, generated assets, brush packs, fonts, library media. Render outputs (out/), gate candidates and tool caches stay behind, as does anything in a folder this worktree doesn't hold. Git runs it when it makes a work/ worktree (.githooks-workspace/post-checkout); run it by hand for a worktree made before that, or after the main checkout re-captures.",
  },
  async run() {
    const { STUDIO_WORKSPACE_DIR } = await import('#lib/platform/project/engine/studio-project.ts');
    const { seedWorkspaceWorktree } = await import('#lib/platform/project/engine/workspace-seed.ts');
    const plan = seedWorkspaceWorktree(STUDIO_WORKSPACE_DIR);
    if (!plan) return console.error('workspace: work/ is the main checkout; there is nothing to seed it from');
    console.error(plan.clone.length ? `workspace: cloned ${plan.clone.join(', ')}` : 'workspace: nothing to clone; this worktree has every made file the main checkout has');
  },
});

export default defineCommand({
  meta: {
    name: 'workspace',
    description: "Set up work/, the private git repository of your projects, brand kits, styles and hosts.",
  },
  setup: refuseOptionsBeforeSubcommand,
  subCommands: { init: initWorkspaceCommand, seed: seedWorkspaceCommand },
});

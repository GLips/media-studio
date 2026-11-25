// workspace-seed.ts: gives a work/ worktree clones of the main workspace checkout's gitignored, made files (captures,
// music fits, voice manifests, generated assets, imported brush packs, fonts, the library's media), so its typecheck,
// lint and tests read what the main checkout's do. .githooks-workspace/post-checkout runs it when git makes a
// worktree; `studio workspace seed` runs it by hand. The plan is lib/platform/project/models/workspace-seed-plan.ts.
//
// Clones, not links: APFS clones cost no disk until written, and a worktree that re-captures or re-renders writes its
// own copy, never the main checkout's. Node builtins only: the hook may run before the worktree has node_modules.
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isolatedGitEnv } from '#lib/platform/git/engine/fixture-git.ts';
import { planWorkspaceSeed, type WorkspaceSeedPlan } from '#lib/platform/project/models/workspace-seed-plan.ts';

const git = (cwd: string, args: readonly string[]) => execFileSync('git', args, { cwd, env: isolatedGitEnv(), encoding: 'utf8' });

/** Whether anything is at `path`, a dangling link included. */
const present = (path: string) => lstatSync(path, { throwIfNoEntry: false }) !== undefined;

/** The repository's main worktree, the checkout its other worktrees were made from: git lists it first. */
function mainWorktreeOf(worktree: string): string {
  const first = git(worktree, ['worktree', 'list', '--porcelain']).split('\n').find((line) => line.startsWith('worktree '));
  if (!first) throw new Error(`git lists no worktree for ${worktree}`);
  return first.slice('worktree '.length);
}

/**
 * A clone where the filesystem makes one (APFS's clonefile, through cp -c), else a copy: cp -c is refused off APFS
 * and by GNU cp.
 */
function cloneInto(from: string, to: string): void {
  if (spawnSync('cp', ['-c', '-R', from, to], { stdio: 'ignore' }).status === 0) return;
  rmSync(to, { recursive: true, force: true });
  execFileSync('cp', ['-R', from, to]);
}

/**
 * Seeds the work/ worktree at `worktree` from its repository's main checkout and returns what it did; null when
 * `worktree` is the main checkout itself.
 */
export function seedWorkspaceWorktree(worktree: string): WorkspaceSeedPlan | null {
  const target = resolve(git(worktree, ['rev-parse', '--show-toplevel']).trim());
  const main = resolve(mainWorktreeOf(target));
  if (main === target) return null;
  const ignored = git(main, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']).split('\0');
  const plan = planWorkspaceSeed(ignored, (path) => present(join(target, path)));
  for (const path of plan.clone) cloneInto(join(main, path), join(target, path));
  return plan;
}

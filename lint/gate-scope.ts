// ─── A gate's scope: the repository it judges, where it mounts, its baseline ──
//
// check:arch and lint each judge the one scope `--scope` names; named none, they run each scope there is
// (gate-every-scope.ts). `public` is the studio's repository, what a clean clone holds;
// `workspace` is work/, your projects, mounted at `work/` in the studio's path space. Either is read in this
// process's git environment, a hook's when one runs the gate. Each scope keeps one baseline file holding both
// tiers' entries (lint/baseline.ts), read from the snapshot the gate judges: under a hook, an edit to it counts once
// it's staged.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isolatedGitEnv } from '#lib/platform/git/engine/fixture-git.ts';
import { STUDIO_WORKSPACE_MOUNT } from './policy/studio-tree.ts';
import { parseBaseline, rebaselineTier, type Baseline, type BaselineTier } from './baseline.ts';
import { parseLiveSnapshot, readSnapshotText, type CandidateSnapshot, type LiveSnapshot, type MountedSnapshot } from './candidate-snapshot.ts';
import type { Finding } from './structural/check-context.ts';

export type GateScope = 'public' | 'workspace';

/** A gate's `--scope` argument. */
export function parseGateScope(argument: string): GateScope {
  if (argument !== 'public' && argument !== 'workspace') throw new Error(`--scope is public or workspace, not ${argument}`);
  return argument;
}

const SCOPE_MOUNT: Readonly<Record<GateScope, string>> = { public: '', workspace: STUDIO_WORKSPACE_MOUNT };
/** Each scope's baseline, relative to its own repository. */
const SCOPE_BASELINE: Readonly<Record<GateScope, string>> = { public: 'lint/arch-baseline.json', workspace: 'arch-baseline.json' };

export type GateRepository = MountedSnapshot & { scope: GateScope };

/** The repository a scope judges, at `snapshot`, in this process's git environment. */
export function gateRepository(root: string, scope: GateScope, snapshot: CandidateSnapshot): GateRepository {
  const mount = SCOPE_MOUNT[scope];
  const repository: GateRepository = { scope, root: mount ? join(root, mount) : root, mount, snapshot, gitEnv: process.env };
  if (scope === 'workspace') assertOwnWorkspaceRepository(repository);
  return repository;
}

/**
 * work/ must be a repository of its own, and the one this process's git environment names: a folder inside the
 * studio's repository, or a hook's GIT_DIR pointing elsewhere, would read the wrong index as the workspace's.
 */
function assertOwnWorkspaceRepository({ root, gitEnv }: GateRepository): void {
  const revParse = (env: NodeJS.ProcessEnv, what: string) =>
    realpathSync(execFileSync('git', ['rev-parse', what], { cwd: root, env, encoding: 'utf8' }).trim());
  if (!existsSync(root) || revParse(isolatedGitEnv(), '--show-toplevel') !== realpathSync(root)) {
    throw new Error(`${root} isn't a repository of its own: run \`studio workspace init\``);
  }
  const own = revParse(isolatedGitEnv(), '--absolute-git-dir'), read = revParse(gitEnv, '--absolute-git-dir');
  if (read !== own) throw new Error(`git reads ${read} for ${root}, not its own ${own}: this process's GIT_DIR names another repository`);
}

/** The scope's baseline file, relative to the studio's root. */
export const gateBaselineFile = (scope: GateScope) => (SCOPE_MOUNT[scope] ? `${SCOPE_MOUNT[scope]}/` : '') + SCOPE_BASELINE[scope];

/** The baseline the repository's snapshot holds, or nothing excused where it holds none. */
export const readGateBaseline = (repo: GateRepository): Baseline => parseBaseline(readSnapshotText(repo, SCOPE_BASELINE[repo.scope]));

/**
 * The snapshot one run of a gate reads: `--snapshot`'s, else the working tree. `--update-baseline` reads only the
 * index, which the hook judges: a baseline excuses what a commit holds, and counting an untracked or unstaged source
 * would excuse what no commit holds, a new project's violations among them.
 */
export function gateRunSnapshot(argument: string | undefined, updateBaseline: boolean): LiveSnapshot {
  const snapshot = parseLiveSnapshot(argument ?? (updateBaseline ? 'index' : 'worktree'));
  if (updateBaseline && snapshot.kind !== 'index') {
    throw new Error('--update-baseline counts the index, what the hook judges: stage what the baseline should excuse, and leave out --snapshot worktree');
  }
  return snapshot;
}

/**
 * Rewrites one tier's entries in the scope's baseline file on disk to `findings`, keeping the other tier's as the
 * file has them, a rewrite not yet staged included. Returns the file, relative to the studio's root.
 */
export function rewriteGateBaseline(root: string, scope: GateScope, tier: BaselineTier, findings: readonly Finding[]): string {
  const file = gateBaselineFile(scope), path = join(root, file);
  const onDisk = parseBaseline(existsSync(path) ? readFileSync(path, 'utf8') : undefined);
  writeFileSync(path, `${JSON.stringify(rebaselineTier(onDisk, tier, findings), null, 2)}\n`);
  return file;
}

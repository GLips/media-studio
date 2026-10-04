// ─── A gate's scope: the repository it judges, where it mounts, its baseline ──
//
// check:arch and lint each judge one scope. `public` is the studio's repository, what a clean clone holds;
// `workspace` is work/, your projects, mounted at `work/` in the studio's path space. Either is read in this
// process's git environment, a hook's when one runs the gate. Each scope keeps one baseline file holding both
// tiers' entries (lint/baseline.ts), read from the snapshot the gate judges: under a hook, an edit to it counts once
// it's staged.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  return { scope, root: mount ? join(root, mount) : root, mount, snapshot, gitEnv: process.env };
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

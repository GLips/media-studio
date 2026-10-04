// ─── A gate run by hand with no --scope: every scope there is ─────────
//
// check:arch and lint each judge one scope (lint/gate-scope.ts), and each hook names its own. Run by hand with no
// `--scope`, a gate judges the studio and, when work/ is a workspace, work/ too, so a project is judged by hand as its
// commit will be. Each scope runs as its own process, the `--scope` run its hook makes, but over the snapshot the hand
// run names (the working tree unless `--snapshot index`) and outside any hook's git environment. The two run side by
// side; their reports print once both are done, the studio's first.

import { spawn } from 'node:child_process';
import { isolatedGitEnv } from '#lib/platform/git/engine/fixture-git.ts';
import { gateBaselineFile, workspaceRepositoryProblem, type GateScope } from './gate-scope.ts';

const SCOPE_NAME: Readonly<Record<GateScope, string>> = { public: 'the studio', workspace: 'work/' };

/**
 * Runs `script` once per scope the studio at `root` has, `--scope` added to `args`, and prints what each judged.
 * Returns whether every scope passed. A run with no scope is a hand run, so each reads its repository as git finds it
 * from its own folder: a hook's GIT_DIR names the studio's, and would be read as work/'s.
 */
export async function judgeEveryGateScope(root: string, gate: 'check:arch' | 'lint', script: string, args: readonly string[]): Promise<boolean> {
  const workspaceProblem = workspaceRepositoryProblem(root);
  const scopes: GateScope[] = workspaceProblem ? ['public'] : ['public', 'workspace'];
  console.log(workspaceProblem
    ? `${gate} judges the studio alone, against ${gateBaselineFile('public')}: ${workspaceProblem}.\n`
    : `${gate} judges the studio and work/, each against its own baseline (${scopes.map(gateBaselineFile).join(', ')}).\n`);
  const runs = await Promise.all(scopes.map((scope) => runGateScope(root, script, args, scope)));
  for (const { scope, output } of runs) console.log(`── ${SCOPE_NAME[scope]} (--scope ${scope}) ──\n${output.trimEnd()}\n`);
  console.log(`${gate}: ${runs.map(({ scope, passed }) => `${SCOPE_NAME[scope]} ${passed ? 'passed' : 'failed'}`).join(', ')}.`);
  return runs.every((run) => run.passed);
}

type GateScopeRun = { scope: GateScope; output: string; passed: boolean };

/** One scope's run: everything it printed, stdout and stderr in the order they came, and whether it exited 0. */
function runGateScope(root: string, script: string, args: readonly string[], scope: GateScope): Promise<GateScopeRun> {
  return new Promise((resolve, reject) => {
    const command = [...process.execArgv, script, ...args, '--scope', scope];
    const child = spawn(process.execPath, command, { cwd: root, env: isolatedGitEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ scope, output: Buffer.concat(chunks).toString('utf8'), passed: code === 0 }));
  });
}

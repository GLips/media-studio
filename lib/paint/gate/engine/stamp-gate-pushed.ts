// stamp-gate-pushed.ts: the gate as pre-push runs it: on each pushed commit's own tree, not the working tree, and only
// when a path the push carries reaches it. The commit is written out to a scratch folder, and that tree's own gate, in
// a process of its own, decides whether a pushed path reaches it and runs it there. One deadline covers each commit.
//
// Pre-push rather than pre-commit: the GPU gate takes minutes and paints on the one adapter every session shares, so
// it runs once per push, not once per commit.

import { execFileSync, spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';

/**
 * The most the gate may take on one pushed commit, from writing out its tree to its last comparison. It catches a hung
 * gate, not a slow one: another session rendering slows the GPU gate well past a minute.
 */
export const STAMP_GATE_PUSHED_TIMEOUT_MS = 300_000;

const NO_COMMIT = /^0+$/;

/**
 * The commits pre-push's stdin names (`<local ref> <local sha> <remote ref> <remote sha>` per line), each with the
 * paths it carries that no remote has yet. A deleted ref carries nothing.
 */
export function stampGatePushedCommits(root: string, prePushInput: string): { sha: string; paths: string[] }[] {
  const shas = new Set(prePushInput.split('\n').map((line) => line.trim().split(/\s+/)[1]).filter((sha) => sha && !NO_COMMIT.test(sha)));
  return [...shas].map((sha) => ({
    sha,
    paths: execFileSync('git', ['log', '--format=', '--name-only', '--no-renames', '-z', sha, '--not', '--remotes'], { cwd: root, encoding: 'utf8' })
      .split('\0').filter(Boolean),
  }));
}

/** Writes out commit `sha` of the repository at `root` and runs that tree's `tree` verb on it, handing it `paths`. */
export function runPushedStampGate(root: string, sha: string, paths: readonly string[]): { passed: boolean; seconds: number } {
  const started = performance.now();
  const remaining = () => Math.max(1, Math.ceil(STAMP_GATE_PUSHED_TIMEOUT_MS - (performance.now() - started)));
  return withStudioTemp('stamp-gate', (scratch) => {
    try {
      const tree = execFileSync('git', ['archive', '--format=tar', sha], { cwd: root, maxBuffer: 1 << 30, timeout: remaining() });
      execFileSync('tar', ['-x', '-C', scratch], { input: tree, timeout: remaining() });
      symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'));
      // The child is the gate on the pushed tree, not a git hook: git's variables would point it at this repository.
      const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
      const run = spawnSync(process.execPath, ['harness/stamp-paint-gate.ts', 'tree'], {
        cwd: scratch, env, input: paths.join('\0'), stdio: ['pipe', 'inherit', 'inherit'], timeout: remaining(), killSignal: 'SIGKILL',
      });
      if (run.error && 'code' in run.error && run.error.code === 'ETIMEDOUT') {
        process.stderr.write(`stamp gate: timed out after ${STAMP_GATE_PUSHED_TIMEOUT_MS / 1000} s\n`);
      }
      return { passed: run.status === 0, seconds: (performance.now() - started) / 1000 };
    } finally {
      // A killed gate leaves its browser running: puppeteer starts it in a process group of its own. It was launched
      // from the scratch tree's node_modules, so its command line names the scratch folder, and its helpers die with it.
      spawnSync('pkill', ['-KILL', '-f', scratch]);
    }
  });
}

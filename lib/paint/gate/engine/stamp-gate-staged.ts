// stamp-gate-staged.ts: the gate as pre-commit runs it: on what's staged, not the working tree, so a partial commit is
// checked as it will land. The index is written out to a scratch folder (under GIT_INDEX_FILE when git commits a
// path list or a patch through a temporary index), and the staged tree's own gate, in a process of its own, decides
// whether a staged path reaches it and runs it there. One deadline covers the whole of it.

import { execFileSync, spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';

/**
 * The most the gate may take in pre-commit, from reading the index to its last comparison. It catches a hung gate,
 * not a slow one: another session rendering slows the GPU gate well past a minute.
 */
export const STAMP_GATE_STAGED_TIMEOUT_MS = 300_000;

/**
 * Writes out the index of the repository at `root` and runs the staged tree's `staged-tree` verb on it, handing it the
 * staged paths; whether it passed, and how long it took. Must run while git's environment is still set, since a
 * partial commit stages into its own index.
 */
export function runStagedStampGate(root: string): { passed: boolean; seconds: number } {
  const started = performance.now();
  const remaining = () => Math.max(1, Math.ceil(STAMP_GATE_STAGED_TIMEOUT_MS - (performance.now() - started)));
  const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--no-renames', '-z'], { cwd: root, encoding: 'utf8', timeout: remaining() });
  return withStudioTemp('stamp-gate', (scratch) => {
    try {
      execFileSync('git', ['checkout-index', '--all', `--prefix=${scratch}/`], { cwd: root, timeout: remaining() });
      symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'));
      // The child is the gate on the staged tree, not a git hook: git's variables would point it at this repository.
      const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
      const run = spawnSync(process.execPath, ['harness/stamp-paint-gate.ts', 'staged-tree'], {
        cwd: scratch, env, input: staged, stdio: ['pipe', 'inherit', 'inherit'], timeout: remaining(), killSignal: 'SIGKILL',
      });
      if (run.error && 'code' in run.error && run.error.code === 'ETIMEDOUT') {
        process.stderr.write(`stamp gate: timed out after ${STAMP_GATE_STAGED_TIMEOUT_MS / 1000} s\n`);
      }
      return { passed: run.status === 0, seconds: (performance.now() - started) / 1000 };
    } finally {
      // A killed gate leaves its browser running: puppeteer starts it in a process group of its own. It was launched
      // from the scratch tree's node_modules, so its command line names the scratch folder, and its helpers die with it.
      spawnSync('pkill', ['-KILL', '-f', scratch]);
    }
  });
}

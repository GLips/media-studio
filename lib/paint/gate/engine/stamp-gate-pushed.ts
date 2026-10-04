// stamp-gate-pushed.ts: the gate as pre-push runs it: on each pushed commit's own tree, not the working tree, and only
// when a path the push carries reaches it. The commit is written out to a scratch folder, and that tree's own gate, in
// a process of its own, decides whether a pushed path reaches it; one that does waits for the whole GPU lease
// (lib/platform/gpu/engine/gpu-lease.ts), then runs. Its deadline starts once it holds the GPU, so a queue never
// times it out.
//
// Pre-push rather than pre-commit: the GPU gate takes minutes and paints on the one adapter every session shares, so
// it runs once per push, not once per commit.

import { execFileSync, spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { acquireStudioGpuLease } from '#lib/platform/gpu/engine/gpu-lease.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { stampGateImportedFiles, stampGateReachedBy } from './stamp-gate-reach.ts';
import { STAMP_GATE_PUBLIC_STORE } from './stamp-gate-store.ts';
import { runStampGate, STAMP_GATE_PAGE, type StampGateCheck } from './stamp-gate.ts';

/**
 * The most the gate may take on one pushed commit once it holds the GPU, to its last comparison; and the most writing
 * out the commit may take. It catches a hung gate, not a slow one.
 */
export const STAMP_GATE_PUSHED_TIMEOUT_MS = 300_000;

/**
 * The most one pushed commit's gate may take as a whole, its queue for the GPU too: a backstop for a gate hung where its
 * own deadline can't fire (a synchronous loop), set far past any queue pre-push should meet.
 */
const STAMP_GATE_PUSHED_BACKSTOP_MS = 2 * 60 * 60_000;

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
  return withStudioTemp('stamp-gate', (scratch) => {
    try {
      const tree = execFileSync('git', ['archive', '--format=tar', sha], { cwd: root, maxBuffer: 1 << 30, timeout: STAMP_GATE_PUSHED_TIMEOUT_MS });
      execFileSync('tar', ['-x', '-C', scratch], { input: tree, timeout: STAMP_GATE_PUSHED_TIMEOUT_MS });
      symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'));
      // The child is the gate on the pushed tree, not a git hook: git's variables would point it at this repository.
      const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
      const run = spawnSync(process.execPath, ['harness/stamp-paint-gate.ts', 'tree'], {
        cwd: scratch, env, input: paths.join('\0'), stdio: ['pipe', 'inherit', 'inherit'], timeout: STAMP_GATE_PUSHED_BACKSTOP_MS, killSignal: 'SIGKILL',
      });
      if (run.error && 'code' in run.error && run.error.code === 'ETIMEDOUT') {
        process.stderr.write(`stamp gate: killed after ${STAMP_GATE_PUSHED_BACKSTOP_MS / 60_000} min, its queue for the GPU included, without its deadline firing\n`);
      }
      return { passed: run.status === 0, seconds: (performance.now() - started) / 1000 };
    } finally {
      // A killed gate leaves its browser running: puppeteer starts it in a process group of its own. It was launched
      // from the scratch tree's node_modules, so its command line names the scratch folder, and its helpers die with it.
      spawnSync('pkill', ['-KILL', '-f', scratch]);
    }
  });
}

/**
 * The gate on the pushed tree at `root`, as its `tree` verb runs it, given the paths the push carries: null when none
 * reaches the gate; else, once this process holds the whole GPU, its checks, the paths that reached it and its seconds
 * with the GPU. Past STAMP_GATE_PUSHED_TIMEOUT_MS it ends the process, failing.
 */
export async function runStampGateOnPushedTree(root: string, carried: readonly string[]): Promise<{ checks: StampGateCheck[]; reached: string[]; seconds: number } | null> {
  const reached = stampGateReachedBy(carried, await stampGateImportedFiles(root, STAMP_GATE_PAGE));
  if (!reached.length) return null;
  await acquireStudioGpuLease();
  const started = performance.now();
  // A hung gate awaits a page that never answers, so it never returns: the timer ends it, and pushed's pkill its browser.
  const deadline = setTimeout(() => {
    process.stderr.write(`stamp gate: timed out after ${STAMP_GATE_PUSHED_TIMEOUT_MS / 1000} s with the GPU its own\n`);
    process.exit(1);
  }, STAMP_GATE_PUSHED_TIMEOUT_MS);
  try {
    return { checks: await runStampGate(STAMP_GATE_PUBLIC_STORE), reached, seconds: (performance.now() - started) / 1000 };
  } finally {
    clearTimeout(deadline);
  }
}

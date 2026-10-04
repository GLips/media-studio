// ─── The studio's temp space: one root per process, removed however it ends ───
//
// Every temp folder the studio makes lives under <tmpdir>/media-studio/<pid>-<started>/, named by its process's
// identity (lib/platform/process). The root is made on first use and removed on exit, SIGINT and SIGTERM; a step's own
// folder (withStudioTemp) goes in a finally, so a step that throws leaves nothing even in a long-lived server. A kill -9
// can't be caught, so making a root first sweeps its siblings whose process no longer runs. The structural check
// studio-temp refuses mkdtempSync and tmpdir() anywhere else, so this is the only way in.
//
// Negative space: Remotion's own remotion-v4.*-assets* folders sit in the temp dir beside this root, not under it;
// they're Remotion's to clean.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseStudioProcessName, runningStudioProcesses, studioProcessName, thisStudioProcess } from '#lib/platform/process/engine/studio-process.ts';

/** Where every studio process keeps its root, one folder per process. */
const STUDIO_TEMP_HOME = join(tmpdir(), 'media-studio');

let processRoot: string | undefined;

/**
 * This process's temp root, made (and its dead siblings swept) on first call. A folder made directly in it lives
 * until the process ends; a step's folder should come from withStudioTemp instead, so it goes when the step does.
 */
export function studioTempRoot(): string {
  if (processRoot) return processRoot;
  sweepDeadStudioTempRoots();
  const root = join(STUDIO_TEMP_HOME, studioProcessName(thisStudioProcess()));
  mkdirSync(root, { recursive: true });
  const remove = () => rmSync(root, { recursive: true, force: true });
  process.once('exit', remove);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      remove();
      // A listener replaces the default of dying by the signal, so with no other listener, die by it as before.
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    });
  }
  processRoot = root;
  return root;
}

/**
 * Runs `step` with a fresh folder under the process root, named `<prefix>-…`, and removes it however `step` ends: when
 * it returns or throws, or, for an async step, when its promise settles. Returns what `step` does.
 */
export function withStudioTemp<T>(prefix: string, step: (dir: string) => T): T {
  const dir = mkdtempSync(join(studioTempRoot(), `${prefix}-`));
  const remove = () => rmSync(dir, { recursive: true, force: true });
  let result: T;
  try {
    result = step(dir);
  } catch (error) {
    remove();
    throw error;
  }
  if (result instanceof Promise) return result.finally(remove) as T;
  remove();
  return result;
}

/**
 * Removes every other process's root whose process no longer runs: what a crash or kill -9 left behind. A folder not
 * named by a process's identity isn't a root, and is left alone.
 */
function sweepDeadStudioTempRoots() {
  if (!existsSync(STUDIO_TEMP_HOME)) return;
  const mine = studioProcessName(thisStudioProcess());
  const roots = readdirSync(STUDIO_TEMP_HOME).flatMap((name) => {
    const identity = parseStudioProcessName(name);
    return identity && name !== mine ? [{ ...identity, name }] : [];
  });
  const running = new Set(runningStudioProcesses(roots).map(({ name }) => name));
  for (const { name } of roots) if (!running.has(name)) rmSync(join(STUDIO_TEMP_HOME, name), { recursive: true, force: true });
}

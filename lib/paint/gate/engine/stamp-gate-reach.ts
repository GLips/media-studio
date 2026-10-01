// stamp-gate-reach.ts: which files the GPU gate's outcome depends on, so pre-commit runs it exactly when a staged path
// is one of them. Read off the import graph by the bundler the gate's page is built with, so the set can't drift
// from the code the way a listed set does.

import { relative } from 'node:path';
import { bundledSourceFiles } from '#lib/platform/browser/engine/browser-module-page.ts';

/**
 * What the gate reads besides its imports: its accepted fixtures, the packages it runs on, and the hook that calls it.
 * A path is matched as a prefix when it ends in a slash, else whole.
 */
const STAMP_GATE_READ_PATHS = ['harness/fixtures/stamp-paint/', 'package.json', 'package-lock.json', '.githooks/pre-commit'];

/** Every file under `root` the gate's CLI (for Node) and page (for the browser) import, as repository paths. */
export async function stampGateImportedFiles(root: string, page: string): Promise<Set<string>> {
  const [cli, browser] = await Promise.all([
    bundledSourceFiles(root, 'harness/stamp-paint-gate.ts', 'node'),
    bundledSourceFiles(root, relative(root, page), 'browser'),
  ]);
  return new Set([...cli, ...browser]);
}

/** The staged paths the gate depends on: those it imports, or reads. */
export const stampGateReachedBy = (staged: readonly string[], imported: ReadonlySet<string>) =>
  staged.filter((path) => imported.has(path) || STAMP_GATE_READ_PATHS.some((read) => (read.endsWith('/') ? path.startsWith(read) : path === read)));

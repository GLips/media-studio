// A throwaway git repo for a check's spec: the files are written and staged, and the check reads the index, as
// check:arch does. Checks are looked up through the registry, so a spec fails for a check nobody registered.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DeclaredShared } from '../policy/studio-tree.ts';
import { contextFor, studioScope, type Finding } from './check-context.ts';
import { STRUCTURAL_CHECKS } from './registry.ts';
import { loadSourceTree } from './source-tree.ts';

export function runCheckOnFiles(checkId: string, files: Record<string, string>, declaredShared: DeclaredShared = {}): Finding[] {
  const check = STRUCTURAL_CHECKS.find((candidate) => candidate.id === checkId);
  if (!check) throw new Error(`no registered check ${checkId}`);
  const root = mkdtempSync(join(tmpdir(), 'arch-spec-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    for (const [path, text] of Object.entries({ 'package.json': '{}', ...files })) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    execFileSync('git', ['add', '-A'], { cwd: root });
    const tree = loadSourceTree({ root, snapshot: { kind: 'index' }, scope: studioScope });
    return check.run(contextFor(tree, declaredShared));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** `path:key` per finding, sorted, for asserting which constructs a check caught. */
export const caught = (findings: readonly Finding[]) => findings.map((finding) => `${finding.path}:${finding.key}`).sort();

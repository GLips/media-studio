// A throwaway git repo for a check's spec: the files are written and staged, and the check reads the index, as
// check:arch does. Checks are looked up through the registry, so a spec fails for a check nobody registered.
//
// One repository holds the fixture's work/ too: the tree is one path space however many repositories feed it, so a
// check reads `work/projects/p/…` the same either way (arch-verdict.test.ts reads a real nested workspace).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isolatedGitEnv, runFixtureGit } from '#engine/git/fixture-git.ts';
import { withStudioTemp } from '#engine/temp/studio-temp.ts';
import { contextFor, studioScope, type Finding } from './check-context.ts';
import { STRUCTURAL_CHECKS } from './registry.ts';
import { loadSourceTree } from './source-tree.ts';

export function runCheckOnFiles(checkId: string, files: Record<string, string>): Finding[] {
  const check = STRUCTURAL_CHECKS.find((candidate) => candidate.id === checkId);
  if (!check) throw new Error(`no registered check ${checkId}`);
  return withStudioTemp('arch-spec', (root) => {
    runFixtureGit(root, ['init', '-q']);
    for (const [path, text] of Object.entries({ 'package.json': '{}', ...files })) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    runFixtureGit(root, ['add', '-A']);
    const tree = loadSourceTree({ repos: [{ root, mount: '', snapshot: { kind: 'index' }, gitEnv: isolatedGitEnv() }], scope: studioScope });
    return check.run(contextFor(tree));
  });
}

/** `path:key` per finding, sorted, for asserting which constructs a check caught. */
export const caught = (findings: readonly Finding[]) => findings.map((finding) => `${finding.path}:${finding.key}`).sort();

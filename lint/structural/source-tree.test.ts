import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { isolatedGitEnv, runFixtureGit } from '#lib/platform/git/engine/fixture-git.ts';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';
import type { CandidateSnapshot } from '../candidate-snapshot.ts';
import { loadSourceTree, type TreeScope } from './source-tree.ts';

const root = join(studioTempRoot(), 'source-tree');
mkdirSync(root);
const git = (...args: string[]) => runFixtureGit(root, args);
const write = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

git('init', '-q');
git('config', 'user.email', 'spec@example.com');
git('config', 'user.name', 'spec');
write('package.json', JSON.stringify({ imports: { '#studio': './lib/api.ts', '#lib/*': './lib/*' } }));
write('lib/api.ts', 'export const a = 1;\n');
write('lib/timing/timeline/models/clock.ts', 'export const c = 1;\n');
write('lib/timing/timeline/models/index.ts', 'export {};\n');
write('projects/p/video.tsx', [
  "import { a } from '#studio';",
  "import { a as b } from '../../lib/api.ts';",
  "import { c } from '#lib/timing/timeline/models/clock.ts';",
  "import '../../lib/timing/timeline/models';",
  "import { x } from '#nowhere';",
  "export { c as d } from '#lib/timing/timeline/models/clock.ts';",
].join('\n'));
write('odd/stray.ts', 'export {};\n');
git('add', '.');
git('commit', '-qm', 'base');

const scope: TreeScope = (path) => (path.startsWith('odd/') ? 'undeclared' : 'governed');
const load = (snapshot: CandidateSnapshot = { kind: 'index' }) =>
  loadSourceTree({ repos: [{ root, mount: '', snapshot, gitEnv: isolatedGitEnv() }], scope });

test('an alias and the relative spelling of one file resolve to the same canonical path, and a re-export keeps its edge', () => {
  const tree = load();
  const video = tree.sources.find((file) => file.path === 'projects/p/video.tsx')!;
  const targets = video.imports.map((i) => tree.resolveImport(video.path, i.specifier, i.names));
  assert.deepEqual(targets, [
    { kind: 'module', path: 'lib/api.ts', backed: true },
    { kind: 'module', path: 'lib/api.ts', backed: true },
    { kind: 'module', path: 'lib/timing/timeline/models/clock.ts', backed: true },
    // A directory import lands on its index, not on the directory.
    { kind: 'module', path: 'lib/timing/timeline/models/index.ts', backed: true },
    { kind: 'unresolved-alias', specifier: '#nowhere' },
    { kind: 'module', path: 'lib/timing/timeline/models/clock.ts', backed: true },
  ]);
});

test('a file outside the declared tree is reported, not dropped', () => {
  const tree = load();
  assert.deepEqual(tree.undeclared, ['odd/stray.ts']);
  assert.ok(!tree.sources.some((file) => file.path === 'odd/stray.ts'));
});

test('the index holds only what is staged; the working tree, its edits and untracked files too, and not what it deleted', () => {
  write('lib/api.ts', "import 'fs';\n");
  write('lib/untracked.ts', 'export {};\n');
  rmSync(join(root, 'lib/timing/timeline/models/index.ts'));
  const tree = load();
  assert.equal(tree.sources.find((file) => file.path === 'lib/api.ts')!.text, 'export const a = 1;\n');
  assert.ok(!tree.paths.has('lib/untracked.ts'));
  assert.ok(tree.paths.has('lib/timing/timeline/models/index.ts'));

  const worktree = load({ kind: 'worktree' });
  assert.equal(worktree.sources.find((file) => file.path === 'lib/api.ts')!.imports[0].specifier, 'fs');
  assert.ok(worktree.paths.has('lib/untracked.ts'));
  assert.ok(!worktree.paths.has('lib/timing/timeline/models/index.ts'));

  git('add', 'lib/api.ts');
  const staged = load();
  assert.equal(staged.sources.find((file) => file.path === 'lib/api.ts')!.imports[0].specifier, 'fs');
  const committed = load({ kind: 'commit', rev: 'HEAD' });
  assert.equal(committed.sources.find((file) => file.path === 'lib/api.ts')!.imports.length, 0);
});

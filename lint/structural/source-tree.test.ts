import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { isolatedGitEnv, runFixtureGit } from '../../lib/engine/git/fixture-git.ts';
import { loadSourceTree, type TreeScope } from './source-tree.ts';

const root = mkdtempSync(join(tmpdir(), 'source-tree-'));
after(() => rmSync(root, { recursive: true, force: true }));
const git = (...args: string[]) => runFixtureGit(root, args);
const write = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

git('init', '-q');
git('config', 'user.email', 'spec@example.com');
git('config', 'user.name', 'spec');
write('package.json', JSON.stringify({ imports: { '#studio': './lib/studio/api.ts', '#models/*': './lib/models/*' } }));
write('lib/studio/api.ts', 'export const a = 1;\n');
write('lib/models/timeline/clock.ts', 'export const c = 1;\n');
write('lib/models/timeline/index.ts', 'export {};\n');
write('projects/p/video.tsx', [
  "import { a } from '#studio';",
  "import { a as b } from '../../lib/studio/api.ts';",
  "import { c } from '#models/timeline/clock.ts';",
  "import '../../lib/models/timeline';",
  "import { x } from '#nowhere';",
  "export { c as d } from '#models/timeline/clock.ts';",
].join('\n'));
write('odd/stray.ts', 'export {};\n');
git('add', '.');
git('commit', '-qm', 'base');

const scope: TreeScope = (path) => (path.startsWith('odd/') ? 'undeclared' : 'governed');

test('an alias and the relative spelling of one file resolve to the same canonical path, and a re-export keeps its edge', () => {
  const tree = loadSourceTree({ root, snapshot: { kind: 'index' }, scope, gitEnv: isolatedGitEnv() });
  const video = tree.sources.find((file) => file.path === 'projects/p/video.tsx')!;
  const targets = video.imports.map((i) => tree.resolveImport(video.path, i.specifier, i.names));
  assert.deepEqual(targets, [
    { kind: 'module', path: 'lib/studio/api.ts', backed: true },
    { kind: 'module', path: 'lib/studio/api.ts', backed: true },
    { kind: 'module', path: 'lib/models/timeline/clock.ts', backed: true },
    // A directory import lands on its index, not on the directory.
    { kind: 'module', path: 'lib/models/timeline/index.ts', backed: true },
    { kind: 'unresolved-alias', specifier: '#nowhere' },
    { kind: 'module', path: 'lib/models/timeline/clock.ts', backed: true },
  ]);
});

test('a file outside the declared tree is reported, not dropped', () => {
  const tree = loadSourceTree({ root, snapshot: { kind: 'index' }, scope, gitEnv: isolatedGitEnv() });
  assert.deepEqual(tree.undeclared, ['odd/stray.ts']);
  assert.ok(!tree.sources.some((file) => file.path === 'odd/stray.ts'));
});

test('the index snapshot reads staged content, never the working tree', () => {
  write('lib/studio/api.ts', "import 'fs';\n");
  write('lib/studio/untracked.ts', 'export {};\n');
  const tree = loadSourceTree({ root, snapshot: { kind: 'index' }, scope, gitEnv: isolatedGitEnv() });
  assert.equal(tree.sources.find((file) => file.path === 'lib/studio/api.ts')!.text, 'export const a = 1;\n');
  assert.ok(!tree.paths.has('lib/studio/untracked.ts'));

  git('add', 'lib/studio/api.ts');
  const staged = loadSourceTree({ root, snapshot: { kind: 'index' }, scope, gitEnv: isolatedGitEnv() });
  assert.equal(staged.sources.find((file) => file.path === 'lib/studio/api.ts')!.imports[0].specifier, 'fs');
  const committed = loadSourceTree({ root, snapshot: { kind: 'commit', rev: 'HEAD' }, scope, gitEnv: isolatedGitEnv() });
  assert.equal(committed.sources.find((file) => file.path === 'lib/studio/api.ts')!.imports.length, 0);
});

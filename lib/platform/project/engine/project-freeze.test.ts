import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runFixtureGit } from '#lib/platform/git/engine/fixture-git.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { freezeRevision } from './project-freeze.ts';

test('a loose studio note is reported while the record pins both clean revisions', () => {
  withStudioTemp('freeze-revision', (root) => {
    const workspace = join(root, 'work');
    mkdirSync(workspace);
    writeFileSync(join(root, '.gitignore'), 'work/\n');
    const commits = [root, workspace].map((dir) => {
      runFixtureGit(dir, ['init', '-q']);
      runFixtureGit(dir, ['add', '.']);
      runFixtureGit(dir, ['-c', 'user.name=Fixture', '-c', 'user.email=test@invalid', 'commit', '--allow-empty', '-qm', 'Fixture']);
      return runFixtureGit(dir, ['rev-parse', 'HEAD']).trim();
    });
    writeFileSync(join(root, 'stray note.md'), '');
    const ignored = new Set<string>();
    const record = () => freezeRevision(root, workspace, ignored);
    assert.deepEqual(JSON.parse(record()), { engine: commits[0], workspace: commits[1] });
    assert.deepEqual([...ignored], ['stray note.md']);
    runFixtureGit(root, ['add', 'stray note.md']);
    assert.throws(record, /A  stray note.md/);
  });
});

test('untracked engine sources and package files block a pin', () => {
  withStudioTemp('freeze-inputs', (root) => {
    runFixtureGit(root, ['init', '-q']);
    mkdirSync(join(root, 'lib'));
    writeFileSync(join(root, 'lib', 'new.ts'), '');
    writeFileSync(join(root, 'package-lock.json'), '{}');
    assert.throws(() => freezeRevision(root, join(root, 'work'), new Set()), /\?\? lib\/new.ts\n\?\? package-lock.json/);
  });
});

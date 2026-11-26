import assert from 'node:assert/strict';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { isolatedGitEnv, runFixtureGit } from '#lib/platform/git/engine/fixture-git.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { listSnapshotPaths } from './candidate-snapshot.ts';

test('workspace checks follow the sidecar in the index or on disk when a freeze or thaw is partially staged', () => {
  withStudioTemp('freeze-index', (root) => {
    runFixtureGit(root, ['init', '-q']);
    const source = 'projects/probe/scene.ts', record = 'projects/probe/frozen.json';
    mkdirSync(join(root, 'projects/probe'), { recursive: true });
    writeFileSync(join(root, source), 'export {};');
    runFixtureGit(root, ['add', source]);
    const paths = (kind: 'index' | 'worktree') => listSnapshotPaths({ root, mount: 'work', snapshot: { kind }, gitEnv: isolatedGitEnv() });
    writeFileSync(join(root, record), JSON.stringify({ engine: 'a'.repeat(40), workspace: 'b'.repeat(40) }));
    assert.deepEqual(paths('worktree'), []);
    assert.deepEqual(paths('index'), [source]);
    runFixtureGit(root, ['add', record]);
    unlinkSync(join(root, record));
    assert.deepEqual(paths('index'), []);
    assert.deepEqual(paths('worktree'), [source]);
  });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planWorkspaceSeed } from './workspace-seed-plan.ts';

const holds = (...paths: string[]) => (path: string) => paths.includes(path);

test('a new worktree gets clones of what its projects import, beside the folders it holds', () => {
  const plan = planWorkspaceSeed(
    ['projects/a/captures/', 'projects/a/music/', 'styles/gouache/brushes/', 'generated/', 'library.local.json', 'projects/untracked/captures/'],
    holds('projects', 'projects/a', 'styles', 'styles/gouache'),
  );
  assert.deepEqual(plan.clone, ['generated', 'library.local.json', 'projects/a/captures', 'projects/a/music', 'styles/gouache/brushes']);
  assert.deepEqual(plan.skipped, [{ path: 'projects/untracked/captures', reason: 'its folder isn\'t in this checkout' }]);
});

test('render outputs and tool caches stay behind, and a cloned folder carries what git listed inside it', () => {
  const plan = planWorkspaceSeed(
    ['projects/a/out/', 'projects/a/tool/.venv/', 'projects/a/tool/.venv/bin/', 'styles/photoshop/', 'styles/photoshop/brushes/', '.DS_Store'],
    holds('projects', 'projects/a', 'projects/a/tool', 'styles'),
  );
  assert.deepEqual(plan.clone, ['styles/photoshop']);
  assert.deepEqual(plan.skipped.map(({ path }) => path), ['.DS_Store', 'projects/a/out', 'projects/a/tool/.venv']);
});

test('a path the worktree already has is kept as it is', () => {
  const plan = planWorkspaceSeed(['projects/a/generated/'], holds('projects', 'projects/a', 'projects/a/generated'));
  assert.deepEqual(plan, { clone: [], skipped: [{ path: 'projects/a/generated', reason: 'already there' }] });
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runFixtureGit } from '#engine/git/fixture-git.ts';
import { caught, runCheckOnFiles } from './spec-tree.ts';

/** A committed repo standing in for the one a hook runs in, and what a leak would change in it. */
function parentRepo() {
  const root = mkdtempSync(join(tmpdir(), 'hook-parent-'));
  runFixtureGit(root, ['init', '-q']);
  writeFileSync(join(root, 'kept.ts'), 'export const kept = 1;\n');
  runFixtureGit(root, ['add', '-A']);
  runFixtureGit(root, ['-c', 'user.name=parent', '-c', 'user.email=parent@example.com', 'commit', '-q', '-m', 'parent']);
  const state = () => ({
    head: runFixtureGit(root, ['rev-parse', 'HEAD']),
    config: readFileSync(join(root, '.git/config'), 'utf8'),
    index: readFileSync(join(root, '.git/index')).toString('base64'),
  });
  return { root, state };
}

/** Runs `body` with the environment git gives a pre-commit hook, pointed at `root`, and nothing else of git's. */
function asInHookOf<T>(root: string, body: () => T): T {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
  Object.assign(process.env, {
    GIT_DIR: join(root, '.git'), GIT_INDEX_FILE: join(root, '.git/index'), GIT_CONFIG_PARAMETERS: "'core.hookspath'='.githooks'",
  });
  try {
    return body();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

test('under a hook, a fixture repo stays its own: the repo being committed keeps its branch, index and config', () => {
  const control = parentRepo(), parent = parentRepo(), fixture = mkdtempSync(join(tmpdir(), 'hook-fixture-'));
  try {
    // The environment is a real hook's: a plain git call in the fixture writes to the parent.
    const before = control.state();
    asInHookOf(control.root, () => execFileSync('git', ['config', 'user.name', 'spec'], { cwd: fixture }));
    assert.notEqual(control.state().config, before.config);

    const untouched = parent.state();
    const findings = asInHookOf(parent.root, () => {
      runFixtureGit(fixture, ['init', '-q']);
      runFixtureGit(fixture, ['config', 'user.name', 'spec']);
      writeFileSync(join(fixture, 'a.ts'), '');
      runFixtureGit(fixture, ['add', '-A']);
      runFixtureGit(fixture, ['-c', 'user.email=spec@example.com', 'commit', '-q', '-m', 'base']);
      return runCheckOnFiles('timing-ownership', {
        'lib/models/timeline/timeline.ts': 'export const beatSpan = (n: number) => n;\n',
        'projects/p/video.tsx': "import { beatSpan } from '../../lib/models/timeline/timeline.ts';\nbeatSpan(1);\n",
      });
    });
    assert.deepEqual(parent.state(), untouched);
    // The check read the fixture's index, not the parent's.
    assert.deepEqual(caught(findings), ['projects/p/video.tsx:beatSpan from ../../lib/models/timeline/timeline.ts']);
  } finally {
    for (const dir of [control.root, parent.root, fixture]) rmSync(dir, { recursive: true, force: true });
  }
});

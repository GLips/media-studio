// Each capability, made by `studio new` in a copy of the index, then checked as its first commit would be: check:arch
// over the copy's index, typecheck over the new project, and its registered tests, with no repair between. The copy
// has no other project's ignored media, so the typecheck covers the new project and what it imports, not the tree.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, test } from 'node:test';
import { promisify } from 'node:util';
import { PROJECT_CAPABILITIES, type ProjectCapability } from '#models/project/capability.ts';
import { isolatedGitEnv, runFixtureGit } from '../git/fixture-git.ts';
import { withStudioTemp } from '../temp/studio-temp.ts';
import { STUDIO_ROOT } from './studio-project.ts';

const run = promisify(execFile);

/**
 * Runs a command in the workspace at `cwd`, returning its exit code, its stdout, and everything it printed. It runs
 * cut off from the studio's repository, so a check:arch there reads the workspace's index, never the one committing,
 * and from this test run: a `node --test` that inherits NODE_TEST_CONTEXT reports to a parent runner and exits 0
 * whatever fails.
 */
async function outcome(cwd: string, command: string, args: readonly string[]) {
  const { NODE_TEST_CONTEXT: _, ...env } = isolatedGitEnv();
  try {
    const { stdout, stderr } = await run(command, args, { cwd, env, maxBuffer: 16 << 20 });
    return { code: 0, stdout, output: stdout + stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? '', output: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
  }
}

/** Runs `body` in a copy of the studio as the index holds it, as its own git repo, sharing this checkout's node_modules. */
function inIndexWorkspace(body: (workspace: string) => Promise<void>): Promise<void> {
  return withStudioTemp('studio-new', (workspace) => {
    // The studio's own index, read in this process's git environment: under the gate, the one being committed.
    execFileSync('git', ['checkout-index', '--all', `--prefix=${workspace}/`], { cwd: STUDIO_ROOT });
    symlinkSync(realpathSync(join(STUDIO_ROOT, 'node_modules')), join(workspace, 'node_modules'));
    runFixtureGit(workspace, ['init', '-q']);
    appendFileSync(join(workspace, '.git/info/exclude'), 'node_modules\n');
    return body(workspace);
  });
}

async function scaffold(workspace: string, capability: ProjectCapability) {
  const brand = capability === 'still-only' ? ['--brand', 'painful-pleasures'] : [];
  const made = await outcome(workspace, process.execPath, ['cli/studio.ts', 'new', `${capability}-probe`, '--capability', capability, ...brand]);
  assert.equal(made.code, 0, made.output);
  const project = basename(made.stdout.trim());
  runFixtureGit(workspace, ['add', '--all']);
  return project;
}

describe('studio new', { concurrency: true }, () => {
  for (const capability of PROJECT_CAPABILITIES) {
    test(`a ${capability} project passes check:arch, typecheck and its tests as scaffolded`, async () => {
      await inIndexWorkspace(async (workspace) => {
        const project = await scaffold(workspace, capability);
        const files = readdirSync(join(workspace, 'projects', project), { recursive: true }) as string[];

        const arch = await outcome(workspace, process.execPath, ['lint/check-arch.ts']);
        assert.equal(arch.code, 0, arch.output);

        writeFileSync(join(workspace, 'tsconfig.scaffold.json'), JSON.stringify({
          extends: './tsconfig.json',
          include: ['types.d.ts', 'lib/engine/bundle/host-modules.d.ts', 'lib/paint/p5-modules.d.ts', `projects/${project}`],
        }));
        const types = await outcome(workspace, join(workspace, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.scaffold.json']);
        assert.equal(types.code, 0, types.output);

        const specs = files.filter((file) => file.endsWith('.test.ts')).map((file) => join('projects', project, file));
        assert.equal(specs.length > 0, capability !== 'still-only', `${capability} registers ${specs.length} tests`);
        if (specs.length) {
          const tests = await outcome(workspace, process.execPath, ['--test', ...specs]);
          assert.equal(tests.code, 0, tests.output);
          // Its own report, not a parent runner's: tests ran, and none failed.
          assert.match(tests.output, /ℹ pass [1-9]/, tests.output);
          assert.match(tests.output, /ℹ fail 0/, tests.output);
        }
      });
    });
  }

  test('a new project blocks from its first commit: a bar that builds its own timing fails check:arch', async () => {
    await inIndexWorkspace(async (workspace) => {
      const project = await scaffold(workspace, 'music-led');
      appendFileSync(join(workspace, 'projects', project, 'bars/hook.tsx'), "import { beatSpan } from '#models/timeline/timeline.ts';\nexport const longer = beatSpan(8);\n");
      runFixtureGit(workspace, ['add', '--all']);
      const arch = await outcome(workspace, process.execPath, ['lint/check-arch.ts']);
      assert.equal(arch.code, 1, arch.output);
      assert.match(arch.output, new RegExp(`projects/${project}/bars/hook\\.tsx:\\d+ +\\[timing-ownership\\] imports the timing constructor beatSpan`));
    });
  });
});

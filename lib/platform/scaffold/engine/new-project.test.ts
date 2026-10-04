// Each capability, made by `studio new` in a fresh workspace in a copy of the studio's index, then checked as its first
// commit would be: check:arch and lint over the workspace's index, typecheck over the new project, and its registered
// tests, with no repair between. The copy has no other project, so the typecheck covers the new project and what it
// imports.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, test } from 'node:test';
import { promisify } from 'node:util';
import { PROJECT_CAPABILITIES, type ProjectCapability } from '#lib/platform/project/models/capability.ts';
import { isolatedGitEnv, runFixtureGit } from '#lib/platform/git/engine/fixture-git.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';

const run = promisify(execFile);

/**
 * Runs a command in the studio copy at `cwd`, returning its exit code, its stdout, and everything it printed. It runs
 * cut off from this checkout's repositories, so a check:arch there reads the copy's indexes, never the one committing,
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

/**
 * Runs `body` in a copy of the studio as the index holds it, staged in a git repo of its own and sharing this
 * checkout's node_modules, with a fresh workspace made by `studio workspace init`.
 */
function inStudioCopy(body: (studio: string) => Promise<void>): Promise<void> {
  return withStudioTemp('studio-new', async (studio) => {
    // The studio's own index, read in this process's git environment: under the gate, the one being committed.
    execFileSync('git', ['checkout-index', '--all', `--prefix=${studio}/`], { cwd: STUDIO_ROOT });
    symlinkSync(realpathSync(join(STUDIO_ROOT, 'node_modules')), join(studio, 'node_modules'));
    runFixtureGit(studio, ['init', '-q']);
    appendFileSync(join(studio, '.git/info/exclude'), 'node_modules\n');
    runFixtureGit(studio, ['add', '--all']);
    const init = await outcome(studio, process.execPath, ['cli/studio.ts', 'workspace', 'init']);
    assert.equal(init.code, 0, init.output);
    return body(studio);
  });
}

/** A brand kit with what a kit needs and nothing more: its brand.ts and its two logos, no fonts. */
function writeBrandKit(studio: string, kit: string) {
  const dir = join(studio, 'work/brands', kit);
  mkdirSync(dir, { recursive: true });
  const face = { family: 'Probe Sans', fallback: 'system-ui, sans-serif', files: [], source: 'none: the system face' };
  const brand = {
    name: 'Probe', colors: { primary: '#1C365E', secondary: '#437BBF', accent: '#E63636', dark: '#191919', light: '#FFFFFF' }, palette: {},
    fonts: { display: face, text: face }, logos: { light: { file: 'logo-light.svg', color: '#FFFFFF' }, dark: { file: 'logo-dark.svg', color: '#1C365E' } },
    voice: 'Plain.', snapshot: { from: 'new-project.test.ts', on: '2026-09-28' },
  };
  writeFileSync(join(dir, 'brand.ts'), `import type { Brand } from '#lib/picture/brand/models/brand.ts';\n\nexport default ${JSON.stringify(brand, null, 2)} satisfies Brand;\n`);
  for (const logo of ['logo-light.svg', 'logo-dark.svg']) writeFileSync(join(dir, logo), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="10"/>\n');
}

async function scaffold(studio: string, capability: ProjectCapability) {
  const brand = capability === 'still-only' ? ['--brand', 'probe-kit'] : [];
  if (brand.length) writeBrandKit(studio, 'probe-kit');
  const made = await outcome(studio, process.execPath, ['cli/studio.ts', 'new', `${capability}-probe`, '--capability', capability, ...brand]);
  assert.equal(made.code, 0, made.output);
  const project = basename(made.stdout.trim());
  runFixtureGit(join(studio, 'work'), ['add', '--all']);
  return project;
}

const checkWorkspace = (studio: string) => outcome(studio, process.execPath, ['lint/check-arch.ts', '--scope', 'workspace', '--snapshot', 'index']);

describe('studio new', { concurrency: true }, () => {
  for (const capability of PROJECT_CAPABILITIES) {
    test(`a ${capability} project passes check:arch, lint, typecheck and its tests as scaffolded`, async () => {
      await inStudioCopy(async (studio) => {
        const project = await scaffold(studio, capability);
        const projectDir = `work/projects/${project}`;
        const files = readdirSync(join(studio, projectDir), { recursive: true }) as string[];

        const arch = await checkWorkspace(studio);
        assert.equal(arch.code, 0, arch.output);
        const lint = await outcome(studio, process.execPath, ['lint/lint.ts', '--scope', 'workspace', '--snapshot', 'index']);
        assert.equal(lint.code, 0, lint.output);

        writeFileSync(join(studio, 'tsconfig.scaffold.json'), JSON.stringify({
          extends: './tsconfig.json',
          include: ['types.d.ts', 'lib/output/render/engine/host-modules.d.ts', projectDir, 'work/brands/*/brand.ts'],
        }));
        const types = await outcome(studio, join(studio, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.scaffold.json']);
        assert.equal(types.code, 0, types.output);

        const specs = files.filter((file) => file.endsWith('.test.ts')).map((file) => join(projectDir, file));
        assert.equal(specs.length > 0, capability !== 'still-only', `${capability} registers ${specs.length} tests`);
        if (specs.length) {
          const tests = await outcome(studio, process.execPath, ['--test', ...specs]);
          assert.equal(tests.code, 0, tests.output);
          // Its own report, not a parent runner's: tests ran, and none failed.
          assert.match(tests.output, /ℹ pass [1-9]/, tests.output);
          assert.match(tests.output, /ℹ fail 0/, tests.output);
        }
      });
    });
  }

  test('a new project blocks from its first commit: a bar that builds its own timing fails check:arch', async () => {
    await inStudioCopy(async (studio) => {
      const project = await scaffold(studio, 'music-led');
      appendFileSync(join(studio, 'work/projects', project, 'bars/hook.tsx'), "import { beatSpan } from '#lib/timing/timeline/models/timeline.ts';\nexport const longer = beatSpan(8);\n");
      runFixtureGit(join(studio, 'work'), ['add', '--all']);
      const arch = await checkWorkspace(studio);
      assert.equal(arch.code, 1, arch.output);
      assert.match(arch.output, new RegExp(`work/projects/${project}/bars/hook\\.tsx:\\d+ +\\[timing-ownership\\] imports the timing constructor beatSpan`));
    });
  });
});

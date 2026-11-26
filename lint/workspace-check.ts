// A generated config lets the same TypeScript program include exactly the projects active for this run.
import { execFileSync, spawnSync } from 'node:child_process';
import { globSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { activeStudioProjects } from '#lib/platform/project/engine/frozen-project-record.ts';
import { listStudioProjects, STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { uncheckedProjectsOfSnapshot } from './candidate-snapshot.ts';
import { gateRepository } from './gate-scope.ts';

const [mode, option, indexFile] = process.argv.slice(2);
const tracked = option === '--tracked';
const projects = listStudioProjects();
const gitEnv = indexFile ? { ...process.env, GIT_INDEX_FILE: indexFile } : process.env;
const frozen = tracked && uncheckedProjectsOfSnapshot({ ...gateRepository(STUDIO_ROOT, 'workspace', { kind: 'index' }), gitEnv });
const active = frozen ? projects.filter((name) => !frozen.has(name)) : activeStudioProjects();
const selected = active.filter((name) => tracked || !option || name === option);
const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { cwd: STUDIO_ROOT, stdio: 'inherit', env: { ...process.env, STUDIO_RETIME_PROJECTS: JSON.stringify(selected) } });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
};

if (mode === 'typecheck') {
  withStudioTemp('workspace-types', (temp) => {
    const untracked = tracked
      ? execFileSync('git', ['-C', 'work', 'ls-files', '-z', '--others', '--exclude-standard', '--directory'], { cwd: STUDIO_ROOT, env: gitEnv, encoding: 'utf8' }).split('\0').filter(Boolean)
      : [];
    const exclude = ['projects/*/generated', 'projects/*/out', ...projects.filter((name) => !selected.includes(name)).map((name) => `projects/${name}`), ...untracked];
    const config = join(temp, 'tsconfig.json');
    writeFileSync(config, JSON.stringify({ extends: join(STUDIO_ROOT, 'tsconfig.json'), compilerOptions: { typeRoots: [join(STUDIO_ROOT, 'node_modules/@types')] }, exclude: exclude.map((path) => join(STUDIO_ROOT, 'work', path)) }));
    run(join(STUDIO_ROOT, 'node_modules/.bin/effect-tsgo'), ['tsc', '-p', config]);
  });
} else {
  const tests = selected.flatMap((name) => {
    const cwd = join(STUDIO_ROOT, 'work/projects', name);
    return globSync('**/*.test.ts', { cwd }).map((path) => join(cwd, path));
  });
  if (mode === 'test-all') tests.push('lib/**/*.test.ts', 'lint/**/*.test.ts', 'cli/**/*.test.ts', 'web/src/**/*.test.ts');
  run(process.execPath, ['--test', ...tests, 'lib/output/render/engine/workspace-retime-check.ts']);
}

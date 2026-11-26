import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isolatedGitEnv } from '#lib/platform/git/engine/fixture-git.ts';
import { assertStudioWorkspace } from './studio-workspace.ts';
import { FROZEN_PROJECT_RECORD, formatFrozenProjectRecord } from '../models/frozen-project.ts';
import { resolveStudioProjectWith, STUDIO_PROJECTS_DIR, STUDIO_ROOT, STUDIO_WORKSPACE_DIR } from './studio-project.ts';

function checkedRevision(root: string, paths: string[]) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: isolatedGitEnv() }).trim();
  const changes = git('status', '--porcelain', '--untracked-files=all', '--', ...paths);
  if (changes) throw new Error(`Cannot freeze: HEAD does not contain these changes in ${root}:\n${changes}`);
  return git('rev-parse', 'HEAD');
}

function freezeRevision() {
  return {
    engine: checkedRevision(STUDIO_ROOT, ['.']),
    workspace: checkedRevision(STUDIO_WORKSPACE_DIR, ['.', ':(exclude)projects']),
  };
}

function checkProject(name: string) {
  const checks = [
    ['lint/check-arch.ts', '--scope', 'workspace', '--project', name], ['lint/lint.ts', '--scope', 'workspace', '--project', name],
    ['lint/workspace-check.ts', 'typecheck', name], ['lint/workspace-check.ts', 'test', name],
  ];
  const failed = checks.filter((args) => spawnSync(process.execPath, args, {
    cwd: STUDIO_ROOT, stdio: 'inherit', env: isolatedGitEnv(),
  }).status !== 0);
  if (failed.length) throw new Error(`${name} is active. Failed checks: ${failed.map((args) => args.join(' ')).join(', ')}`);
}

export function changeProjectFreeze(arg: string, action: 'freeze' | 'thaw') {
  assertStudioWorkspace();
  const project = realpathSync(resolveStudioProjectWith(arg, 'project.ts'));
  if (dirname(project) !== realpathSync(STUDIO_PROJECTS_DIR)) throw new Error('Choose a project directly under work/projects');
  const file = join(project, FROZEN_PROJECT_RECORD);
  if (action === 'thaw') {
    unlinkSync(file);
    checkProject(basename(project));
    return;
  }
  if (existsSync(file)) throw new Error(`${project} is already frozen; thaw it to check it again`);
  const revision = formatFrozenProjectRecord(freezeRevision());
  checkProject(basename(project));
  if (revision !== formatFrozenProjectRecord(freezeRevision())) throw new Error('HEAD changed during the checks; run freeze again');
  const pending = `${file}.${randomUUID()}`;
  try {
    writeFileSync(pending, revision, { flag: 'wx' });
    linkSync(pending, file);
  } finally {
    rmSync(pending, { force: true });
  }
}

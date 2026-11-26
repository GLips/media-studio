import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isolatedGitEnv, runFixtureGit } from '#lib/platform/git/engine/fixture-git.ts';
import { assertStudioWorkspace } from './studio-workspace.ts';
import { FROZEN_PROJECT_RECORD, formatFrozenProjectRecord } from '../models/frozen-project.ts';
import { resolveStudioProjectWith, STUDIO_PROJECTS_DIR, STUDIO_ROOT, STUDIO_WORKSPACE_DIR } from './studio-project.ts';

/** Both revisions must still describe the inputs after checks finish. Project files travel with their record. */
export function freezeRevision(engine: string, workspace: string, ignored: Set<string>) {
  function checkedRevision(root: string, paths: string[]) {
    const status = runFixtureGit(root, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', '--', ...paths]);
    const blocking = status.split('\0').filter(Boolean).filter((entry) => {
      const path = entry.slice(3);
      if (root !== engine || !entry.startsWith('?? ') || /^(?:(?:lib|cli|web|harness)\/|package(?:-lock)?\.json$|npm-shrinkwrap\.json$)/.test(path)) return true;
      ignored.add(path);
      return false;
    });
    if (blocking.length) throw new Error(`Cannot freeze: HEAD does not contain these changes in ${root}:\n${blocking.join('\n')}`);
    return runFixtureGit(root, ['rev-parse', 'HEAD']).trim();
  }
  return formatFrozenProjectRecord({
    engine: checkedRevision(engine, ['.']),
    workspace: checkedRevision(workspace, ['.', ':(exclude)projects']),
  });
}

function checkProjects(names: string[]) {
  const scope = ['--scope', 'workspace', ...names.flatMap((name) => ['--project', name])];
  const checks = [
    ['lint/check-arch.ts', ...scope], ['lint/lint.ts', ...scope],
    ['lint/workspace-check.ts', 'typecheck', ...names], ['lint/workspace-check.ts', 'test', ...names],
  ];
  const failed = checks.filter((args) => spawnSync(process.execPath, args, {
    cwd: STUDIO_ROOT, stdio: 'inherit', env: isolatedGitEnv(),
  }).status !== 0);
  if (failed.length) throw new Error(`Projects remain active: ${names.join(', ')}. Failed checks: ${failed.map((args) => args.slice(0, 2).join(' ')).join(', ')}`);
}

function writeRecord(file: string, revision: string) {
  const pending = `${file}.${randomUUID()}`;
  try {
    writeFileSync(pending, revision, { flag: 'wx' });
    linkSync(pending, file);
  } finally {
    rmSync(pending, { force: true });
  }
}

export function changeProjectFreeze(args: string[], action: 'freeze' | 'thaw') {
  assertStudioWorkspace();
  const projects = new Set(args.map((arg) => realpathSync(resolveStudioProjectWith(arg, 'project.ts'))));
  const names = Array.from(projects, (project) => basename(project));
  const files = Array.from(projects, (project) => {
    if (dirname(project) !== realpathSync(STUDIO_PROJECTS_DIR)) throw new Error('Choose a project directly under work/projects');
    const file = join(project, FROZEN_PROJECT_RECORD);
    if (existsSync(file) === (action === 'freeze')) throw new Error(`${project} is already ${action === 'freeze' ? 'frozen' : 'active'}`);
    return file;
  });
  if (action === 'thaw') {
    files.forEach((file) => unlinkSync(file));
    checkProjects(names);
    return names;
  }
  const ignored = new Set<string>();
  try {
    const revision = freezeRevision(STUDIO_ROOT, STUDIO_WORKSPACE_DIR, ignored);
    checkProjects(names);
    if (revision !== freezeRevision(STUDIO_ROOT, STUDIO_WORKSPACE_DIR, ignored)) throw new Error('HEAD changed during the checks; run freeze again');
    files.forEach((file) => writeRecord(file, revision));
  } finally {
    if (ignored.size) process.stderr.write(`Ignored untracked studio files:\n${[...ignored].join('\n')}\n`);
  }
  return names;
}

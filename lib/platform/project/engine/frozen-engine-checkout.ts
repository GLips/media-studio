// Project and shared TypeScript must physically live under the pinned package.json. Node and webpack both
// realpath a symlinked source before resolving its #studio and #lib imports.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isolatedGitEnv } from '#lib/platform/git/engine/fixture-git.ts';
import { studioUserCacheDir } from '#lib/platform/temp/engine/studio-user-cache.ts';
import { FROZEN_PROJECT_RECORD, type FrozenProjectRecord } from '../models/frozen-project.ts';
import { STUDIO_ROOT } from './studio-project.ts';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: isolatedGitEnv() });

function prepareDependencies(root: string, studio: string) {
  const modules = join(root, 'node_modules');
  const lock = readFileSync(join(root, 'package-lock.json'));
  const source = join(studio, 'node_modules');
  const providerLock = existsSync(source) && join(dirname(realpathSync(source)), 'package-lock.json');
  const reuse = providerLock && existsSync(providerLock) && lock.equals(readFileSync(providerLock)) && lock.equals(readFileSync(join(studio, 'package-lock.json')));
  const ready = join(root, '.dependencies-ready');
  const provider = reuse ? realpathSync(source) : 'installed';
  if (existsSync(ready) && existsSync(modules) && ['installed', provider].includes(readFileSync(ready, 'utf8'))) return;
  rmSync(ready, { force: true });
  rmSync(modules, { recursive: true, force: true });
  if (reuse) {
    // The kept bundle and Vite caches write under node_modules. Share packages, keeping the checkout's caches local.
    mkdirSync(modules);
    for (const entry of readdirSync(source).filter((name) => name === '.bin' || !name.startsWith('.'))) {
      symlinkSync(join(source, entry), join(modules, entry));
    }
    writeFileSync(ready, provider);
    return;
  }
  // The studio's prepare script configures git hooks. Install from an identical dependency manifest without that
  // checkout setup step so preparing a render never reconfigures the user's repository.
  const deps = join(root, '.dependencies');
  mkdirSync(deps, { recursive: true });
  // SAFETY: npm accepts this checked-in package manifest and its scripts object.
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: { prepare?: string } };
  delete manifest.scripts?.prepare;
  writeFileSync(join(deps, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(deps, 'package-lock.json'), lock);
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: deps, stdio: 'inherit' });
  mkdirSync(join(deps, 'node_modules'), { recursive: true });
  renameSync(join(deps, 'node_modules'), modules);
  writeFileSync(ready, provider);
}

function prepareSharedWorkspace(root: string, source: string, revision: string) {
  const work = join(root, 'work');
  if (!existsSync(join(work, '.git'))) git(source, 'worktree', 'add', '--quiet', '--no-checkout', '--detach', work, revision);
  if (!existsSync(join(root, '.workspace-ready'))) {
    git(work, 'restore', `--source=${revision}`, '--staged', '--worktree', '--', '.', ':(exclude)projects');
    writeFileSync(join(root, '.workspace-ready'), '');
  }
  // Brushes, fonts and media are licensed or generated inputs outside git. Link those assets only.
  const assets = git(source, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z', '--', 'brands', 'styles', 'library', '*.local.json');
  for (const path of assets.split('\0').filter(Boolean)) {
    const target = join(work, path.replace(/\/$/, ''));
    if (lstatSync(target, { throwIfNoEntry: false })) continue;
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(join(source, path), target);
  }
}

/** Holds the checkout until the caller finishes, so a concurrent render can't refresh files under its bundler. */
export async function withFrozenEngine<T>({ project, record, studio = STUDIO_ROOT, mode = 'render' }: {
  project: string; record: FrozenProjectRecord; studio?: string; mode?: 'render' | 'review';
}, run: (root: string, name: string) => Promise<T>): Promise<T> {
  const name = basename(project);
  const owner = createHash('sha256').update(realpathSync(project)).digest('hex').slice(0, 16);
  const home = studioUserCacheDir('frozen', owner, record.engine, record.workspace, mode);
  mkdirSync(home, { recursive: true });
  const lock = new DatabaseSync(join(home, 'checkout.lock'), { timeout: 30000 });
  try {
    lock.exec('BEGIN IMMEDIATE');
    const root = join(home, 'studio');
    if (!existsSync(join(root, '.git'))) git(studio, 'worktree', 'add', '--quiet', '--detach', root, record.engine);
    prepareDependencies(root, studio);
    prepareSharedWorkspace(root, join(studio, 'work'), record.workspace);
    const copy = join(root, 'work/projects', name);
    mkdirSync(copy, { recursive: true });
    const outputs = mode === 'render' ? ['--exclude=/out'] : [];
    execFileSync('rsync', ['-aL', '--checksum', '--delete', '--exclude=/host', ...outputs, '--exclude=/review', `--exclude=/${FROZEN_PROJECT_RECORD}`, `${project}/`, `${copy}/`]);
    if (mode === 'review' && existsSync(join(project, 'storyboard.ts'))) {
      // Plan edits write the storyboard in place. A hard link keeps those edits in the author's project while
      // module resolution starts at the cached checkout.
      rmSync(join(copy, 'storyboard.ts'));
      linkSync(join(project, 'storyboard.ts'), join(copy, 'storyboard.ts'));
    }
    const shared = mode === 'render' ? ['out', 'review', 'host'] : ['review', 'host'];
    for (const folder of shared) {
      const original = join(project, folder);
      if (folder !== 'host') mkdirSync(original, { recursive: true });
      const link = join(copy, folder);
      if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) rmSync(link);
      if (existsSync(original)) symlinkSync(realpathSync(original), link);
    }
    if (mode === 'review') lock.exec('COMMIT');
    return await run(root, name);
  } finally {
    lock.close();
  }
}

// hosts.ts: a video can be about a product repo, its host, and compose that repo's real React components.
//
//   work/hosts.json             optional, committed: host name → { repo: git url }
//   work/hosts.local.json       optional, gitignored: host name → a working copy (absolute, or ~/…)
//   <project>/host.json         the project opts in: { name, ref, browserStubs? }
//   <project>/host              gitignored symlink to the resolved checkout, so a scene imports
//                               `./host/src/components/Button.tsx` and tsc and webpack follow it like any file
//
// A working copy named in hosts.local.json is used as it stands, dirty or not. Otherwise the ref is checked out from
// one shared partial clone into a worktree per commit. The cache ($XDG_CACHE_HOME/studio/hosts) must sit outside the
// studio tree: a host's own tooling walks up for node_modules and would pick up the studio's.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { projectHostLink, readProjectHostSpec, type ProjectHostSpec } from './project-host-spec.ts';

export type { ProjectHostSpec };
import { listStudioProjects, STUDIO_PROJECTS_DIR, STUDIO_WORKSPACE_DIR } from '#lib/platform/project/engine/studio-project.ts';

const XDG_CACHE_HOME = process.env.XDG_CACHE_HOME;
const HOST_CHECKOUTS_DIR = join(XDG_CACHE_HOME && isAbsolute(XDG_CACHE_HOME) ? XDG_CACHE_HOME : join(homedir(), '.cache'), 'studio', 'hosts');

type HostRepos = Record<string, { repo: string }>;
type HostWorkingCopies = Record<string, string>;
export type GitState = { commit: string; dirty: boolean };
export type SyncedHost = ProjectHostSpec & GitState & { dir: string; source: 'working-copy' | 'checkout' };

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const hostReposPath = join(STUDIO_WORKSPACE_DIR, 'hosts.json');
const readHostRepos = (): HostRepos => (existsSync(hostReposPath) ? readJson<HostRepos>(hostReposPath) : {});
const hostWorkingCopiesPath = join(STUDIO_WORKSPACE_DIR, 'hosts.local.json');

function readHostWorkingCopies(): HostWorkingCopies {
  if (!existsSync(hostWorkingCopiesPath)) return {};
  return Object.fromEntries(Object.entries(readJson<HostWorkingCopies>(hostWorkingCopiesPath)).map(([name, path]) => [name, expandWorkingCopyPath(name, path)]));
}

// The CLI runs from any directory, so a relative path would mean something different each time.
function expandWorkingCopyPath(name: string, path: string) {
  if (path === '~' || path.startsWith('~/')) return join(homedir(), path.slice(1));
  if (isAbsolute(path)) return path;
  throw new Error(`hosts: hosts.local.json points ${name} at ${path}; give an absolute path, or one starting with ~/`);
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

export function gitState(dir: string): GitState {
  return { commit: git(dir, 'rev-parse', 'HEAD'), dirty: git(dir, 'status', '--porcelain') !== '' };
}

/**
 * Resolves the project's host to a directory (a working copy, or a checkout of its ref) and points <project>/host
 * at it. `install` runs the host's package manager in a checkout, for components that import the host's own packages.
 */
export function syncProjectHost(projectDir: string, { install = false } = {}): SyncedHost {
  const spec = readProjectHostSpec(projectDir);
  if (!spec) throw new Error(`hosts: ${basename(projectDir)} has no host.json`);
  const workingCopy = readHostWorkingCopies()[spec.name];
  let synced: SyncedHost;
  if (workingCopy) {
    if (!existsSync(workingCopy)) throw new Error(`hosts: hosts.local.json points ${spec.name} at ${workingCopy}, which doesn't exist`);
    synced = { ...spec, ...gitState(workingCopy), dir: workingCopy, source: 'working-copy' };
    if (install) console.error(`hosts: ${spec.name} is your working copy at ${workingCopy}; install its packages there yourself`);
  } else {
    const dir = checkoutHostRef(spec);
    synced = { ...spec, ...gitState(dir), dir, source: 'checkout' };
    if (install) installHostPackages(dir);
  }
  linkProjectHost(projectDir, synced.dir);
  return synced;
}

/** The host a capture was made against, from the project's link as it stands now. Null when there's no host.json. */
export function linkedProjectHost(projectDir: string): (Pick<ProjectHostSpec, 'name' | 'ref'> & GitState) | null {
  const spec = readProjectHostSpec(projectDir);
  if (!spec) return null;
  const link = projectHostLink(projectDir);
  if (!existsSync(link)) throw new Error(`hosts: ${basename(projectDir)} has a host.json but no host link; run \`studio hosts sync ${basename(projectDir)}\``);
  return { name: spec.name, ref: spec.ref, ...gitState(realpathSync(link)) };
}

function checkoutHostRef({ name, ref }: ProjectHostSpec) {
  const repo = readHostRepos()[name]?.repo;
  if (!repo) throw new Error(`hosts: no host named "${name}" in work/hosts.json or work/hosts.local.json`);
  const bare = join(HOST_CHECKOUTS_DIR, `${name}.git`);
  if (!existsSync(bare)) {
    console.error(`hosts: cloning ${repo}`);
    execFileSync('git', ['clone', '--bare', '--filter=blob:none', repo, bare], { stdio: ['ignore', 2, 'inherit'] });
  }
  // A commit already here never moves, so it skips the network; a branch or tag is fetched, since it may have.
  if (!/^[0-9a-f]{40}$/.test(ref) || !hasCommit(bare, ref)) {
    console.error(`hosts: fetching ${name}`);
    git(bare, 'fetch', '--prune', 'origin', '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*');
  }
  if (!hasCommit(bare, ref)) throw new Error(`hosts: ${name} has no branch, tag or commit "${ref}"`);
  const commit = git(bare, 'rev-parse', `${ref}^{commit}`);
  const dir = join(HOST_CHECKOUTS_DIR, `${name}@${commit.slice(0, 12)}`);
  if (!existsSync(dir)) {
    git(bare, 'worktree', 'prune');
    git(bare, 'worktree', 'add', '--quiet', '--detach', dir, commit);
  }
  return dir;
}

function hasCommit(bare: string, ref: string) {
  return spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: bare, stdio: 'ignore' }).status === 0;
}

const PACKAGE_MANAGER_BY_LOCKFILE: readonly [string, readonly string[]][] = [
  ['pnpm-lock.yaml', ['pnpm', 'install', '--frozen-lockfile']],
  ['bun.lock', ['bun', 'install', '--frozen-lockfile']],
  ['bun.lockb', ['bun', 'install', '--frozen-lockfile']],
  ['yarn.lock', ['yarn', 'install', '--immutable']],
  ['package-lock.json', ['npm', 'ci']],
];

function installHostPackages(dir: string) {
  const found = PACKAGE_MANAGER_BY_LOCKFILE.find(([lockfile]) => existsSync(join(dir, lockfile)));
  if (!found) throw new Error(`hosts: no lockfile in ${dir}, so no way to tell which package manager installs it`);
  const [command, ...args] = found[1];
  console.error(`hosts: ${found[1].join(' ')} in ${dir}`);
  const result = spawnSync(command, args, { cwd: dir, stdio: ['ignore', 2, 'inherit'] });
  if (result.status !== 0) throw new Error(`hosts: ${found[1].join(' ')} failed in ${dir}`);
}

// lstat, since a link to a pruned checkout is dangling and existsSync would miss it.
function linkProjectHost(projectDir: string, target: string) {
  const link = projectHostLink(projectDir);
  const existing = lstatSync(link, { throwIfNoEntry: false });
  if (existing && !existing.isSymbolicLink()) throw new Error(`hosts: ${link} is a real file or directory, not the host link; move it`);
  rmSync(link, { force: true });
  symlinkSync(target, link);
}

export type HostListing = { name: string; repo: string | null; workingCopy: string | null; projects: { slug: string; ref: string }[] };

/** Every host in hosts.json or hosts.local.json, or named by a project, with the projects about it. */
export function listHosts(): HostListing[] {
  const repos = readHostRepos();
  const workingCopies = readHostWorkingCopies();
  const users = listStudioProjects().flatMap((slug) => {
    const spec = readProjectHostSpec(join(STUDIO_PROJECTS_DIR, slug));
    return spec ? [{ slug, ...spec }] : [];
  });
  const names = [...new Set([...Object.keys(repos), ...Object.keys(workingCopies), ...users.map((u) => u.name)])].toSorted();
  return names.map((name) => ({
    name,
    repo: repos[name]?.repo ?? null,
    workingCopy: workingCopies[name] ?? null,
    projects: users.filter((u) => u.name === name).map(({ slug, ref }) => ({ slug, ref })),
  }));
}

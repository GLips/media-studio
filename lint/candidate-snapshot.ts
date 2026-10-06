// ─── The files a gate reads: the working tree, the index or a commit ──
//
// Run by hand, check:arch and lint read the working tree, untracked files included, so a project is checked before
// it's added. The pre-commit hooks pass the index, what the commit holds: another session's untracked, half-written
// file is nobody's commit yet, and mustn't block one. A committed tree is check:arch's `--rev`.
//
// Paths are repository-relative and `/`-separated. `gitEnv` is the environment git runs in: a hook's GIT_INDEX_FILE
// names the index the commit holds (a partial or `-a` commit's own).

import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

export type CandidateSnapshot = { kind: 'worktree' } | { kind: 'index' } | { kind: 'commit'; rev: string };

/** A snapshot a hand run or a hook can name: a commit is check:arch's alone. */
export type LiveSnapshot = Exclude<CandidateSnapshot, { kind: 'commit' }>;

export type SnapshotRepository = { root: string; snapshot: CandidateSnapshot; gitEnv: NodeJS.ProcessEnv };

/**
 * One repository's snapshot and its place in the studio's path space: `mount` is `''` for the studio's own, or a
 * folder (`work`) prefixing every path it lists. `gitEnv` is the process's own for the repository git is committing
 * (a hook's GIT_INDEX_FILE is the index the commit holds), isolatedGitEnv() for any other.
 */
export type MountedSnapshot = SnapshotRepository & { mount: string };

export const SOURCE_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'] as const;
const SOURCE_EXTENSION = new RegExp(`\\.(${SOURCE_EXTENSIONS.join('|')})$`);
/** A TypeScript or JavaScript file by its extension, a declaration file included: what either gate reads. */
export const isSourcePath = (path: string) => SOURCE_EXTENSION.test(path);
/** A source path without its extension: the module a spec or an import names. */
export const sourcePathStem = (path: string) => path.replace(SOURCE_EXTENSION, '');

/** A gate's `--snapshot` argument: worktree (a hand run's default) or index (a hook's). */
export function parseLiveSnapshot(argument: string): LiveSnapshot {
  if (argument !== 'worktree' && argument !== 'index') throw new Error(`--snapshot is worktree or index, not ${argument}`);
  return { kind: argument };
}

const gitPaths = (root: string, gitEnv: NodeJS.ProcessEnv, args: readonly string[]) =>
  execFileSync('git', args, { cwd: root, env: gitEnv, encoding: 'utf8', maxBuffer: 1 << 30 })
    .split('\0')
    // An untracked repository inside this one lists as its folder, `name/`: git would add it as a gitlink, no files.
    .filter((path) => path && !path.endsWith('/'));

/** Every file the snapshot holds. The working tree's are its tracked and unignored untracked files still on disk. */
export function listSnapshotPaths({ root, snapshot, gitEnv }: SnapshotRepository): string[] {
  if (snapshot.kind === 'commit') return gitPaths(root, gitEnv, ['ls-tree', '-r', '-z', '--name-only', snapshot.rev]);
  if (snapshot.kind === 'index') return gitPaths(root, gitEnv, ['ls-files', '-z', '--cached']);
  return gitPaths(root, gitEnv, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .filter((path) => lstatSync(join(root, path), { throwIfNoEntry: false }) !== undefined);
}

/** Each path's text, in order: from git's objects for the index or a commit, from disk for the working tree. */
export function readSnapshotTexts(repo: SnapshotRepository, paths: readonly string[]): string[] {
  return readHeldTexts(repo, paths).map((text, i) => {
    if (text === undefined) throw new Error(`${paths[i]} isn't in the snapshot`);
    return text;
  });
}

/** One path's text, or undefined where the snapshot holds no such file. */
export const readSnapshotText = (repo: SnapshotRepository, path: string): string | undefined => readHeldTexts(repo, [path])[0];

function readHeldTexts({ root, snapshot, gitEnv }: SnapshotRepository, paths: readonly string[]): (string | undefined)[] {
  if (snapshot.kind === 'worktree') return paths.map((path) => readWorktreeText(join(root, path)));
  const prefix = snapshot.kind === 'index' ? ':' : `${snapshot.rev}:`;
  return readBlobs(root, gitEnv, paths.map((path) => `${prefix}${path}`));
}

/** A symlink reads as the path it names, as git stores it: one naming a folder (linked brushes) has no text of its own. */
function readWorktreeText(file: string): string | undefined {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return undefined;
  return stat.isSymbolicLink() ? readlinkSync(file) : readFileSync(file, 'utf8');
}

/**
 * Many blobs in one `git cat-file --batch`, in order, undefined for a name git holds no object at. Sizes are bytes,
 * so the output is sliced as a Buffer.
 */
function readBlobs(root: string, gitEnv: NodeJS.ProcessEnv, objectNames: readonly string[]): (string | undefined)[] {
  if (objectNames.length === 0) return [];
  const out = execFileSync('git', ['cat-file', '--batch'], { cwd: root, env: gitEnv, input: objectNames.join('\n') + '\n', maxBuffer: 1 << 30 });
  const texts: (string | undefined)[] = [];
  let at = 0;
  for (const name of objectNames) {
    const headerEnd = out.indexOf(0x0a, at);
    const header = out.subarray(at, headerEnd).toString('utf8');
    at = headerEnd + 1;
    if (header === `${name} missing`) {
      texts.push(undefined);
      continue;
    }
    const match = /^\S+ blob (\d+)$/.exec(header);
    if (!match) throw new Error(`git cat-file can't read ${name}: ${header}`);
    const size = Number(match[1]);
    texts.push(out.subarray(at, at + size).toString('utf8'));
    at += size + 1;
  }
  return texts;
}

const LEFT_OUT_LISTED = 12;

/**
 * Lines naming the sources an index run left out, or none: unignored untracked files, and tracked ones whose working
 * tree differs from the index (an unstaged edit or deletion). `unstaged` says how the gate read those: check:arch
 * reads the index's text; lint's oxlint reads only files, so reads them as they are on disk.
 */
export function describeLeftOutOfIndex({ root, gitEnv, mount }: MountedSnapshot, unstaged: 'as staged' | 'from disk'): string[] {
  const listed = (paths: readonly string[]) => [
    ...paths.slice(0, LEFT_OUT_LISTED).map((path) => `  ${mount ? `${mount}/` : ''}${path}`),
    ...(paths.length > LEFT_OUT_LISTED ? [`  and ${paths.length - LEFT_OUT_LISTED} more`] : []),
  ];
  const untracked = gitPaths(root, gitEnv, ['ls-files', '-z', '--others', '--exclude-standard']).filter(isSourcePath);
  const edited = gitPaths(root, gitEnv, ['diff', '-z', '--name-only']).filter(isSourcePath);
  const read = unstaged === 'as staged' ? 'checked as staged' : 'linted as they are on disk, not as staged';
  return [
    ...(untracked.length ? [`Untracked, so not checked (git add them to be), ${untracked.length}:`, ...listed(untracked)] : []),
    ...(edited.length ? [`Unstaged edits, ${read}, ${edited.length}:`, ...listed(edited)] : []),
  ];
}

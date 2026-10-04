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
export function readSnapshotTexts({ root, snapshot, gitEnv }: SnapshotRepository, paths: readonly string[]): string[] {
  if (snapshot.kind === 'worktree') return paths.map((path) => readWorktreeText(join(root, path)));
  const prefix = snapshot.kind === 'index' ? ':' : `${snapshot.rev}:`;
  return readBlobs(root, gitEnv, paths.map((path) => `${prefix}${path}`));
}

/** A symlink reads as the path it names, as git stores it: one naming a folder (linked brushes) has no text of its own. */
const readWorktreeText = (file: string) => (lstatSync(file).isSymbolicLink() ? readlinkSync(file) : readFileSync(file, 'utf8'));

/** Many blobs in one `git cat-file --batch`, in order. Sizes are bytes, so the output is sliced as a Buffer. */
function readBlobs(root: string, gitEnv: NodeJS.ProcessEnv, objectNames: readonly string[]): string[] {
  if (objectNames.length === 0) return [];
  const out = execFileSync('git', ['cat-file', '--batch'], { cwd: root, env: gitEnv, input: objectNames.join('\n') + '\n', maxBuffer: 1 << 30 });
  const texts: string[] = [];
  let at = 0;
  for (const name of objectNames) {
    const headerEnd = out.indexOf(0x0a, at);
    const header = out.subarray(at, headerEnd).toString('utf8');
    const match = /^\S+ blob (\d+)$/.exec(header);
    if (!match) throw new Error(`git cat-file can't read ${name}: ${header}`);
    const size = Number(match[1]);
    texts.push(out.subarray(headerEnd + 1, headerEnd + 1 + size).toString('utf8'));
    at = headerEnd + 1 + size + 1;
  }
  return texts;
}

/**
 * What a commit of the index leaves out of the working tree: unignored untracked files, and tracked ones whose working
 * tree differs from the index (an unstaged edit or deletion).
 */
export type LeftOutOfIndex = { untracked: string[]; unstaged: string[] };

export function listLeftOutOfIndex({ root, gitEnv }: { root: string; gitEnv: NodeJS.ProcessEnv }): LeftOutOfIndex {
  return {
    untracked: gitPaths(root, gitEnv, ['ls-files', '-z', '--others', '--exclude-standard']),
    unstaged: gitPaths(root, gitEnv, ['diff', '-z', '--name-only']),
  };
}

const LISTED = 12;

/**
 * Lines naming what an index run left unchecked, `mount` prefixing each path, or none. `unstagedRead` says how the
 * gate read a file with unstaged edits: check:arch reads it as staged, lint (oxlint reads disk) as it is on disk.
 */
export function describeLeftOutOfIndex(leftOut: LeftOutOfIndex, { mount, isSource, unstagedRead }: {
  mount: string; isSource: (path: string) => boolean; unstagedRead: string;
}): string[] {
  const listed = (paths: readonly string[]) => [
    ...paths.slice(0, LISTED).map((path) => `  ${mount ? `${mount}/` : ''}${path}`),
    ...(paths.length > LISTED ? [`  and ${paths.length - LISTED} more`] : []),
  ];
  const untracked = leftOut.untracked.filter(isSource), unstaged = leftOut.unstaged.filter(isSource);
  return [
    ...(untracked.length ? [`Untracked, so not checked (git add them to be), ${untracked.length}:`, ...listed(untracked)] : []),
    ...(unstaged.length ? [`Unstaged edits, ${unstagedRead}, ${unstaged.length}:`, ...listed(unstaged)] : []),
  ];
}

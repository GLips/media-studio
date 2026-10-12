// render-archive.ts: every render a project has delivered, kept by the hash of its bytes in out/.history/<hash>/ with
// its snapshot beside it, so review can number a path's versions and compare against one replaced since. `studio
// render` archives what it writes and prunes after; review archives a render a note is written on that something else
// put there. A copy is an APFS clone, so a kept version costs no disk until the file it came from is replaced.
//
// Negative space: a render without a snapshot (a still, a file from before snapshots) isn't archived; there would be
// no path or time to list it by.
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRenderSnapshot, renderSnapshotPath, type RenderSnapshot } from './render-snapshot.ts';

/** Versions kept per render path, newest first, besides those a review references. */
const RENDER_ARCHIVE_KEEP_PER_PATH = 8;
/** Past this, unreferenced versions go oldest first, down to each path's newest. */
const RENDER_ARCHIVE_CAP_BYTES = 5 * 1024 ** 3;
/** A folder younger than this without its snapshot may be one archiveRender is still copying into. */
const RENDER_ARCHIVE_COPYING_MS = 60_000;

export const renderArchiveDirOf = (projectDir: string) => join(projectDir, 'out', '.history');

/** A kept render: its hash, the archived copy (absolute) and the snapshot it was made with. */
export type RenderArchiveEntry = { hash: string; file: string; snapshot: RenderSnapshot };

/**
 * Keeps `file` (absolute, in `projectDir`) and its snapshot under out/.history/<hash>/, once per hash. Returns the
 * archived copy, or null for a render outside a project.
 */
export function archiveRender(projectDir: string, file: string, snapshot: RenderSnapshot): string | null {
  if (snapshot.render.path === null) return null;
  const dir = join(renderArchiveDirOf(projectDir), snapshot.render.hash), copy = join(dir, snapshot.render.file);
  if (existsSync(renderSnapshotPath(copy))) return copy;
  mkdirSync(dir, { recursive: true });
  copyFileSync(file, copy, constants.COPYFILE_FICLONE);
  // Written last: an entry counts as kept only once its snapshot is there, so a copy cut short is redone.
  writeFileSync(renderSnapshotPath(copy), JSON.stringify(snapshot));
  return copy;
}

/** The archived copy in one <hash>/ folder: the file there with its snapshot beside it. */
function archivedRenderIn(dir: string): string | undefined {
  const names = readdirSync(dir);
  return names.map((name) => join(dir, name)).find((file) => file !== renderSnapshotPath(file) && existsSync(renderSnapshotPath(file)));
}

/**
 * Every kept render in the project whose snapshot still reads (this snapshot version, of these bytes), oldest first by
 * when it was made.
 */
export function listRenderArchive(projectDir: string): RenderArchiveEntry[] {
  const root = renderArchiveDirOf(projectDir);
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((hash) => {
    const file = archivedRenderIn(join(root, hash));
    const loaded = file && loadRenderSnapshot(file);
    return file && loaded && loaded.kind === 'snapshot' ? [{ hash, file, snapshot: loaded.snapshot }] : [];
  }).toSorted((a, b) => a.snapshot.made.localeCompare(b.snapshot.made) || a.hash.localeCompare(b.hash));
}

const archivedSizeOf = (entry: RenderArchiveEntry) => (existsSync(entry.file) ? statSync(entry.file).size : 0);

/**
 * Drops kept renders past the newest 8 of each path, and then, over 5 GB, unreferenced ones oldest first, never a
 * path's newest. A hash in `keepHashes` (a review note's or a decision candidate's) is always kept. Returns the hashes
 * dropped.
 */
export function pruneRenderArchive(projectDir: string, keepHashes: ReadonlySet<string>): string[] {
  const entries = listRenderArchive(projectDir);
  const byPath = new Map<string | null, RenderArchiveEntry[]>();
  for (const entry of entries) byPath.set(entry.snapshot.render.path, [...(byPath.get(entry.snapshot.render.path) ?? []), entry]);
  const newest = new Set([...byPath.values()].map((versions) => versions.at(-1)!.hash));
  const recent = new Set([...byPath.values()].flatMap((versions) => versions.slice(-RENDER_ARCHIVE_KEEP_PER_PATH).map((e) => e.hash)));
  const dropped = entries.filter((e) => !keepHashes.has(e.hash) && !recent.has(e.hash));
  let total = entries.filter((e) => !dropped.includes(e)).reduce((sum, e) => sum + archivedSizeOf(e), 0);
  for (const entry of entries) {
    if (total <= RENDER_ARCHIVE_CAP_BYTES) break;
    if (dropped.includes(entry) || keepHashes.has(entry.hash) || newest.has(entry.hash)) continue;
    dropped.push(entry);
    total -= archivedSizeOf(entry);
  }
  // A version whose snapshot no longer reads (an older format, a copy cut short) can't be listed or compared: it goes
  // too, unless something references it. A young one is left: review archives under its own lock, not this one's.
  const listed = new Set(entries.map((e) => e.hash)), root = renderArchiveDirOf(projectDir), now = Date.now();
  const copying = (hash: string) => now - statSync(join(root, hash)).mtimeMs < RENDER_ARCHIVE_COPYING_MS;
  const unreadable = existsSync(root) ? readdirSync(root).filter((hash) => !listed.has(hash) && !keepHashes.has(hash) && !copying(hash)) : [];
  const gone = [...dropped.map((e) => e.hash), ...unreadable];
  for (const hash of gone) rmSync(join(root, hash), { recursive: true, force: true });
  return gone;
}

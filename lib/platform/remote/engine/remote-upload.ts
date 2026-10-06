// remote-upload.ts: what a remote call's container needs of this machine's files, named by content, and the upload of
// what the app's Volume lacks. A render takes its project and the studio code it runs; a check, the whole checkout
// (docs/remote.md, Uploads). Ignored files go only as named here. A brush pack goes as its `current`, its profiles
// (hashed like any file) and that generation, which never changes once made: it's uploaded once under its name and never
// hashed. Node only.
//
// Negative space: a project's generated/ and out/ never go. Both are made by a render, and no check reads them.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { sha256OfFile } from '#lib/platform/files/engine/file-sha256.ts';
import { isolatedGitEnv } from '#lib/platform/git/engine/fixture-git.ts';
import {
  listStudioProjects, readProjectDeclaration, STUDIO_BRANDS_DIR, STUDIO_PROJECTS_DIR, STUDIO_ROOT, STUDIO_STYLES_DIR, STUDIO_WORKSPACE_DIR,
} from '#lib/platform/project/engine/studio-project.ts';
import { isStudioWorkspaceRepo } from '#lib/platform/project/engine/studio-workspace.ts';
import { studioUserCacheDir } from '#lib/platform/temp/engine/studio-user-cache.ts';
import type { RemoteApp, RemotePrepareAnswer, RemotePutRequest } from './remote-modal.ts';

/** A file the container lays at `path` (relative to the studio, `/`-separated), its bytes at `local` here. */
export type RemoteUploadFile = { readonly path: string; readonly local: string; readonly hash: string; readonly size: number };
/** A brush generation the container lays at `path`, uploaded once under `key` (its style, pack and generation). */
export type RemoteUploadGeneration = { readonly path: string; readonly local: string; readonly key: string };
export type RemoteUpload = { readonly files: readonly RemoteUploadFile[]; readonly generations: readonly RemoteUploadGeneration[] };
/** A repository a checkout holds: its folder in the studio ('' the studio's own, 'work' the workspace) and the paths it tracks. */
export type RemoteUploadRepo = { readonly root: string; readonly tracked: readonly string[] };
export type RemoteCheckoutUpload = RemoteUpload & { readonly repos: readonly RemoteUploadRepo[] };

/** The studio's own files a render reads beyond lib/ and cli/. */
const STUDIO_ROOT_FILES = ['package.json', 'package-lock.json', 'tsconfig.json', 'remotion.config.ts', 'types.d.ts'];
/** A project's media folders, ignored by the workspace's git, which its render, its typecheck and its tests read. */
const PROJECT_MEDIA_DIRS = ['music', 'audio', 'captures'];
/** Bytes a single upload call carries, short of a size Modal's JS SDK would have to split. */
const UPLOAD_BATCH_BYTES = 32 * 2 ** 20;
const UPLOAD_CALLS_AT_ONCE = 4;

const studioPath = (local: string) => relative(STUDIO_ROOT, local).split(sep).join('/');

/** Paths (repository-relative) git lists under `paths` of the repository at `repo`: those it tracks, or every one it doesn't ignore. */
function gitPaths(repo: string, which: 'tracked' | 'unignored', paths: readonly string[] = []): string[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', ...(which === 'unignored' ? ['--others', '--exclude-standard'] : []), '--', ...paths], {
    cwd: repo, env: isolatedGitEnv(), encoding: 'utf8', maxBuffer: 64 * 2 ** 20,
  });
  return [...new Set(listed.split('\0').filter(Boolean))];
}

/** Files git lists under `paths` of the repository at `repo`, tracked and new but not ignored, as absolute paths. */
const gitListed = (repo: string, paths: readonly string[] = []) => gitPaths(repo, 'unignored', paths).map((path) => join(repo, path));

/**
 * Every file under `dir` (a link to a file counts as one), none when it's missing. Dot-files are left out: macOS's
 * .DS_Store, and a profile still being written (`.<name>.<uuid>`, renamed into place once whole, so it may be gone by
 * the time it's read).
 */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => !entry.split(sep).some((name) => name.startsWith('.')))
    .map((entry) => join(dir, entry)).filter((file) => statSync(file).isFile());
}

const isFileHere = (file: string) => existsSync(file) && statSync(file).isFile();

// ---------- hashing, remembered ----------

const HASHES_FILE = studioUserCacheDir('remote', 'hashes.json');
type RememberedHash = [path: string, size: number, mtimeMs: number, hash: string];

function isRememberedHash(value: unknown): value is RememberedHash {
  return Array.isArray(value) && value.length === 4 && typeof value[0] === 'string' && typeof value[1] === 'number' && typeof value[2] === 'number' && typeof value[3] === 'string';
}

/**
 * Each of `files` hashed, a file whose size and mtime are as when last hashed taken from the user cache (an unchanged
 * worktree hashes nothing).
 */
function hashedFiles(files: readonly string[]): RemoteUploadFile[] {
  const read: unknown = existsSync(HASHES_FILE) ? JSON.parse(readFileSync(HASHES_FILE, 'utf8')) : [];
  const remembered = new Map((Array.isArray(read) && read.every(isRememberedHash) ? read : []).map((entry) => [entry[0], entry]));
  const hashed = files.map((local) => {
    const { size, mtimeMs } = statSync(local), known = remembered.get(local);
    const hash = known && known[1] === size && known[2] === mtimeMs ? known[3] : sha256OfFile(local);
    remembered.set(local, [local, size, mtimeMs, hash]);
    return { path: studioPath(local), local, hash, size };
  });
  mkdirSync(join(HASHES_FILE, '..'), { recursive: true });
  writeFileSync(`${HASHES_FILE}.${process.pid}`, JSON.stringify([...remembered.values()].filter(([path]) => existsSync(path))));
  renameSync(`${HASHES_FILE}.${process.pid}`, HASHES_FILE);
  return hashed;
}

// ---------- what a render and a check need ----------

/** Each brush pack of `style`: its `current` file and measured profiles, and the generation it names. */
function brushPacksOf(style: string): { current: string; profiles: string[]; generation: RemoteUploadGeneration }[] {
  const brushes = join(STUDIO_STYLES_DIR, style, 'brushes');
  if (!existsSync(brushes)) return [];
  return readdirSync(brushes).flatMap((pack) => {
    const current = join(brushes, pack, 'current');
    if (!existsSync(current)) return [];
    const name = readFileSync(current, 'utf8').trim(), local = join(brushes, pack, 'generations', name);
    return [{ current, profiles: filesUnder(join(brushes, pack, 'profiles')), generation: { path: studioPath(local), local, key: `${style}/${pack}/${name}` } }];
  });
}

/** Every brand kit's fonts, which the workspace's git ignores. */
const brandFonts = () => (existsSync(STUDIO_BRANDS_DIR) ? readdirSync(STUDIO_BRANDS_DIR).flatMap((kit) => filesUnder(join(STUDIO_BRANDS_DIR, kit, 'fonts'))) : []);

/** What a render of `project` (its folder) reads, hashed. A project with a host is refused: its host's checkout lives outside the studio. */
export async function remoteProjectUpload(project: string): Promise<RemoteUpload> {
  if (existsSync(join(project, 'host.json'))) throw new Error(`${relative(STUDIO_ROOT, project)} composes a host's components (host.json), whose checkout isn't uploaded: render it here`);
  const styles = (await readProjectDeclaration(project))?.styles ?? [];
  const packs = styles.flatMap(brushPacksOf);
  const files = [
    ...gitListed(STUDIO_ROOT, ['lib', 'cli']), ...STUDIO_ROOT_FILES.map((file) => join(STUDIO_ROOT, file)),
    ...gitListed(STUDIO_WORKSPACE_DIR, [relative(STUDIO_WORKSPACE_DIR, project), ...styles.map((style) => `styles/${style}`), 'brands']),
    ...PROJECT_MEDIA_DIRS.flatMap((dir) => filesUnder(join(project, dir))), ...brandFonts(), ...packs.flatMap(({ current, profiles }) => [current, ...profiles]),
  ].filter(isFileHere);
  return { files: hashedFiles([...new Set(files)]), generations: packs.map(({ generation }) => generation) };
}

/**
 * The whole checkout as a check reads it, hashed: each repository's files as git lists them, with the paths it tracks,
 * and the workspace's ignored inputs, which a project's typecheck and tests import. A checkout without a workspace
 * goes as the studio alone, as a clean clone is.
 */
export function remoteCheckoutUpload(): RemoteCheckoutUpload {
  const roots = isStudioWorkspaceRepo() ? [STUDIO_ROOT, STUDIO_WORKSPACE_DIR] : [STUDIO_ROOT];
  const listed = roots.flatMap((root) => gitListed(root)).filter(isFileHere);
  const packs = roots.includes(STUDIO_WORKSPACE_DIR) && existsSync(STUDIO_STYLES_DIR) ? readdirSync(STUDIO_STYLES_DIR).flatMap(brushPacksOf) : [];
  const ignored = roots.includes(STUDIO_WORKSPACE_DIR) ? [
    ...listStudioProjects().flatMap((project) => PROJECT_MEDIA_DIRS.flatMap((dir) => filesUnder(join(STUDIO_PROJECTS_DIR, project, dir)))),
    ...brandFonts(), ...packs.flatMap(({ current, profiles }) => [current, ...profiles]),
  ] : [];
  const files = hashedFiles([...new Set([...listed, ...ignored])]), uploaded = new Set(files.map((file) => file.path));
  return {
    files, generations: packs.map(({ generation }) => generation),
    // Only what goes: a tracked file deleted here has no bytes to lay out.
    repos: roots.map((root) => {
      const folder = studioPath(root);
      return { root: folder, tracked: gitPaths(root, 'tracked').filter((path) => uploaded.has(folder ? `${folder}/${path}` : path)) };
    }),
  };
}

// ---------- uploading ----------

/** `items` cut into batches of at most UPLOAD_BATCH_BYTES each (a bigger item alone). */
function batchesOf<T extends { size: number }>(items: readonly T[]): T[][] {
  const batches: T[][] = [];
  let bytes = Infinity;
  for (const item of items) {
    if (bytes + item.size > UPLOAD_BATCH_BYTES) {
      batches.push([]);
      bytes = 0;
    }
    batches.at(-1)!.push(item);
    bytes += item.size;
  }
  return batches;
}

/** Runs `tasks` at most `atOnce` at a time. */
async function inTurns(tasks: readonly (() => Promise<void>)[], atOnce: number): Promise<void> {
  let next = 0;
  const takeTurns = async (): Promise<void> => {
    if (next >= tasks.length) return;
    await tasks[next++]();
    return takeTurns();
  };
  await Promise.all(Array.from({ length: Math.min(atOnce, tasks.length) }, takeTurns));
}

const readUpload = (local: string) => new Uint8Array(readFileSync(local));

/**
 * Uploads what `prepared` says the Volume lacks of `upload`: files in batches, and each missing brush generation, its
 * last batch marking it complete once the rest are in. Returns the files and bytes sent.
 */
export async function uploadRemoteMissing(app: RemoteApp, upload: RemoteUpload, prepared: RemotePrepareAnswer): Promise<{ files: number; bytes: number }> {
  const missing = new Set(prepared.missingFiles);
  const files = [...new Map(upload.files.filter((f) => missing.has(f.hash)).map((f) => [f.hash, f])).values()];
  // Each batch is read as its call goes, so the uploads never sit in memory all at once.
  const put = (request: () => RemotePutRequest) => async () => {
    await app.put(request());
  };
  const generations = upload.generations.filter((g) => prepared.missingGenerations.includes(g.key)).map((g) => ({
    key: g.key, files: filesUnder(g.local).map((local) => ({ path: relative(g.local, local).split(sep).join('/'), local, size: statSync(local).size })),
  }));
  await inTurns([
    ...batchesOf(files).map((batch) => put(() => ({ kind: 'files', files: batch.map((f) => ({ hash: f.hash, bytes: readUpload(f.local) })) }))),
    ...generations.flatMap(({ key, files: inside }) => batchesOf(inside).slice(0, -1).map((batch) => put(() => ({
      kind: 'generation', key, complete: false, files: batch.map((f) => ({ path: f.path, bytes: readUpload(f.local) })),
    })))),
  ], UPLOAD_CALLS_AT_ONCE);
  await inTurns(generations.map(({ key, files: inside }) => put(() => ({
    kind: 'generation', key, complete: true, files: (batchesOf(inside).at(-1) ?? []).map((f) => ({ path: f.path, bytes: readUpload(f.local) })),
  }))), UPLOAD_CALLS_AT_ONCE);
  const sent = [...files, ...generations.flatMap((g) => g.files)];
  return { files: sent.length, bytes: sent.reduce((sum, f) => sum + f.size, 0) };
}

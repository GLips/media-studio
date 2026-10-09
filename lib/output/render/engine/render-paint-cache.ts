// render-paint-cache.ts: solved paint kept on disk between renders, so a project rendered again after a small edit,
// or none, starts nearly warm. A page's sheet solves (stamp-sheet-disk.ts) ask it for their decisions by state key and
// for their films by film key, and give it what they solve. Node keeps each as an opaque file, under a namespace that
// changes with the studio's code and the workspace's styles; the oldest are pruned past a cap. Nothing checks what it
// serves: deleting the folder (paintCacheDir) is the cure for anything stale. Node only.

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { dirname, join, relative } from 'node:path';
import { studioUserCacheDir } from '#lib/platform/temp/engine/studio-user-cache.ts';
import { listenOnRenderLoopback } from '#lib/platform/browser/engine/render-loopback.ts';

/** Where solved paint is kept, every namespace's (STUDIO_PAINT_CACHE moves it): delete it to start every painting cold. */
export const paintCacheDir = () => process.env.STUDIO_PAINT_CACHE || studioUserCacheDir('paint-cache');

/** The most the folder holds, bytes; the least recently used files go first past it. */
export const PAINT_CACHE_BYTES = 8 * 2 ** 30;

/** Bytes written between prunes: a render's growth past the cap is at most this. */
const PRUNE_EVERY_BYTES = 2 ** 30;

/** Bumped when what a page sends changes its shape, so files of the old shape are never read. */
const PAINT_CACHE_FORMAT = 2;

/**
 * Where the code a solve runs starts: the solving of a painting's sheets, and the compile that makes their programs
 * and keys. A namespace hashes every module they import, so an edit elsewhere in the studio keeps the cache.
 */
const NAMESPACE_ROOTS = ['lib/paint/document/studio/painting-sheets-solve.ts', 'lib/paint/document/models/painting-document-compile.ts'];

/** What else names a namespace: the locked dependencies, and the styles' files by stat. */
const NAMESPACE_LOCK = 'package-lock.json', NAMESPACE_STYLES = join('work', 'styles');

/** Every file under `dir`, recursively; none for a missing one. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).toSorted();
}

/** A module specifier in TypeScript source: a static or a dynamic import's, an export's from. */
const IMPORTED = /(?:from|import)\s*\(?\s*'([^']+)'/g;

/** `roots` and every module of the studio's at `root` they import, transitively, each with its text. */
async function modulesFrom(root: string, roots: readonly string[]): Promise<Map<string, Buffer>> {
  const read = new Map<string, Buffer>();
  /** Reads `wave`, then the modules it imports that aren't read yet. */
  const readWave = async (wave: readonly string[]): Promise<void> => {
    if (!wave.length) return;
    // A specifier the pattern finds in a comment may name no file.
    const texts = await Promise.all(wave.map(async (file) => [file, await readFile(file).catch(() => null)] as const));
    const next = new Set<string>();
    for (const [file, text] of texts) {
      if (!text) continue;
      read.set(file, text);
      for (const [, specifier] of text.toString('utf8').matchAll(IMPORTED)) {
        if (specifier.startsWith('#lib/')) next.add(join(root, 'lib', specifier.slice('#lib/'.length)));
        else if (specifier.startsWith('.')) next.add(join(dirname(file), specifier));
      }
    }
    await readWave([...next].filter((file) => !read.has(file)));
  };
  await readWave(roots.map((file) => join(root, file)));
  return read;
}

/**
 * The namespace solved paint is kept under for the checkout at `root`: the code a solve runs (NAMESPACE_ROOTS and what
 * they import), the lockfile, and the styles' paths, sizes and times (brush images are hundreds of MB, too many to
 * read each render). Any change starts a fresh namespace; the old one ages out.
 */
export async function paintCacheNamespace(root: string): Promise<string> {
  const hash = createHash('sha256').update(`format ${PAINT_CACHE_FORMAT}\n`);
  const modules = await modulesFrom(root, NAMESPACE_ROOTS);
  for (const file of [...modules.keys()].toSorted()) hash.update(`${relative(root, file)}\n`).update(modules.get(file)!);
  hash.update(await readFile(join(root, NAMESPACE_LOCK)));
  const styles = await filesUnder(join(root, NAMESPACE_STYLES));
  for (const [i, { size, mtimeMs }] of (await Promise.all(styles.map((file) => stat(file)))).entries()) hash.update(`${relative(root, styles[i])} ${size} ${mtimeMs}\n`);
  return hash.digest('hex').slice(0, 24);
}

/**
 * Films are kept gzipped at its fastest level and sent as they're kept, for the page's fetch to inflate: paint is
 * mostly empty texels and layers, 3-50× smaller so, and smaller is faster read, sent and inflated than raw.
 */
const gzipped = promisify(gzip);

/** A key's file name: its hash, as keys are long and hold `|`. */
const fileOf = (key: string) => `${createHash('sha256').update(key).digest('hex')}.bin`;

/** The whole body of `request`. */
async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  // SAFETY: a request with no encoding set reads as Buffers.
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** A file's bytes, its time touched as used; null for none. */
async function readUsed(file: string): Promise<Buffer | null> {
  const bytes = await readFile(file).catch(() => null);
  if (bytes) {
    const now = new Date();
    await utimes(file, now, now).catch(() => {});
  }
  return bytes;
}

/** `bytes` written to `file` whole: through a temporary file renamed over it, so a reader never sees part of one. */
async function writeWhole(file: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, file);
}

/** Deletes the least recently used files under `dir` until it holds at most `cap` bytes. */
export async function prunePaintCache(dir: string, cap: number): Promise<void> {
  const files = await Promise.all((await filesUnder(dir)).map(async (file) => {
    const { size, mtimeMs } = await stat(file).catch(() => ({ size: 0, mtimeMs: 0 }));
    return { file, size, mtimeMs };
  }));
  let held = files.reduce((sum, { size }) => sum + size, 0);
  const pruned = files.toSorted((a, b) => a.mtimeMs - b.mtimeMs).filter(({ size }) => {
    if (held <= cap) return false;
    held -= size;
    return true;
  });
  await Promise.all(pruned.map(({ file }) => rm(file, { force: true })));
}

/**
 * A memo's rank: what it knows of its entry, an entry past a prefix (0), its decision (1), its decision with damp
 * windows (2). One never replaces a higher, so a page knowing less never makes another solve again.
 */
type PaintMemoPut = readonly [key: string, rank: number, memo: string];

/** A render's solved-paint cache: where its pages ask. */
export type PaintCacheServed = { readonly url: string };

/**
 * Serves namespace `namespace` of the cache at `dir` to a render's pages, pruned to `cap` bytes as it starts and grows:
 * - `GET`, `PUT /film/<key>`: a film's bytes, kept by the first page to send them
 * - `POST /memos` (state keys): the memos known of them, `[key, memo]` pairs
 * - `POST /memos/put` (PaintMemoPuts): memos learned
 */
export async function servePaintCache({ dir = paintCacheDir(), namespace, cap = PAINT_CACHE_BYTES }: { dir?: string; namespace: string; cap?: number }): Promise<PaintCacheServed> {
  const films = join(dir, namespace, 'films'), memos = join(dir, namespace, 'memos');
  await Promise.all([mkdir(films, { recursive: true }), mkdir(memos, { recursive: true })]);
  // Prunes run one at a time, each after the last.
  let pruning = prunePaintCache(dir, cap), written = 0;
  const wrote = (bytes: number) => {
    written += bytes;
    if (written < PRUNE_EVERY_BYTES) return;
    written = 0;
    pruning = pruning.then(() => prunePaintCache(dir, cap));
  };
  const filmsSending = new Set<string>();
  const memoRanks = new Map<string, number>();
  /** A memo's file holds its rank, a newline, then the memo. */
  const memoOf = async (key: string) => {
    const bytes = await readUsed(join(memos, fileOf(key)));
    if (!bytes) return null;
    const text = bytes.toString('utf8'), split = text.indexOf('\n');
    return { rank: Number(text.slice(0, split)), memo: text.slice(split + 1) };
  };

  const answer = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://cache'), film = url.pathname.match(/^\/film\/(.+)$/);
    if (film && request.method === 'GET') {
      const bytes = await readUsed(join(films, fileOf(decodeURIComponent(film[1]))));
      if (!bytes) return response.writeHead(404).end();
      return response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip', 'content-length': bytes.byteLength }).end(bytes);
    }
    if (film && request.method === 'PUT') {
      const key = decodeURIComponent(film[1]), file = join(films, fileOf(key)), bytes = await bodyOf(request);
      // Answered once received: the page solves on while Node packs and writes. One cut short by the render's exit
      // leaves only its temporary file.
      response.writeHead(204).end();
      // A film is the same whoever solved it: the first to send it keeps it.
      if (bytes.byteLength > cap || filmsSending.has(key) || await stat(file).catch(() => null)) return response;
      filmsSending.add(key);
      try {
        const kept = await gzipped(bytes, { level: 1 });
        await writeWhole(file, kept);
        wrote(kept.byteLength);
      } finally {
        filmsSending.delete(key);
      }
      return response;
    }
    if (url.pathname === '/memos' && request.method === 'POST') {
      // SAFETY: only stamp-sheet-disk.ts asks, with an array of keys.
      const keys = JSON.parse((await bodyOf(request)).toString('utf8')) as string[];
      const found = (await Promise.all(keys.map(async (key) => [key, (await memoOf(key))?.memo] as const))).filter(([, memo]) => memo !== undefined);
      return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(found));
    }
    if (url.pathname === '/memos/put' && request.method === 'POST') {
      // SAFETY: only stamp-sheet-disk.ts puts, with PaintMemoPuts.
      const puts = JSON.parse((await bodyOf(request)).toString('utf8')) as PaintMemoPut[];
      await Promise.all(puts.map(async ([key, rank, memo]) => {
        const known = memoRanks.get(key) ?? (await memoOf(key))?.rank ?? -1;
        if (rank < known) return;
        memoRanks.set(key, rank);
        const bytes = Buffer.from(`${rank}\n${memo}`);
        await writeWhole(join(memos, fileOf(key)), bytes);
        wrote(bytes.byteLength);
      }));
      return response.writeHead(204).end();
    }
    return response.writeHead(404).end();
  };

  const server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-methods', 'GET, PUT, POST');
    response.setHeader('access-control-allow-headers', 'content-type');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    answer(request, response).catch((error: Error) => {
      // A film's write fails after its page was answered: the next render solves it again.
      if (response.headersSent) process.stderr.write(`  the solved-paint cache couldn't keep a film: ${error.message}\n`);
      else response.writeHead(500, { 'content-type': 'text/plain' }).end(error.message);
    });
  });
  const port = await listenOnRenderLoopback(server);
  return { url: `http://127.0.0.1:${port}` };
}

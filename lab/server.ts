// server.ts: the Studio Lab, a local playground with a tab per studio capability. esbuild bundles lab/app into a temp
// folder and rebuilds on every save; this server hands out that bundle, the media the studio has already made, and
// two listings of it. Everything interactive (curves, springs, sfx recipes, music fits, the hold check) runs in the
// browser from lib/ itself, so the lab can never drift from what a render does.
//
// Negative space: nothing here generates media or calls a paid API. The gallery only reads provenance files.
import * as esbuild from 'esbuild';
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve, sep } from 'node:path';
import { STUDIO_PROJECTS_DIR, STUDIO_ROOT } from '../lib/studio-project.ts';

const LAB_DIR = join(STUDIO_ROOT, 'lab');
const SCRATCH_DIR = join(STUDIO_ROOT, 'scratch');

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
};
const BUNDLE_TYPES: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', ...MEDIA_TYPES };

export async function startStudioLab({ port }: { port: number }) {
  const outdir = mkdtempSync(join(tmpdir(), 'studio-lab-'));
  const bundle = await esbuild.context({
    entryPoints: [join(LAB_DIR, 'app', 'main.tsx')],
    bundle: true,
    outdir,
    format: 'esm',
    jsx: 'automatic',
    sourcemap: 'linked',
    loader: { '.ttf': 'file', '.png': 'file', '.jpg': 'file', '.webp': 'file', '.svg': 'file', '.mp3': 'file', '.wav': 'file' },
    // lib/ modules read these at render time; in the lab there's no project bundle, so pin them.
    define: { 'process.env.NODE_ENV': '"development"', PROJECT_SLUG: '"lab"', REPLAY_SLUG: '"lab-replay"', BLOCKOUT_SLUG: '"lab-blockout"' },
    logLevel: 'warning',
  });
  await bundle.watch();

  const server = createServer((req, res) => {
    try {
      route(req, res, outdir);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise<void>((done, fail) => server.once('error', fail).listen(port, '127.0.0.1', done));
  return { url: `http://localhost:${port}/`, close: async () => { server.close(); await bundle.dispose(); } };
}

function route(req: IncomingMessage, res: ServerResponse, outdir: string) {
  const url = new URL(req.url ?? '/', 'http://lab');
  const path = decodeURIComponent(url.pathname);
  if (path === '/') return sendFile(req, res, join(LAB_DIR, 'app', 'index.html'), 'text/html');
  if (path === '/api/gallery') return sendJson(res, listGeneratedMedia());
  if (path === '/api/music') return sendJson(res, listMusicTracks());
  if (path.startsWith('/media/')) {
    // Only files under projects/ and scratch/, and only media: the repo's code and secrets stay off the wire.
    const file = resolve(STUDIO_ROOT, path.slice('/media/'.length));
    const inside = [STUDIO_PROJECTS_DIR, SCRATCH_DIR].some((dir) => file.startsWith(dir + sep));
    const type = MEDIA_TYPES[extname(file).toLowerCase()];
    if (!inside || !type || !existsSync(file)) return res.writeHead(404).end();
    return sendFile(req, res, file, type);
  }
  const built = join(outdir, path);
  const type = BUNDLE_TYPES[extname(built)] ?? (built.endsWith('.map') ? 'application/json' : undefined);
  if (built.startsWith(outdir + sep) && type && existsSync(built)) return sendFile(req, res, built, type);
  res.writeHead(404).end();
}

const sendJson = (res: ServerResponse, body: unknown) =>
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));

/** A file, with byte ranges: a <video> won't seek without them. */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string, type: string) {
  const size = statSync(file).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  if (!range) {
    res.writeHead(200, { ...headers, 'content-length': size });
    createReadStream(file).pipe(res);
    return;
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}` });
  createReadStream(file, { start, end }).pipe(res);
}

const mediaUrl = (file: string) => `/media/${relative(STUDIO_ROOT, file).split(sep).map(encodeURIComponent).join('/')}`;

/** A folder's children that are folders, or none when it doesn't exist. */
const subdirs = (dir: string) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(dir, d.name)) : []);

type ProvenanceEntry = {
  name: string; kind: 'image' | 'video' | 'audio'; model: string; prompt: string; params?: Record<string, unknown>;
  references?: { path: string }[]; files: string[]; cost?: number; generatedAt?: string;
};

export type LabGalleryItem = {
  id: string; where: string; name: string; kind: ProvenanceEntry['kind']; model: string; prompt: string; params: Record<string, unknown>;
  cost: number | null; generatedAt: string | null; files: string[]; references: string[];
};

/**
 * Everything `studio gen` has made, read from each generated/provenance.json in projects/ and scratch/. Files that
 * have since been deleted are dropped; an entry left with none is too.
 */
function listGeneratedMedia(): LabGalleryItem[] {
  const folders = [...subdirs(STUDIO_PROJECTS_DIR), ...subdirs(SCRATCH_DIR)];
  return folders.flatMap((folder) => {
    const provenance = join(folder, 'generated', 'provenance.json');
    if (!existsSync(provenance)) return [];
    const entries = JSON.parse(readFileSync(provenance, 'utf8')) as Record<string, ProvenanceEntry>;
    return Object.entries(entries).flatMap(([key, e]): LabGalleryItem[] => {
      const files = e.files.map((f) => join(folder, f)).filter((f) => existsSync(f)).map(mediaUrl);
      if (!files.length) return [];
      return [{
        id: `${relative(STUDIO_ROOT, folder)}/${key}`, where: relative(STUDIO_ROOT, folder), name: e.name, kind: e.kind,
        model: e.model, prompt: e.prompt, params: e.params ?? {}, cost: e.cost ?? null, generatedAt: e.generatedAt ?? null, files,
        references: (e.references ?? []).map((r) => join(folder, r.path)).filter((f) => existsSync(f)).map(mediaUrl),
      }];
    });
  });
}

export type LabMusicTrack = {
  id: string; project: string; name: string; url: string; duration: number; bpm: number; beats: number[];
  /** Set when this track is itself a fit of another: the seams it was cut at. */
  fit?: { source: string; seams: number[] };
};

/** Every track `studio music` has written to a project's music/manifest.json. */
function listMusicTracks(): LabMusicTrack[] {
  return subdirs(STUDIO_PROJECTS_DIR).flatMap((folder) => {
    const manifest = join(folder, 'music', 'manifest.json');
    if (!existsSync(manifest)) return [];
    const tracks = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, { file: string; duration: number; bpm: number; beats: number[]; fit?: { source: string; seams: number[] } }>;
    const project = relative(STUDIO_PROJECTS_DIR, folder);
    return Object.entries(tracks).filter(([, t]) => existsSync(join(folder, 'music', t.file))).map(([name, t]) => ({
      id: `${project}/${name}`, project, name, url: mediaUrl(join(folder, 'music', t.file)),
      duration: t.duration, bpm: t.bpm, beats: t.beats, ...(t.fit && { fit: { source: t.fit.source, seams: t.fit.seams } }),
    }));
  });
}

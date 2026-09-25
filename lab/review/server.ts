// review/server.ts: `studio review`, a page for pinning notes on one render or still, on the Studio Lab's stack. esbuild
// bundles lab/review/app (rebuilding on save); this server hands out that bundle, the reviewed file and review.json,
// the file's context read fresh from the artifacts its project already has (lib/review-notes.ts says which), and
// takes the page's one write: its notes, to review/notes-<render>.json, which an agent reads without the paste.
//
// Negative space: nothing here renders, measures or regenerates an artifact. A missing one is named in `missing`, so
// the page can say which note fields it can't fill and the command that would.
import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { readSfxCueList } from '../../lib/sfx/cue-module.ts';
import { sfxCuePlays } from '../../lib/sfx/cues.ts';
import { H, W } from '../../lib/studio/frame.ts';
import type { TimelineReport } from '../../lib/studio/Video.tsx';
import type { MotionTracks } from '../../lib/motion-tracks.ts';
import { REVIEW_NOTES_VERSION, reviewFrameAt, type ReviewMediaKind, type ReviewNote, type ReviewNotesFile, type ReviewScene, type ReviewSoundMarker } from '../../lib/review-notes.ts';
import { resolveStudioProject, STUDIO_ROOT } from '../../lib/studio-project.ts';
import { labBundleOptions } from '../bundle.ts';
import { sendFile } from '../server.ts';

const REVIEW_APP_DIR = join(STUDIO_ROOT, 'lab', 'review', 'app');
const MEDIA_TYPES: Record<string, { type: string; kind: ReviewMediaKind }> = {
  '.mp4': { type: 'video/mp4', kind: 'video' }, '.webm': { type: 'video/webm', kind: 'video' }, '.mov': { type: 'video/quicktime', kind: 'video' },
  '.png': { type: 'image/png', kind: 'still' }, '.jpg': { type: 'image/jpeg', kind: 'still' }, '.jpeg': { type: 'image/jpeg', kind: 'still' }, '.webp': { type: 'image/webp', kind: 'still' },
};
const BUNDLE_TYPES: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.map': 'application/json' };

/** What's under review: the file, the project it belongs to (if any) and where its notes go. */
export type ReviewTarget = { media: string; kind: ReviewMediaKind; project: string | null; notesFile: string };

/** review.json: the page's whole input. */
export type ReviewManifest = {
  title: string;
  media: { url: string; path: string; kind: ReviewMediaKind };
  /** The project's fps and frame count from its timeline; the page falls back to 30 fps and the file's length. */
  fps: number | null;
  durationInFrames: number | null;
  frameSize: { w: number; h: number };
  scenes?: ReviewScene[];
  sounds?: ReviewSoundMarker[];
  /** False when the cue list's markers are there but this render doesn't play it. */
  cueListPlayed?: boolean;
  motion?: MotionTracks;
  /** Each artifact a note field needs that isn't there, with how to make it. */
  missing: string[];
  notes: ReviewNote[];
  notesPath: string;
};

/** A render or still path, or a project (whose out/video.mp4 is reviewed). */
export function resolveReviewTarget(arg: string): ReviewTarget {
  const asPath = resolve(arg);
  const media = existsSync(asPath) && statSync(asPath).isFile() ? asPath : join(resolveStudioProject(arg), 'out', 'video.mp4');
  if (!existsSync(media)) throw new Error(`${relative(process.cwd(), media)} doesn't exist: render it first (studio render), or name a file`);
  const known = MEDIA_TYPES[extname(media).toLowerCase()];
  if (!known) throw new Error(`studio review takes ${Object.keys(MEDIA_TYPES).join(', ')}, not ${basename(media)}`);
  const project = projectHolding(media);
  // Named by its path in the project, less out/ and with folders joined by dots, so out/video.mp4, out/wip/video.mp4
  // and out/wip-video.mp4 keep separate notes. A file outside a project keeps its notes beside it.
  const home = project ?? dirname(media);
  const inProject = relative(home, media).replace(/^out\//, '');
  const notesFile = join(home, 'review', `notes-${inProject.slice(0, -extname(inProject).length).split(sep).join('.')}.json`);
  return { media, kind: known.kind, project, notesFile };
}

/** The nearest folder above a file with a video.tsx: a studio project. */
function projectHolding(file: string): string | null {
  for (let dir = dirname(file); dirname(dir) !== dir; dir = dirname(dir)) if (existsSync(join(dir, 'video.tsx'))) return dir;
  return null;
}

const readJson = <T,>(file: string): T | undefined => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : undefined);
/** A path from the repo root, or absolute for a file outside it. */
const fromRoot = (file: string) => (file.startsWith(STUDIO_ROOT + sep) ? relative(STUDIO_ROOT, file) : file);

export function buildReviewManifest(target: ReviewTarget): ReviewManifest {
  const { media, kind, project, notesFile } = target;
  const saved = readJson<ReviewNotesFile>(notesFile);
  const manifest: ReviewManifest = {
    title: basename(media),
    media: { url: `/media${extname(media).toLowerCase()}`, path: fromRoot(media), kind },
    fps: null, durationInFrames: null, frameSize: { w: W, h: H }, missing: [], notes: saved?.notes ?? [], notesPath: fromRoot(notesFile),
  };
  if (!project || kind === 'still') return manifest;

  const timeline = readJson<TimelineReport>(join(project, 'out', 'check', 'timeline.json'));
  const cueList = readSfxCueList(project);
  const motion = readJson<MotionTracks>(join(project, 'out', 'check', 'motion.json'));
  const check = `studio check ${basename(project)}`;
  if (timeline) {
    manifest.title = timeline.title;
    manifest.fps = timeline.fps;
    manifest.durationInFrames = timeline.durationInFrames;
    manifest.scenes = timeline.scenes.map(({ id, start, dur }) => {
      const from = timeline.crossfades.find((c) => c.to === id)?.start ?? start;
      const to = timeline.crossfades.find((c) => c.from === id)?.end ?? start + dur;
      return { id, start: from, dur: to - from };
    });
  } else manifest.missing.push(`out/check/timeline.json (scenes, the video's sounds): ${check}`);
  // A timeline from before it listed sounds says nothing about them, which isn't the same as having none.
  if (timeline && !timeline.sounds) manifest.missing.push(`the video's sounds in out/check/timeline.json, which predates them: ${check}`);
  const fps = manifest.fps ?? 30;
  if (timeline?.sounds || cueList) {
    manifest.sounds = [
      ...(timeline?.sounds ?? []).map((s) => ({ ...s, frame: reviewFrameAt(s.at, fps), source: 'video' as const })),
      ...(cueList ? sfxCuePlays(cueList) : []).map((c) => ({ id: c.id, at: c.at, frame: reviewFrameAt(c.at, fps), sound: c.sound.sound, source: 'cue-list' as const })),
    ].sort((a, b) => a.at - b.at);
  }
  if (cueList && timeline) manifest.cueListPlayed = timeline.sfxCueList;
  if (motion) manifest.motion = motion;
  else manifest.missing.push(`out/check/motion.json (what's under a point): ${check}`);
  return manifest;
}

export async function startStudioReview({ target, port }: { target: ReviewTarget; port: number }) {
  const outdir = mkdtempSync(join(tmpdir(), 'studio-review-'));
  const bundle = await esbuild.context({ ...labBundleOptions({ outdir, production: false }), entryPoints: [join(REVIEW_APP_DIR, 'main.tsx')] });
  await bundle.watch();
  const mediaUrl = `/media${extname(target.media).toLowerCase()}`;

  const server = createServer((req, res) => {
    const reply = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
    try {
      // As the lab's server: a DNS-rebinding page could otherwise read the replies.
      if (req.headers.host !== `localhost:${port}` && req.headers.host !== `127.0.0.1:${port}`) return void res.writeHead(403).end();
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://review').pathname);
      if (path === '/') return sendFile(req, res, join(REVIEW_APP_DIR, 'index.html'), 'text/html');
      if (path === '/favicon.ico') return void res.writeHead(204).end();
      if (path === '/review.json') return reply(200, buildReviewManifest(target));
      if (path === mediaUrl) return sendFile(req, res, target.media, MEDIA_TYPES[extname(target.media).toLowerCase()].type);
      if (path === '/api/notes') {
        // A cross-site form can post text/plain without a preflight; only this page's fetch sends JSON.
        if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) return reply(405, { error: 'POST application/json' });
        readBody(req).then((body) => reply(200, saveReviewNotes(target, body))).catch((error) => reply(400, { error: (error as Error).message }));
        return;
      }
      const built = join(outdir, path);
      const type = BUNDLE_TYPES[extname(built)];
      if (built.startsWith(outdir + sep) && type && existsSync(built)) return sendFile(req, res, built, type);
      res.writeHead(404).end();
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise<void>((done, fail) => server.once('error', fail).listen(port, '127.0.0.1', done));
  return { url: `http://localhost:${port}/`, close: async () => { server.close(); await bundle.dispose(); } };
}

function saveReviewNotes(target: ReviewTarget, body: unknown): { savedTo: string; saved: string } {
  const { notes, fps } = (body ?? {}) as { notes?: unknown; fps?: unknown };
  if (!Array.isArray(notes)) throw new Error('expected { notes: [...] }');
  const file: ReviewNotesFile = {
    version: REVIEW_NOTES_VERSION, media: fromRoot(target.media), kind: target.kind,
    ...(target.kind === 'video' && typeof fps === 'number' && { fps }), saved: new Date().toISOString(), notes: notes.map(checkedNote),
  };
  mkdirSync(dirname(target.notesFile), { recursive: true });
  writeFileSync(target.notesFile, JSON.stringify(file, null, 2) + '\n');
  return { savedTo: fromRoot(target.notesFile), saved: file.saved };
}

/** The note rebuilt from its known fields, so nothing but a note reaches the file an agent reads. */
function checkedNote(posted: unknown): ReviewNote {
  const n = (posted ?? {}) as Record<string, unknown>;
  if (typeof n.id !== 'string' || typeof n.text !== 'string') throw new Error('a note needs a string id and text');
  const number = (key: string, min: number, max: number) => {
    if (n[key] === undefined) return {};
    if (typeof n[key] !== 'number' || !(n[key] >= min && n[key] <= max)) throw new Error(`note ${n.id}: ${key} must be a number from ${min} to ${max}`);
    return { [key]: n[key] };
  };
  if ((n.end !== undefined && !(typeof n.frame === 'number' && typeof n.end === 'number' && n.end >= n.frame)) || (n.x === undefined) !== (n.y === undefined)) {
    throw new Error(`note ${n.id}: an end needs a frame at or before it, and x and y come together`);
  }
  return {
    id: n.id, ...number('frame', 0, Infinity), ...number('end', 0, Infinity), ...number('x', 0, 1), ...number('y', 0, 1),
    ...(typeof n.cue === 'string' && { cue: n.cue }), text: n.text, context: checkedContext(n.context, n.id),
  };
}

/** The context's three lists, each dropped unless it's the shape formatReviewNotesMarkdown reads. */
function checkedContext(posted: unknown, id: string): ReviewNote['context'] {
  if (posted === undefined) return {};
  if (typeof posted !== 'object' || posted === null) throw new Error(`note ${id}: context must be an object`);
  const { scenes, sounds, elements } = posted as Record<string, unknown>;
  const listOf = (v: unknown, ok: (item: Record<string, unknown>) => boolean) => v === undefined || (Array.isArray(v) && v.every((i) => typeof i === 'object' && i !== null && ok(i)));
  if (!(scenes === undefined || (Array.isArray(scenes) && scenes.every((s) => typeof s === 'string')))
    || !listOf(sounds, (s) => typeof s.id === 'string' && typeof s.sound === 'string' && typeof s.frame === 'number')
    || !listOf(elements, (e) => typeof e.id === 'string')) throw new Error(`note ${id}: context isn't scenes, sounds and elements lists`);
  return posted as ReviewNote['context'];
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((done, failed) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (text += chunk));
    req.on('end', () => {
      try {
        done(JSON.parse(text));
      } catch {
        failed(new Error('the body is not JSON'));
      }
    });
    req.on('error', failed);
  });
}

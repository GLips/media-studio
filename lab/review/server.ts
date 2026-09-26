// review/server.ts: `studio review`, a page for pinning notes on a render or still, on the Studio Lab's stack. esbuild
// bundles lab/review/app (rebuilding on save); this server hands out that bundle, the reviewed file and review.json,
// the file's context read fresh from its own snapshot and the project's cue list (lib/models/review/review-notes.ts says which), and
// takes the page's one write: its notes, to review/notes-<render>.json, which an agent reads without the paste.
//
// A render is re-rendered over its own path, so the path alone doesn't say what was reviewed. Each file is stamped
// with a hash of its bytes: the media URL carries it and stops serving once the file changes, the page polls
// /api/render to warn when it has, and each note records the hash it was written on.
//
// Negative space: nothing here renders, measures or regenerates an artifact. A missing one is named in `missing`, so
// the page can say which note fields it can't fill and the command that would.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { readSfxCueList } from '../../lib/sfx/cue-module.ts';
import { sfxCuePlays } from '../../lib/sfx/cues.ts';
import { H, W } from '#models/frame/frame.ts';
import type { MotionTracks } from '#models/motion/motion-tracks.ts';
import { reviewTimingOf, type ReviewTiming } from '#models/review/review-moment.ts';
import { placeReviewNotes, REVIEW_NOTES_VERSION, reviewFrameAt, type ReviewMediaKind, type ReviewNote, type ReviewNotesFile, type ReviewRenderStamp, type ReviewScene, type ReviewSoundMarker, type ReviewStillCell, type ReviewStillCellsFile } from '#models/review/review-notes.ts';
import { resolveStudioProject, STUDIO_ROOT } from '../../lib/engine/project/studio-project.ts';
import { loadRenderSnapshot, renderFileStamp } from '../../lib/engine/snapshot/render-snapshot.ts';
import { watchLabPage } from '../../lib/engine/bundle/lab-bundle.ts';
import { sendFile } from '../server.ts';

const REVIEW_APP_DIR = join(STUDIO_ROOT, 'lab', 'review', 'app');
const MEDIA_TYPES: Record<string, { type: string; kind: ReviewMediaKind }> = {
  '.mp4': { type: 'video/mp4', kind: 'video' }, '.webm': { type: 'video/webm', kind: 'video' }, '.mov': { type: 'video/quicktime', kind: 'video' },
  '.png': { type: 'image/png', kind: 'still' }, '.jpg': { type: 'image/jpeg', kind: 'still' }, '.jpeg': { type: 'image/jpeg', kind: 'still' }, '.webp': { type: 'image/webp', kind: 'still' },
};
const BUNDLE_TYPES: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.map': 'application/json' };

/** What's under review: the file, the project it belongs to (if any) and where its notes go. */
export type ReviewTarget = { media: string; kind: ReviewMediaKind; project: string | null; notesFile: string };

/** A render the page can switch to: its path from the repo root, its path in the project (`name`) and its mtime. */
export type ReviewRenderListing = { path: string; name: string; modified: string };

/** /api/render: the reviewed file as it is on disk now, and every render beside it, newest first. */
export type ReviewRenderStatus = { render: ReviewRenderStamp; renders: ReviewRenderListing[] };

/** review.json: the page's whole input. */
export type ReviewManifest = ReviewRenderStatus & {
  title: string;
  /** `url` holds `render.hash`: once the file changes it stops serving rather than hand the page the new bytes. */
  media: { url: string; path: string; kind: ReviewMediaKind };
  /** The render's fps and frame count from its snapshot; the page falls back to 30 fps and the file's length. */
  fps: number | null;
  durationInFrames: number | null;
  /**
   * The video's frame that the render's first frame is: past 0 for a slice (`studio render --frames`). Scenes, sounds
   * and note frames are on the render's own clock, from its first frame.
   */
  startsAt: number | null;
  frameSize: { w: number; h: number };
  scenes?: ReviewScene[];
  sounds?: ReviewSoundMarker[];
  /** False when the cue list's markers are there but this render doesn't play it. */
  cueListPlayed?: boolean;
  motion?: MotionTracks;
  /** The render's scenes, beats, cues and words, from its snapshot: where a note's moment is read and placed. */
  timing?: ReviewTiming;
  /** On a variant sheet (`studio still --sheet`), its cells, from the .cells.json beside it. */
  cells?: ReviewStillCell[];
  /** Each artifact a note field needs that isn't there, with how to make it. */
  missing: string[];
  notes: ReviewNote[];
  notesPath: string;
};

/** A render or still path, or a project, whose newest render is reviewed. */
export function resolveReviewTarget(arg: string): ReviewTarget {
  const asPath = resolve(arg);
  if (existsSync(asPath) && statSync(asPath).isFile()) return reviewTargetOf(asPath);
  const project = resolveStudioProject(arg);
  const newest = listReviewRenders(project)[0];
  if (!newest) throw new Error(`${relative(process.cwd(), join(project, 'out'))} has no render: render it first (studio render), or name a file`);
  return reviewTargetOf(newest.file);
}

/** The target for a file named exactly: its kind, its project and its notes file. */
function reviewTargetOf(media: string): ReviewTarget {
  if (!existsSync(media)) throw new Error(`${fromRoot(media)} is gone from disk`);
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

/**
 * A project's renders, newest first: the video files directly in out/ and out/wip/. Negative space: deeper folders
 * (out/wip/bars, out/reel, out/storyboard) hold pieces and passes of a cut, not the cut, so they're not offered.
 */
export function listReviewRenders(project: string): { file: string; modified: Date }[] {
  return ['out', join('out', 'wip')].flatMap((folder) => {
    const dir = join(project, folder);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && MEDIA_TYPES[extname(e.name).toLowerCase()]?.kind === 'video')
      .map((e) => { const file = join(dir, e.name); return { file, modified: statSync(file).mtime }; });
  }).sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

function reviewRenderStatus(target: ReviewTarget): ReviewRenderStatus {
  const listed = target.project ? listReviewRenders(target.project) : [];
  // A file named outside out/ and out/wip/ is still offered, so the list always holds what's on screen.
  if (target.kind === 'video' && !listed.some((r) => r.file === target.media)) listed.push({ file: target.media, modified: statSync(target.media).mtime });
  return {
    render: renderFileStamp(target.media),
    renders: listed.sort((a, b) => b.modified.getTime() - a.modified.getTime())
      .map(({ file, modified }) => ({ path: fromRoot(file), name: relative(target.project ?? dirname(file), file), modified: modified.toISOString() })),
  };
}

/** The nearest folder above a file with a video.tsx or a stills.tsx: a studio project. */
function projectHolding(file: string): string | null {
  for (let dir = dirname(file); dirname(dir) !== dir; dir = dirname(dir)) if (existsSync(join(dir, 'video.tsx')) || existsSync(join(dir, 'stills.tsx'))) return dir;
  return null;
}

const readJson = <T,>(file: string): T | undefined => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : undefined);
/** A path from the repo root, or absolute for a file outside it. */
const fromRoot = (file: string) => (file.startsWith(STUDIO_ROOT + sep) ? relative(STUDIO_ROOT, file) : file);

export function buildReviewManifest(target: ReviewTarget): ReviewManifest {
  const { media, kind, project, notesFile } = target;
  const saved = readJson<ReviewNotesFile>(notesFile);
  const status = reviewRenderStatus(target);
  const manifest: ReviewManifest = {
    ...status,
    title: basename(media),
    media: { url: `/media${extname(media).toLowerCase()}?${new URLSearchParams({ media: fromRoot(media), render: status.render.hash })}`, path: fromRoot(media), kind },
    fps: null, durationInFrames: null, startsAt: null, frameSize: { w: W, h: H }, missing: [], notes: saved?.notes ?? [], notesPath: fromRoot(notesFile),
  };
  if (kind === 'still') {
    const cells = readJson<ReviewStillCellsFile>(media.slice(0, -extname(media).length) + '.cells.json');
    if (cells) manifest.cells = cells.cells;
    return manifest;
  }
  if (!project) return manifest;

  // The render's own snapshot, never out/check: that's the latest check's, and this render may be from before it.
  const loaded = loadRenderSnapshot(media);
  const snapshot = loaded.kind === 'snapshot' ? loaded.snapshot : undefined;
  const cueList = readSfxCueList(project);
  if (loaded.kind === 'none') manifest.missing.push(`timeline for this render (scenes, sounds, what's under a point): ${loaded.reason}`);
  const fps = snapshot?.timeline.fps ?? 30;
  // Seconds and frames of the video, moved onto the render's clock: a slice starts `from` frames in.
  const from = snapshot?.frames.from ?? 0, end = snapshot?.frames.end ?? Infinity;
  const shift = from / fps, holds = (at: number) => at >= shift && at < end / fps;
  if (snapshot) {
    const { timeline } = snapshot;
    manifest.title = timeline.title;
    manifest.fps = fps;
    manifest.durationInFrames = snapshot.frames.end - from;
    manifest.startsAt = from;
    manifest.scenes = timeline.scenes.flatMap(({ id, start, dur, rung }) => {
      const first = Math.max(timeline.crossfades.find((c) => c.to === id)?.start ?? start, shift);
      const last = Math.min(timeline.crossfades.find((c) => c.from === id)?.end ?? start + dur, end / fps);
      // Under half a frame is a scene that only touches the slice's edge.
      return last - first > 0.5 / fps ? [{ id, start: first - shift, dur: last - first, ...(rung && { rung }) }] : [];
    });
    manifest.timing = reviewTimingOf({
      fps, startsAt: from, scenes: timeline.scenes, lines: timeline.cues, clock: snapshot.clock,
    });
    if (snapshot.motion) manifest.motion = snapshot.motion;
    else manifest.missing.push(`motion for what's under a point: only a delivered render (studio render) measures it`);
  }
  if (snapshot || cueList) {
    manifest.sounds = [
      ...(snapshot?.timeline.sounds ?? []).map((s) => ({ ...s, source: 'video' as const })),
      ...(cueList ? sfxCuePlays(cueList) : []).map((c) => ({ id: c.id, at: c.at, sound: c.sound.sound, source: 'cue-list' as const })),
    ].filter((s) => holds(s.at)).map((s) => ({ ...s, at: s.at - shift, frame: reviewFrameAt(s.at - shift, fps) })).sort((a, b) => a.at - b.at);
  }
  if (cueList && snapshot) manifest.cueListPlayed = snapshot.timeline.sfxCueList;
  if (manifest.timing && manifest.durationInFrames !== null) {
    manifest.notes = placeReviewNotes(manifest.notes, {
      render: status.render, durationInFrames: manifest.durationInFrames,
      sources: { fps, frameSize: manifest.frameSize, scenes: manifest.scenes, sounds: manifest.sounds, motion: manifest.motion, timing: manifest.timing },
    });
  }
  return manifest;
}

/**
 * Serves `target`, and any render beside it: the page names the file it's on with `?media=<path from the repo root>`,
 * and a path that isn't the target or one of its project's renders is refused.
 */
export async function startStudioReview({ target, port }: { target: ReviewTarget; port: number }) {
  const outdir = mkdtempSync(join(tmpdir(), 'studio-review-'));
  const bundle = await watchLabPage({ outdir, entry: join(REVIEW_APP_DIR, 'main.tsx') });
  const targetFor = (media: string | null): ReviewTarget => {
    if (!media) return target;
    const file = resolve(STUDIO_ROOT, media);
    if (file === target.media || (target.project && listReviewRenders(target.project).some((r) => r.file === file))) return reviewTargetOf(file);
    throw new Error(`not a render of this review: ${media}`);
  };

  const server = createServer((req, res) => {
    const reply = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
    try {
      // As the lab's server: a DNS-rebinding page could otherwise read the replies.
      if (req.headers.host !== `localhost:${port}` && req.headers.host !== `127.0.0.1:${port}`) return void res.writeHead(403).end();
      const url = new URL(req.url ?? '/', 'http://review');
      const path = decodeURIComponent(url.pathname);
      if (path === '/') return sendFile(req, res, join(REVIEW_APP_DIR, 'index.html'), 'text/html');
      if (path === '/favicon.ico') return void res.writeHead(204).end();
      if (path === '/review.json') return reply(200, buildReviewManifest(targetFor(url.searchParams.get('media'))));
      if (path === '/api/render') return reply(200, reviewRenderStatus(targetFor(url.searchParams.get('media'))));
      if (path.startsWith('/media.')) {
        const shown = targetFor(url.searchParams.get('media'));
        // The render the page loaded, or nothing: its buffered frames stay the old render's, never a splice of two.
        if (renderFileStamp(shown.media).hash !== url.searchParams.get('render')) return void res.writeHead(410, { 'content-type': 'text/plain' }).end('replaced on disk since the page loaded it');
        return sendFile(req, res, shown.media, MEDIA_TYPES[extname(shown.media).toLowerCase()].type);
      }
      if (path === '/api/notes') {
        // A cross-site form can post text/plain without a preflight; only this page's fetch sends JSON.
        if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) return reply(405, { error: 'POST application/json' });
        const shown = targetFor(url.searchParams.get('media'));
        readBody(req).then((body) => reply(200, saveReviewNotes(shown, body))).catch((error) => reply(400, { error: (error as Error).message }));
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
    ...(typeof n.cue === 'string' && { cue: n.cue }), ...(typeof n.render === 'string' && { render: n.render }),
    ...(typeof n.movedFrom === 'object' && n.movedFrom !== null && checkedMovedFrom(n.movedFrom, n.id)), ...(typeof n.unplaced === 'string' && { unplaced: n.unplaced }),
    text: n.text, context: checkedContext(n.context, n.id),
  };
}

function checkedMovedFrom(posted: object, id: string): Pick<ReviewNote, 'movedFrom'> {
  const { render, frame } = posted as Record<string, unknown>;
  if (typeof render !== 'string' || typeof frame !== 'number') throw new Error(`note ${id}: movedFrom needs the render and frame it was written on`);
  return { movedFrom: { render, frame } };
}

/** The context's cell and three lists, refused unless they're the shape formatReviewNotesMarkdown reads. */
function checkedContext(posted: unknown, id: string): ReviewNote['context'] {
  if (posted === undefined) return {};
  if (typeof posted !== 'object' || posted === null) throw new Error(`note ${id}: context must be an object`);
  const { cell, scenes, sounds, elements, moment } = posted as Record<string, unknown>;
  const m = moment as Record<string, unknown> | undefined;
  if (m !== undefined && !(typeof m === 'object' && m !== null && typeof m.scene === 'string' && typeof m.frames === 'number'
    && ['beat', 'word', 'scene'].includes(m.kind as string))) throw new Error(`note ${id}: context.moment isn't a scene, an anchor and frames past it`);
  const c = cell as Record<string, unknown> | undefined;
  if (c !== undefined && !(typeof c === 'object' && c !== null && typeof c.variant === 'string' && typeof c.refused === 'boolean'
    && typeof c.axes === 'object' && c.axes !== null && Object.values(c.axes).every((v) => typeof v === 'string'))) throw new Error(`note ${id}: context.cell isn't a variant, its axes and refused`);
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

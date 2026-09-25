// sfx-cue-api.ts: the Studio Lab's cue editor on the server. GET hands the browser a project's sfx/cues.json with
// the spoken words its rules need; POST saves the editor's changes to it exactly as `studio sfx draft` writes it
// (cues.json, then generated/sfx-cues.ts and its WAVs).
//
// The browser only ever changes a cue's edits (sound, nudge, volume). A POST's cues are matched to the file's by
// event id and only those three fields are taken, so a stale tab can't rewrite a draft or an event from under a redraft.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join, relative, sep } from 'node:path';
import { readSfxCueList, writeSfxCueList, writeSfxCueModule } from '../lib/sfx/cue-module.ts';
import type { SfxCue, SfxCueList } from '../lib/sfx/cues.ts';
import { resolveSfxParams, type SfxRequest } from '../lib/sfx/library.ts';
import type { TimelineReport } from '../lib/studio/Video.tsx';
import { STUDIO_PROJECTS_DIR, STUDIO_ROOT, resolveStudioProject } from '../lib/studio-project.ts';
import type { SpokenWord } from '../lib/voice-words.ts';

export type LabSfxCueScene = { id: string; start: number; end: number };

/** What the editor loads: the list, the words its rules judge accents against, and the video to play it over. */
export type LabSfxCuePayload = {
  project: string;
  list: SfxCueList;
  words: SpokenWord[];
  scenes: LabSfxCueScene[];
  duration: number;
  /** The rendered video's URL, or null when it hasn't been rendered. */
  video: string | null;
  /** A hash of cues.json as loaded: a save sends it back, and is refused if the file has changed since. */
  revision: string;
};

/** What the editor posts: its whole edit state, against the revision it loaded. */
export type LabSfxCueSave = { revision: string; list: SfxCueList };

const sfxCueRevision = (project: string) => createHash('sha256').update(readFileSync(join(project, 'sfx', 'cues.json'))).digest('hex').slice(0, 16);

class SfxCueRequestError extends Error {}
class SfxCueStaleError extends Error {}

/** Handles /api/sfx-cues, returning false for any other path. */
export function handleSfxCueApi(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  if (url.pathname !== '/api/sfx-cues') return false;
  const reply = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
  const fail = (error: unknown) => reply(error instanceof SfxCueRequestError ? 400 : error instanceof SfxCueStaleError ? 409 : 500, { error: error instanceof Error ? error.message : String(error) });
  try {
    const project = labSfxCueProject(url.searchParams.get('project') ?? '');
    if (req.method === 'GET') {
      reply(200, readLabSfxCuePayload(project));
    } else if (req.method === 'POST') {
      // A cross-site form can post text/plain without a preflight; only this page's fetch sends JSON.
      if (!req.headers['content-type']?.startsWith('application/json')) throw new SfxCueRequestError('POST application/json');
      readJsonBody(req).then((body) => reply(200, saveLabSfxCueEdits(project, body))).catch(fail);
    } else {
      reply(405, { error: 'GET or POST' });
    }
  } catch (error) {
    fail(error);
  }
  return true;
}

/** A project folder directly under projects/, never a path elsewhere (resolveStudioProject falls back to one). */
function labSfxCueProject(name: string): string {
  if (!name) throw new SfxCueRequestError('?project=<name> is required');
  let dir: string;
  try {
    dir = resolveStudioProject(name);
  } catch (error) {
    throw new SfxCueRequestError((error as Error).message);
  }
  if (dirname(dir) !== STUDIO_PROJECTS_DIR) throw new SfxCueRequestError(`${name} is not a project under projects/`);
  return dir;
}

function readLabSfxCuePayload(project: string): LabSfxCuePayload {
  const list = readSfxCueList(project);
  if (!list) throw new SfxCueRequestError(`${relative(STUDIO_ROOT, project)} has no sfx/cues.json: run studio sfx draft first`);
  const timelinePath = join(project, 'out', 'check', 'timeline.json');
  const timeline = existsSync(timelinePath) ? (JSON.parse(readFileSync(timelinePath, 'utf8')) as TimelineReport) : null;
  const videoPath = join(project, 'out', 'video.mp4');
  const lastCue = Math.max(0, ...list.cues.map((c) => c.event.at));
  return {
    project: relative(STUDIO_PROJECTS_DIR, project),
    list,
    words: timeline?.cues.flatMap((c) => c.words) ?? [],
    scenes: timeline?.scenes.map((s) => ({ id: s.id, start: s.start, end: s.start + s.dur })) ?? [],
    duration: timeline?.duration ?? lastCue + 2,
    revision: sfxCueRevision(project),
    video: existsSync(videoPath) ? `/media/${relative(STUDIO_ROOT, videoPath).split(sep).map(encodeURIComponent).join('/')}` : null,
  };
}

function saveLabSfxCueEdits(project: string, body: unknown): LabSfxCuePayload {
  const onDisk = readSfxCueList(project);
  if (!onDisk) throw new SfxCueRequestError('the project has no sfx/cues.json to save into');
  const { revision, list: posted } = (body ?? {}) as Partial<LabSfxCueSave>;
  if (revision !== sfxCueRevision(project)) throw new SfxCueStaleError('sfx/cues.json has changed since the editor loaded it: reload to see the new version (unsaved edits here are lost)');
  if (posted?.version !== 1 || !Array.isArray(posted.cues)) throw new SfxCueRequestError('expected a version 1 cue list with a cues array');
  const edits = new Map(posted.cues.map((c: Partial<SfxCue>) => [c.event?.id, c]));
  const same = edits.size === onDisk.cues.length && onDisk.cues.every((c) => edits.has(c.event.id));
  if (!same) throw new SfxCueRequestError('the cues are not the ones in sfx/cues.json (was it redrafted?): reload the editor');

  const cues = onDisk.cues.map(({ sound: _s, nudge: _n, volume: _v, ...cue }): SfxCue => {
    const edit = edits.get(cue.event.id)!, id = cue.event.id;
    return {
      ...cue,
      ...(edit.sound !== undefined && { sound: edit.sound === null ? null : checkedSfxRequest(edit.sound, id) }),
      ...(edit.nudge !== undefined && { nudge: checkedNumber(edit.nudge, -2, 2, `${id} nudge`) }),
      ...(edit.volume !== undefined && { volume: checkedNumber(edit.volume, 0, 4, `${id} volume`) }),
    };
  });
  writeSfxCueList(project, { ...onDisk, cues });
  writeSfxCueModule(project);
  return readLabSfxCuePayload(project);
}

/** The request rebuilt from its known fields, so nothing unchecked reaches cues.json or the WAV hash. */
function checkedSfxRequest(sound: unknown, id: string): SfxRequest {
  const posted = sound as Partial<Record<keyof SfxRequest, unknown>> | null;
  if (typeof posted?.sound !== 'string') throw new SfxCueRequestError(`${id}: sound must be null or { sound, … }`);
  const request: SfxRequest = { sound: posted.sound };
  if (posted.seed !== undefined) {
    if (typeof posted.seed !== 'string' && typeof posted.seed !== 'number') throw new SfxCueRequestError(`${id}: seed must be a string or number`);
    request.seed = posted.seed;
  }
  if (posted.mutate !== undefined) request.mutate = checkedNumber(posted.mutate, 0, 1, `${id} mutate`);
  if (posted.set !== undefined) {
    if (typeof posted.set !== 'object' || posted.set === null) throw new SfxCueRequestError(`${id}: set must be an object of numbers`);
    request.set = Object.fromEntries(Object.entries(posted.set).map(([k, v]) => [k, checkedNumber(v, -Infinity, Infinity, `${id} set.${k}`)]));
  }
  try {
    resolveSfxParams(request);
  } catch (error) {
    throw new SfxCueRequestError(`${id}: ${(error as Error).message}`);
  }
  return request;
}

function checkedNumber(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== 'number' || !(value >= min && value <= max)) throw new SfxCueRequestError(`${what} must be a number from ${min} to ${max}`);
  return value;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((done, failed) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (text += chunk));
    req.on('end', () => {
      try {
        done(JSON.parse(text));
      } catch {
        failed(new SfxCueRequestError('the body is not JSON'));
      }
    });
    req.on('error', failed);
  });
}

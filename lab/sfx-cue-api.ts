// sfx-cue-api.ts: the Studio Lab's cue editor on the server. GET hands the browser a project's sfx/cues.json with
// the spoken words its rules need; POST saves the editor's changes to it exactly as `studio sfx draft` writes it
// (cues.json, then generated/sfx-cues.ts and its WAVs).
//
// The browser only ever changes a cue's edits (sound, nudge, volume). A POST's cues are matched to the file's by
// event id and only those three fields are taken, so a stale tab can't rewrite a draft or an event from under a redraft.
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
};

class SfxCueRequestError extends Error {}

/** Handles /api/sfx-cues, returning false for any other path. */
export function handleSfxCueApi(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  if (url.pathname !== '/api/sfx-cues') return false;
  const reply = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
  const fail = (error: unknown) => reply(error instanceof SfxCueRequestError ? 400 : 500, { error: error instanceof Error ? error.message : String(error) });
  try {
    const project = labSfxCueProject(url.searchParams.get('project') ?? '');
    if (req.method === 'GET') {
      reply(200, readLabSfxCuePayload(project));
    } else if (req.method === 'POST') {
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
    video: existsSync(videoPath) ? `/media/${relative(STUDIO_ROOT, videoPath).split(sep).map(encodeURIComponent).join('/')}` : null,
  };
}

function saveLabSfxCueEdits(project: string, body: unknown): LabSfxCuePayload {
  const onDisk = readSfxCueList(project);
  if (!onDisk) throw new SfxCueRequestError('the project has no sfx/cues.json to save into');
  const posted = body as Partial<SfxCueList> | null;
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

function checkedSfxRequest(sound: unknown, id: string): SfxRequest {
  const request = sound as SfxRequest;
  if (typeof request?.sound !== 'string') throw new SfxCueRequestError(`${id}: sound must be null or { sound, … }`);
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

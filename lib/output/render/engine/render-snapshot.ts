// render-snapshot.ts: what a render was made from, written beside it, and the one loader that reads it back. Node only.
//
// Every video render writes <name>.snapshot.json beside it: its timeline, a timed project's clock, the frames it
// holds (a slice starts past 0), its voice, GPU and commits, and on a delivered render the motion its check measured.
// The snapshot names the render by a hash of its bytes, so a file re-rendered without one, or copied over, reads as
// having none rather than as the older render's.
//
// A reader of a render goes through loadRenderSnapshot, never out/check/timeline.json: that is `studio check`'s latest
// report, and says nothing about a render made before it.
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { sha256OfFile } from '#lib/platform/files/engine/file-sha256.ts';
import { gitState } from '#lib/platform/host/engine/hosts.ts';
import { STUDIO_ROOT, STUDIO_WORKSPACE_DIR, studioProjectOfFile } from '#lib/platform/project/engine/studio-project.ts';
import { isStudioWorkspaceRepo } from '#lib/platform/project/engine/studio-workspace.ts';
import { RENDER_SNAPSHOT_VERSION, type LoadedRenderSnapshot, type RenderFileStamp, type RenderSnapshot, type RenderSource } from '../models/render-snapshot-model.ts';

/** Both repos' commits as they are now. A render reads them as it starts, so a commit made while it draws isn't its. */
export function readRenderSource(): RenderSource {
  return { engine: gitState(STUDIO_ROOT), workspace: isStudioWorkspaceRepo() ? gitState(STUDIO_WORKSPACE_DIR) : null };
}

/** Where a render's snapshot lives: beside it, `<name>.snapshot.json`. */
export function renderSnapshotPath(render: string): string {
  return join(dirname(render), `${basename(render, extname(render))}.snapshot.json`);
}

const stamps = new Map<string, { key: string; stamp: RenderFileStamp }>();
/** The file's hash and mtime. Hashed again only when its mtime or size moves, so asking again costs a stat. */
export function renderFileStamp(file: string): RenderFileStamp {
  const { mtime, mtimeMs, size } = statSync(file);
  const key = `${mtimeMs}:${size}`;
  const cached = stamps.get(file);
  if (cached?.key === key) return cached.stamp;
  const stamp = { hash: sha256OfFile(file).slice(0, 10), modified: mtime.toISOString() };
  stamps.set(file, { key, stamp });
  return stamp;
}

/** `render`'s path inside its project, `/`-separated, or null for a file outside one. */
function renderPathInProject(render: string): string | null {
  const project = studioProjectOfFile(render);
  return project && relative(realpathSync(project), realpathSync(render)).split(sep).join('/');
}

/**
 * Writes `render`'s snapshot beside it, bound to its bytes as they are now. Call once the file is final. `source`
 * defaults to the commits now; a render that ran long (remote-render.ts) passes the ones it started from.
 */
export function writeRenderSnapshot(render: string, made: Pick<RenderSnapshot, 'frames' | 'started' | 'captions' | 'timeline' | 'clock' | 'voice' | 'gpu' | 'motion'> & { source?: RenderSource }): string {
  const { frames, started, captions, timeline, clock, voice, gpu, motion, source = readRenderSource() } = made;
  if (!(frames.from >= 0 && frames.end > frames.from && frames.end <= timeline.durationInFrames)) {
    throw new Error(`${basename(render)}: frames ${frames.from}–${frames.end - 1} aren't within the composition's 0–${timeline.durationInFrames - 1}`);
  }
  const snapshot: RenderSnapshot = {
    version: RENDER_SNAPSHOT_VERSION, render: { file: basename(render), path: renderPathInProject(render), hash: renderFileStamp(render).hash }, frames, started,
    made: new Date().toISOString(), captions, timeline, clock, voice, gpu, source, ...(motion && { motion }),
  };
  const path = renderSnapshotPath(render);
  writeFileSync(path, JSON.stringify(snapshot));
  return path;
}

/**
 * The snapshot `render` was made with. None when it has no snapshot, when the snapshot is of other bytes (the file
 * was replaced by something that wrote none), or when it's from an older version of this format.
 */
export function loadRenderSnapshot(render: string): LoadedRenderSnapshot {
  const path = renderSnapshotPath(render);
  const remake = 'render it again with studio render';
  if (!existsSync(path)) return { kind: 'none', reason: `${basename(render)} has no snapshot beside it (${basename(path)}): ${remake}` };
  const snapshot = JSON.parse(readFileSync(path, 'utf8')) as RenderSnapshot;
  if (snapshot.version !== RENDER_SNAPSHOT_VERSION) return { kind: 'none', reason: `${basename(path)} is snapshot version ${snapshot.version}, not ${RENDER_SNAPSHOT_VERSION}: ${remake}` };
  const { hash } = renderFileStamp(render);
  if (snapshot.render.hash !== hash) {
    return { kind: 'none', reason: `${basename(path)} is of render ${snapshot.render.hash}, and ${basename(render)} is now ${hash}, made without one: ${remake}` };
  }
  return { kind: 'snapshot', snapshot };
}

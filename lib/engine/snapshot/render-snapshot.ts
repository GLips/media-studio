// render-snapshot.ts: what a render was made from, written beside it, and the one loader that reads it back. Node only.
//
// Every video render writes <name>.snapshot.json beside <name>.mp4 (or .webm, or .mov): the timeline the composition laid out when it
// rendered, a timed project's resolved clock (its bars, beats, downbeats, cues and named moments), the composition frames the file holds (a slice starts past 0), and on a delivered render the motion its
// check measured. The snapshot names the render by a hash of its bytes, so a file re-rendered without one, or copied
// over, reads as having none rather than as the older render's.
//
// A reader of a render (review, the lab, `studio look --video`) goes through loadRenderSnapshot, never the project's
// out/check/timeline.json: that is `studio check`'s latest report, rewritten by every check, and says nothing about
// a render made before it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { MotionTracks } from '#models/motion/motion-tracks.ts';
import type { TimelineClockTable } from '#models/timeline/timeline.ts';
import type { TimelineReport } from '#studio/composition/Video.tsx';

export const RENDER_SNAPSHOT_VERSION = 5;

/** Which bytes a file is: `hash` is the first 10 hex digits of its SHA-256, `modified` its mtime as ISO. */
export type RenderFileStamp = { hash: string; modified: string };

export type RenderSnapshot = {
  version: typeof RENDER_SNAPSHOT_VERSION;
  /** The render's file name and the hash of its bytes when the snapshot was written. */
  render: { file: string; hash: string };
  /** The composition frames the render holds: its first frame is composition frame `from`; `end` is exclusive. */
  frames: { from: number; end: number };
  made: string;
  timeline: TimelineReport;
  /**
   * The project's resolved timeline as `studio clock` prints it, read when the render's session bundled the project,
   * or null for a project with no timeline.ts. A review note finds its bar and beat on it.
   */
  clock: TimelineClockTable | null;
  /** Every tracked element's motion, when the render path measured it (a delivered render's check does). */
  motion?: MotionTracks;
};

/** What a render's snapshot says, or why there's none to read. */
export type LoadedRenderSnapshot =
  | { kind: 'snapshot'; snapshot: RenderSnapshot }
  | { kind: 'none'; reason: string };

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
  const stamp = { hash: createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10), modified: mtime.toISOString() };
  stamps.set(file, { key, stamp });
  return stamp;
}

/** Writes `render`'s snapshot beside it, bound to its bytes as they are now. Call once the file is final. */
export function writeRenderSnapshot(render: string, made: { frames: RenderSnapshot['frames']; timeline: TimelineReport; clock: TimelineClockTable | null; motion?: MotionTracks }): string {
  const { frames, timeline, clock, motion } = made;
  if (!(frames.from >= 0 && frames.end > frames.from && frames.end <= timeline.durationInFrames)) {
    throw new Error(`${basename(render)}: frames ${frames.from}–${frames.end - 1} aren't within the composition's 0–${timeline.durationInFrames - 1}`);
  }
  const snapshot: RenderSnapshot = {
    version: RENDER_SNAPSHOT_VERSION, render: { file: basename(render), hash: renderFileStamp(render).hash }, frames,
    made: new Date().toISOString(), timeline, clock, ...(motion && { motion }),
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

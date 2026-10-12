// render-snapshot-model.ts: the shape of what a render was made from (render-snapshot.ts writes and reads it beside
// the render), and the pure facts read off one: whether it is a cut. Loads in plain Node, so the splice check and
// review's models can read a snapshot without the engine.
import type { MotionTracks } from '#lib/picture/measurement/models/motion-tracks.ts';
import type { TimelineReport } from '#lib/picture/video/models/timeline-report.ts';
import type { TimelineClockTable } from '#lib/timing/timeline/models/timeline.ts';
import type { RenderVoice } from '#lib/timing/voice/models/render-voice.ts';

export const RENDER_SNAPSHOT_VERSION = 12;

/** One repository's commit, and whether its working tree had changes then. */
export type RenderSourceCommit = { commit: string; dirty: boolean };

/** The studio's commit and the workspace's (null with no workspace repo) a render was made from. */
export type RenderSource = { engine: RenderSourceCommit; workspace: RenderSourceCommit | null };

/** Which bytes a file is: `hash` is the first 10 hex digits of its SHA-256, `modified` its mtime as ISO. */
export type RenderFileStamp = { hash: string; modified: string };

export type RenderSnapshot = {
  version: typeof RENDER_SNAPSHOT_VERSION;
  /**
   * The render's file name, its path inside its project (`out/video.mp4`; null outside one, as a remote piece in a temp
   * folder is), and the hash of its bytes when the snapshot was written. Review lists a path's versions by it.
   */
  render: { file: string; path: string | null; hash: string };
  /** The composition frames the render holds: its first frame is composition frame `from`; `end` is exclusive. */
  frames: { from: number; end: number };
  /**
   * When the render command began (ISO), its project read as of then. A slice is laid into a cut only when it started
   * after the cut did: finishing later says nothing of which saw the newer code.
   */
  started: string;
  /** When the file was finished (ISO). */
  made: string;
  /** Whether captions are burned into its picture: a slice is laid only into a cut that matches it. */
  captions: boolean;
  timeline: TimelineReport;
  /**
   * The project's resolved timeline as `studio clock` prints it, read when the render's session bundled the project,
   * or null for a project with no timeline.ts. A review note finds its bar and beat on it.
   */
  clock: TimelineClockTable | null;
  /** Whose voice it speaks in, as the project's audio was when it rendered: a review raises a banner on `draft`. */
  voice: RenderVoice;
  /**
   * The GPU its frames were drawn on: WebGL's renderer and WebGPU's adapter, as render-browser.ts names them. Another
   * GPU rounds a painted frame differently, so a remote render's pieces from two are named together.
   */
  gpu: string;
  source: RenderSource;
  /** Every tracked element's motion, when the render path measured it (a delivered render's check does). */
  motion?: MotionTracks;
};

/** What a render's snapshot says, or why there's none to read. */
export type LoadedRenderSnapshot =
  | { kind: 'snapshot'; snapshot: RenderSnapshot }
  | { kind: 'none'; reason: string };

/**
 * Whether the render is a cut: the whole video, from frame 0 to the composition's end. Anything else is a slice, which
 * review lays into a cut (render-splice.ts) but never places notes on by default.
 */
export const renderSnapshotIsCut = ({ frames, timeline }: Pick<RenderSnapshot, 'frames' | 'timeline'>) =>
  frames.from === 0 && frames.end === timeline.durationInFrames;

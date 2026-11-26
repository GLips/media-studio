// review-artifact.ts: the shapes the review screen reads, which lib/output/review/engine/ fills from disk and the app draws:
// a project's reviewable files, and everything about one of them. Pure: the naming rule for a transparent pair lives
// here, so the engine and the screen agree on it. A file's threads are read apart, from review/review.json.
import type { MotionTracks } from '#lib/picture/measurement/models/motion-tracks.ts';
import type { RenderVoice } from '#lib/timing/voice/models/render-voice.ts';
import type { ReviewTiming } from './review-moment.ts';
import type { ReviewMediaKind, ReviewRenderStamp, ReviewScene, ReviewSoundMarker, ReviewStillCell } from './review-context.ts';
import type { ReviewStoryboardCard, ReviewTimingMarks } from './review-storyboard.ts';
import type { ReviewSpeechCleanup } from './review-speech.ts';

/**
 * What a file the project holds beyond its renders and stills is, read from the record its maker keeps beside it.
 * `cost` is in US dollars, null where the provider didn't say.
 */
export type ProjectMade =
  /** Footage `studio gen video` made for a previs scene from `blockout`; `plays` while the scene plays this take. */
  | { as: 'footage'; scene: string; plays: boolean; blockout: string | null; model: string; cost: number | null }
  /** An image `studio gen image` made, listed as images[name]. */
  | { as: 'image'; name: string; model: string; cost: number | null }
  /** A picture the project keeps in assets/ (a plate, a logo). */
  | { as: 'asset' }
  /** A track in music/ as `studio music` measured it; `fitOf` names the track a fit was cut from. */
  | { as: 'music'; name: string; seconds: number; bpm: number; lufs: number; model: string | null; cost: number | null; fitOf: string | null }
  /** A scene rendered alone (`studio render --scene`), the newest of it. */
  | { as: 'scene-render'; scene: string };

/**
 * A reviewable file. `pair` names the other encoding of the same transparent delivery (video.webm beside
 * video-hevc.mov): the two are kept apart (each has its own bytes and snapshot) and shown side by side. `made` says
 * what made a file that isn't a render or a still in out/.
 */
export type ProjectArtifact = { path: string; kind: ReviewMediaKind; modified: string; pair?: string; made?: ProjectMade };

/**
 * True for a render of the project's composition, in out/: a video note on one places on every render by its moment.
 * Anything else (generated footage, music, an asset) is its own file, and only its own notes place on it.
 */
export const reviewPathIsRender = (path: string) => path.startsWith('out/');

/** `<stem>.webm` ↔ `<stem>-hevc.mov`, the two files studio render writes for a transparent video. */
export function transparentPairOf(path: string): string | undefined {
  const ext = path.slice(path.lastIndexOf('.')), stem = path.slice(0, -ext.length);
  if (ext === '.webm') return `${stem}-hevc.mov`;
  if (ext === '.mov' && stem.endsWith('-hevc')) return `${stem.slice(0, -'-hevc'.length)}.webm`;
  return undefined;
}

export type ReviewArtifact = {
  /** The bytes loaded. The file on disk now is the project pulse's, which never swaps this. */
  render: ReviewRenderStamp;
  project: string;
  /** The file's path in the project, e.g. `out/video.mp4`. */
  path: string;
  kind: ReviewMediaKind;
  title: string;
  /** The render's fps and frame count from its snapshot; the screen falls back to 30 fps and the file's length. */
  fps: number | null;
  durationInFrames: number | null;
  /**
   * The video's frame that the render's first frame is: past 0 for a slice (`studio render --frames`). Scenes, sounds
   * and note frames are on the render's own clock, from its first frame.
   */
  startsAt: number | null;
  /** The render's frame in composition pixels, from its snapshot. Null without one: no motion to look under a point in. */
  frameSize: { w: number; h: number } | null;
  /** True for a render whose snapshot says it's transparent: the screen offers grounds to play it over. */
  transparent: boolean;
  /** Whose voice the render speaks in, from its snapshot; null without one or a voice. `draft` raises a banner. */
  voice: RenderVoice;
  scenes?: ReviewScene[];
  sounds?: ReviewSoundMarker[];
  /** False when the cue list's markers are there but this render doesn't play it. */
  cueListPlayed?: boolean;
  motion?: MotionTracks;
  timing?: ReviewTiming;
  storyboard?: ReviewStoryboardCard[];
  marks?: ReviewTimingMarks;
  /** What the cleanup of the render's recorded lines took out or left in, to restore or take out again. */
  speechCleanup?: ReviewSpeechCleanup;
  /** On a variant sheet (`studio still --sheet`), its cells, from the .cells.json beside it. */
  cells?: ReviewStillCell[];
  /** A delivered render's captions file (out/video.srt), for download. */
  srt?: string;
  /** What made a file that isn't a render or a still in out/ (generated footage, a music track). */
  made?: ProjectMade;
  /** The file this one was generated from, as compare offers it: footage's blockout. */
  reference?: { path: string; hash: string; label: string };
  /** Each artifact a note field needs that isn't there, with how to make it. */
  missing: string[];
};

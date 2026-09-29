// review-artifact.ts: the shapes the review screen reads, which lib/output/review/engine/ fills from disk and the app draws:
// a project's reviewable files, and everything about one of them. Pure: the naming rules for a transparent pair and a
// file's notes live here, so the engine and the screen agree on them.
import type { MotionTracks } from '#lib/picture/motion/models/motion-tracks.ts';
import type { RenderVoice } from '#lib/timing/voice/models/render-voice.ts';
import type { ReviewTiming } from './review-moment.ts';
import type { ReviewMediaKind, ReviewNote, ReviewRenderStamp, ReviewScene, ReviewSoundMarker, ReviewStillCell } from './review-notes.ts';
import type { ReviewStoryboardCard, ReviewTimingMarks } from './review-storyboard.ts';

/**
 * A reviewable file. `pair` names the other encoding of the same transparent delivery (video.webm beside
 * video-hevc.mov): the two are kept apart (each has its own bytes, snapshot and notes) and shown side by side.
 */
export type ProjectArtifact = { path: string; kind: 'video' | 'still'; modified: string; pair?: string };

/** A project folder under work/projects/ with what it has made, for the app's front page. */
export type ProjectListing = { project: string; artifacts: ProjectArtifact[] };

/** `<stem>.webm` ↔ `<stem>-hevc.mov`, the two files studio render writes for a transparent video. */
export function transparentPairOf(path: string): string | undefined {
  const ext = path.slice(path.lastIndexOf('.')), stem = path.slice(0, -ext.length);
  if (ext === '.webm') return `${stem}-hevc.mov`;
  if (ext === '.mov' && stem.endsWith('-hevc')) return `${stem.slice(0, -'-hevc'.length)}.webm`;
  return undefined;
}

/**
 * The file a project opens on: its newest, and of a transparent pair the encoding this browser plays with alpha, the
 * HEVC .mov where QuickTime plays (Safari) and the WebM elsewhere. Undefined when the project has made nothing.
 */
export function landingArtifactOf(artifacts: readonly ProjectArtifact[], { playsQuickTime }: { playsQuickTime: boolean }): ProjectArtifact | undefined {
  const newest = artifacts[0];
  if (!newest?.pair || newest.path.endsWith('.mov') === playsQuickTime) return newest;
  return artifacts.find((a) => a.path === newest.pair) ?? newest;
}

/** The name a file's notes go under: its path in the project less out/, folders joined by dots, no extension. */
export function reviewNotesPathOf(path: string): string {
  const inOut = path.replace(/^out\//, '');
  return `review/notes-${inOut.slice(0, -inOut.slice(inOut.lastIndexOf('.')).length).split('/').join('.')}.json`;
}

/** The file on disk now, and every artifact beside it: polled apart from the loaded review, which never swaps. */
export type ReviewArtifactStatus = { render: ReviewRenderStamp; artifacts: ProjectArtifact[] };

export type ReviewArtifact = ReviewArtifactStatus & {
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
  /** On a variant sheet (`studio still --sheet`), its cells, from the .cells.json beside it. */
  cells?: ReviewStillCell[];
  /** A delivered render's captions file (out/video.srt), for download. */
  srt?: string;
  /** Each artifact a note field needs that isn't there, with how to make it. */
  missing: string[];
  notes: ReviewNote[];
  /** Where the notes save, in the project. */
  notesPath: string;
};

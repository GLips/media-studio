// review-context.ts: what a note is about, read off the artifacts a project already has: the render's snapshot,
// sfx/cues.json, and on a still, a variant sheet's .cells.json. A source that's missing leaves its field off; one
// that's there and holds nothing near gives an empty list. Threads themselves are review-threads.ts.
import type { MotionTracks } from '#lib/picture/measurement/models/motion-tracks.ts';
import type { SceneRung } from '#lib/timing/timeline/models/scene-rung.ts';
import { reviewMomentAt, type ReviewMoment, type ReviewTiming } from './review-moment.ts';
import { formatReviewClock } from './review-timeline-geometry.ts';

/** How close, in frames, a sound must land to a note for the note to name it. */
export const REVIEW_SOUND_REACH_FRAMES = 3;

export type ReviewMediaKind = 'video' | 'still';

/** A sound the render plays, as a marker under the scrubber: from `defineVideo({ sounds })` or the cue list. */
export type ReviewSoundMarker = { id: string; at: number; frame: number; sound: string; source: 'video' | 'cue-list' };

/** A scene's visible frames on the render, its crossfades included (`to` exclusive), so a note in a dissolve names both scenes. */
export type ReviewScene = { id: string; from: number; to: number; rung?: SceneRung };

/**
 * One cell of a variant sheet (`studio still --sheet`), from the `.cells.json` beside it: the variant, where it sits on
 * each axis, and whether the still check refused it. `rect` is 0–1 across the sheet.
 */
export type ReviewStillCell = { variant: string; axes: Readonly<Record<string, string>>; refused: boolean; rect: { x: number; y: number; w: number; h: number } };
export type ReviewStillCellsFile = { version: 1; cells: ReviewStillCell[] };

/** What a note says about its moment. Each field is absent when its source artifact is. */
export type ReviewNoteContext = {
  /** On a variant sheet, the cell under the point. */
  cell?: { variant: string; axes: Readonly<Record<string, string>>; refused: boolean };
  scenes?: string[];
  sounds?: { id: string; sound: string; frame: number; targeted?: true }[];
  /** The motion-tagged elements under the point, smallest first. */
  elements?: { id: string; kind?: string }[];
  /** Its (first) frame's place in the video's structure, read off the render it was written on. */
  moment?: ReviewMoment;
};

/**
 * Which render a file is: a re-render to the same path keeps the path and changes the hash. `hash` is the first 10
 * hex digits of the file's SHA-256, `modified` its mtime as ISO.
 */
export type ReviewRenderStamp = { hash: string; modified: string };

/** Where a note sits for its context: a frame (and range end) on a video, a 0–1 point, the sound marker aimed at. */
export type ReviewNotePlace = { frame?: number; end?: number; x?: number; y?: number; cue?: string };

export type ReviewContextSources = {
  fps: number;
  /** The frame in composition pixels, which the motion tracks measure in; null where there's no snapshot to say. */
  frameSize: { w: number; h: number } | null;
  scenes?: readonly ReviewScene[];
  sounds?: readonly ReviewSoundMarker[];
  motion?: MotionTracks;
  cells?: readonly ReviewStillCell[];
  /** The render's structure, from its snapshot, for the note's moment. */
  timing?: ReviewTiming;
};

/** The frame a moment in video seconds shows. The epsilon keeps a sound placed on a frame from rounding to the one before. */
/** The fps a render without a snapshot is counted at: the page plays it and the hand-off numbers its frames by it. */
export const REVIEW_FALLBACK_FPS = 30;

export const reviewFrameAt = (seconds: number, fps: number) => Math.floor(seconds * fps + 1e-6);

export function reviewNoteContext(note: ReviewNotePlace, sources: ReviewContextSources): ReviewNoteContext {
  if (note.frame === undefined) {
    const { x, y } = note;
    const hit = x === undefined || y === undefined ? undefined
      : sources.cells?.find(({ rect: r }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    return hit ? { cell: { variant: hit.variant, axes: hit.axes, refused: hit.refused } } : {};
  }
  const first = note.frame, last = note.end ?? note.frame;
  const context: ReviewNoteContext = {};
  if (sources.scenes) {
    context.scenes = sources.scenes.filter((s) => s.from <= last && s.to > first).map((s) => s.id);
  }
  if (sources.sounds) {
    const reach = REVIEW_SOUND_REACH_FRAMES;
    context.sounds = sources.sounds
      .filter((s) => s.id === note.cue || (s.frame >= first - reach && s.frame <= last + reach))
      .map((s) => ({ id: s.id, sound: s.sound, frame: s.frame, ...(s.id === note.cue && { targeted: true as const }) }));
  }
  if (sources.timing) {
    const moment = reviewMomentAt(first + sources.timing.startsAt, sources.timing);
    if (moment) context.moment = moment;
  }
  if (sources.motion && sources.frameSize && note.x !== undefined && note.y !== undefined) {
    context.elements = reviewElementsUnder(sources.motion, first, note.x * sources.frameSize.w, note.y * sources.frameSize.h, sources.frameSize);
  }
  return context;
}

/**
 * The tagged elements whose box holds the point on `frame`, smallest first, at most three. Cameras and anything
 * nearly frame-filling are left out: they're under every point, so naming them says nothing.
 */
export function reviewElementsUnder(motion: MotionTracks, frame: number, px: number, py: number, frameSize: { w: number; h: number }) {
  const hits: { id: string; kind?: string; area: number }[] = [];
  for (const track of motion.tracks) {
    if (track.kind === 'camera') continue;
    const segment = track.segments.find((s) => s.start <= frame && frame <= s.end);
    if (!segment) continue;
    const i = frame - segment.start, { x, y, w, h, opacity } = segment.screen;
    if (!(opacity[i] > 0.05 && w[i] > 0 && h[i] > 0) || w[i] * h[i] > 0.9 * frameSize.w * frameSize.h) continue;
    if (Math.abs(px - x[i]) <= w[i] / 2 && Math.abs(py - y[i]) <= h[i] / 2) hits.push({ id: track.id, kind: track.kind, area: w[i] * h[i] });
  }
  return hits.toSorted((a, b) => a.area - b.area).slice(0, 3).map(({ id, kind }) => (kind ? { id, kind } : { id }));
}

/** `headline short, crop card`: a variant by its place on each axis. */
export const formatStillAxes = (axes: Readonly<Record<string, string>>) => Object.entries(axes).map(([a, v]) => `${a} ${v}`).join(', ');

/** `f304 (0:10.13)`: the frame, then minutes, seconds and hundredths, so a timecode reads as video time. */
export function formatReviewMoment(frame: number, fps: number): string {
  return `f${frame} (${formatReviewClock(frame / fps)})`;
}

// review-timeline-geometry.ts: where a frame sits across the review dock's lanes and which frame a pointer is over, at
// any zoom. The dock, its lanes and the playhead draw from this one model, so a press lands on the frame it shows.
//
// A frame owns the span [x, x + framePx): a press anywhere in it is that frame, and the playhead sits at its middle.

/** What the lanes show: the whole render at zoom 1, a part of it from `start` when zoomed in. */
export type ReviewTimelineView = {
  durationInFrames: number;
  /** The lanes' width in px, the gutter left out. */
  width: number;
  /** 1 fits the render to the width; 2 shows half of it. */
  zoom: number;
  /** The frame at the lanes' left edge, fractional while zoomed. */
  start: number;
};

/**
 * A render's waveform as the sound lane draws it: the loudest sample (0–1) in each slice of `perSecond` slices a
 * second. review-peaks.ts cuts it; no peaks means the render is silent.
 */
export type ReviewPeaks = { hash: string; perSecond: number; peaks: number[] };

/** One character of the lanes' mono xs readout, for whether a label fits where it would be drawn. */
export const REVIEW_READOUT_CHAR_PX = 6.6;
/** The widest a frame is drawn: past this a zoom shows nothing new. */
const REVIEW_TIMELINE_MAX_FRAME_PX = 32;
/** The least room between two timecode labels on the ruler. */
const REVIEW_RULER_LABEL_PX = 64;
/** Beats closer than this thin to their downbeats. */
const REVIEW_RULER_BEAT_PX = 5;
/** Float error in a frame worked back from a pixel, so a frame's own left edge stays that frame. */
const REVIEW_FRAME_EPSILON = 1e-6;

export const reviewTimelineFit = (durationInFrames: number, width: number): ReviewTimelineView =>
  ({ durationInFrames: Math.max(1, durationInFrames), width: Math.max(1, width), zoom: 1, start: 0 });

export const reviewTimelineFramePx = (view: ReviewTimelineView) => (view.width * view.zoom) / view.durationInFrames;

/** How many frames the lanes show at once. */
export const reviewTimelineVisibleFrames = (view: ReviewTimelineView) => view.durationInFrames / view.zoom;

export const reviewTimelineMaxZoom = (view: Pick<ReviewTimelineView, 'durationInFrames' | 'width'>) =>
  Math.max(1, (REVIEW_TIMELINE_MAX_FRAME_PX * view.durationInFrames) / view.width);

/** The left edge of `frame`'s span, in px from the lanes' left. */
export const reviewTimelineXOf = (view: ReviewTimelineView, frame: number) => (frame - view.start) * reviewTimelineFramePx(view);

/** The whole frame under `x`, held to the render. */
export function reviewTimelineFrameAt(view: ReviewTimelineView, x: number): number {
  const frame = Math.floor(view.start + x / reviewTimelineFramePx(view) + REVIEW_FRAME_EPSILON);
  return Math.max(0, Math.min(view.durationInFrames - 1, frame));
}

/** The span of frames `from` to `to` (exclusive) on the lanes, or null when none of it is in view. */
export function reviewTimelineSpan(view: ReviewTimelineView, from: number, to: number): { x: number; w: number } | null {
  const x = reviewTimelineXOf(view, from), w = (to - from) * reviewTimelineFramePx(view);
  return x + w < 0 || x > view.width ? null : { x, w };
}

function withStart(view: ReviewTimelineView, start: number): ReviewTimelineView {
  const last = view.durationInFrames - reviewTimelineVisibleFrames(view);
  return { ...view, start: Math.max(0, Math.min(last, start)) };
}

/** Zoomed to `zoom`, keeping the frame under `x` under it: Mod+wheel at the pointer, `-` and `=` at the playhead. */
export function reviewTimelineZoomedAt(view: ReviewTimelineView, zoom: number, x: number): ReviewTimelineView {
  const held = view.start + x / reviewTimelineFramePx(view);
  const next = { ...view, zoom: Math.max(1, Math.min(reviewTimelineMaxZoom(view), zoom)) };
  return withStart(next, held - x / reviewTimelineFramePx(next));
}

export const reviewTimelineScrolledBy = (view: ReviewTimelineView, px: number) =>
  withStart(view, view.start + px / reviewTimelineFramePx(view));

/** Panned so `frame` is at the middle of the lanes, as a press on the overview strip asks. */
export const reviewTimelineCenteredOn = (view: ReviewTimelineView, frame: number) =>
  withStart(view, frame - reviewTimelineVisibleFrames(view) / 2);

/** A new width (the window, the thread folding) keeps the zoom and the left edge's frame. */
export const reviewTimelineResized = (view: ReviewTimelineView, width: number) =>
  withStart({ ...view, width: Math.max(1, width), zoom: Math.min(view.zoom, reviewTimelineMaxZoom({ ...view, width })) }, view.start);

/** A new length (the file's metadata arriving) refits: the old view was of a guess. */
export const reviewTimelineRelengthed = (view: ReviewTimelineView, durationInFrames: number) =>
  view.durationInFrames === durationInFrames ? view : reviewTimelineFit(durationInFrames, view.width);

/** Paged so `frame` is in view, as playback turns the page once the playhead runs off it; unchanged when it's there. */
export function reviewTimelineShowing(view: ReviewTimelineView, frame: number): ReviewTimelineView {
  const visible = reviewTimelineVisibleFrames(view);
  if (frame >= view.start && frame + 1 <= view.start + visible) return view;
  return withStart(view, frame < view.start ? frame - visible + 1 : frame);
}

/** `0:04` on a whole second, else `0:04.53`, hundredths as the transport reads. */
export function formatReviewTimecode(frame: number, fps: number): string {
  return frame % fps === 0 ? formatReviewClock(frame / fps).slice(0, -3) : formatReviewClock(frame / fps);
}

/** `m:ss.cc`, every review screen's clock. Hundredths are floored, so a time never reads as the second after it. */
export function formatReviewClock(seconds: number): string {
  const hundredths = Math.floor(seconds * 100 + 1e-6), m = Math.floor(hundredths / 6000), rest = hundredths - m * 6000;
  return `${m}:${String(Math.floor(rest / 100)).padStart(2, '0')}.${String(rest % 100).padStart(2, '0')}`;
}

/** A mark on the ruler: a labelled timecode, or a beat (taller on the music's downbeats). */
export type ReviewRulerTick =
  | { kind: 'time'; frame: number; x: number; label: string }
  | { kind: 'downbeat' | 'beat'; frame: number; x: number };

/**
 * The label steps the ruler picks from, in frames: single frames up close, minutes far out. Under a second only the
 * half second, so labels don't land on thirds.
 */
function rulerStepsOf(fps: number): number[] {
  const seconds = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].map((s) => s * fps);
  return [...new Set([1, 2, 5, Math.round(fps / 2), ...seconds])].filter((step) => step >= 1).toSorted((a, b) => a - b);
}

/**
 * The ruler's ticks in view: a timecode every step that leaves its label room, and the music's beats, thinned to its
 * downbeats when the beats crowd.
 */
export function reviewRulerTicks(view: ReviewTimelineView, { fps, beats }: { fps: number; beats: readonly { frame: number; down: boolean }[] }): ReviewRulerTick[] {
  const framePx = reviewTimelineFramePx(view);
  const steps = rulerStepsOf(fps);
  const step = steps.find((s) => s * framePx >= REVIEW_RULER_LABEL_PX) ?? steps.at(-1) ?? fps;
  const first = Math.ceil(view.start / step) * step, last = view.start + reviewTimelineVisibleFrames(view);
  const times: ReviewRulerTick[] = [];
  for (let frame = first; frame <= last; frame += step) {
    times.push({ kind: 'time', frame, x: reviewTimelineXOf(view, frame), label: formatReviewTimecode(frame, fps) });
  }
  const spacing = Math.min(...beats.slice(1).map((b, i) => b.frame - beats[i].frame));
  const crowded = spacing * framePx < REVIEW_RULER_BEAT_PX;
  const beatTicks = beats
    .filter((b) => b.frame >= view.start && b.frame <= last && (b.down || !crowded))
    .map((b): ReviewRulerTick => ({ kind: b.down ? 'downbeat' : 'beat', frame: b.frame, x: reviewTimelineXOf(view, b.frame) }));
  return [...times, ...beatTicks];
}

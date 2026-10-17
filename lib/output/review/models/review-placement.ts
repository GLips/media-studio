// review-placement.ts: where a thread shows on what the reviewer has open, worked out each time it's read and never
// stored, so the render a note was written on (`writtenOn`) stays as written.
//
// A video note shows on every video render of the project: on its own render at its frame, on a cut a slice it was
// written on is laid into at the same picture, on another at its moment's frame there (review-moment.ts). A still note
// shows on its still's path. Decision and project threads show anywhere.
//
// Negative space: a plan note shows on no render. The plan page and the hand-off place it on the storyboard itself
// (review-plan.ts).
import type { ReviewArtifact } from './review-artifact.ts';
import { placeReviewMoment, reviewMomentAt, type ReviewTiming } from './review-moment.ts';
import type { NewAnchor } from './review-ops.ts';
import type { ReviewMediaKind } from './review-context.ts';
import type { ReviewPlanNotePlace } from './review-plan.ts';
import type { ReviewAnchor, ReviewThread } from './review-threads.ts';

/**
 * A video note's frame (and range end) on this render; a plan note's place on the plan, for the hand-off; placed with
 * no frame (a still's note, a decision's); or why it can't be placed. `shifted` says it landed elsewhere than written.
 */
export type ReviewPlacement =
  | { frame: number; end?: number; shifted: boolean }
  | { shifted: false; plan: ReviewPlanNotePlace }
  | { shifted: boolean }
  | { unplaced: string };

/** What's open: a render (`timing` from its snapshot, when it has one), or a still. */
export type ReviewPlacementTarget = {
  kind: ReviewMediaKind;
  hash: string;
  path: string;
  timing?: ReviewTiming;
  durationInFrames: number;
  /**
   * The slices laid into this cut (review-splices.ts), by hash, each with the composition frame it starts at. A note
   * written on one shows over that very picture, so it's placed by frame, never by moment.
   */
  splices?: readonly Pick<ReviewLaidSlice, 'hash' | 'startsAt'>[];
};

/**
 * A reply's slice laid into the cut over composition frames `from`–`end` (exclusive), where it's the newest slice; its
 * own frame 0 is composition frame `startsAt`. One slice gives two of these when a newer one covers its middle.
 * `thread` is the note whose reply brought it; `pictureOnly`, that it plays under the cut's older sound effects.
 */
export type ReviewLaidSlice = { thread: number; path: string; hash: string; from: number; end: number; startsAt: number; pictureOnly: boolean };
/** A reply's slice that won't lay into the cut, so it plays alone: `refusal` says why, after "won't splice:". */
export type ReviewRefusedSlice = { thread: number; path: string; hash: string; refusal: string };
/** The reply slices on the cut shown: those laid in, by the frames each wins, and those refused. */
export type ReviewSplices = { laid: ReviewLaidSlice[]; refused: ReviewRefusedSlice[] };

/**
 * Fitting slices, each with its whole span, as the frames each one shows: the newest (latest `started`) wins every
 * frame, and an older one survives only outside the newer ones' spans. In frame order.
 */
export function layReviewSlices(fitting: readonly (Omit<ReviewLaidSlice, 'startsAt'> & { started: string })[]): ReviewLaidSlice[] {
  const covered: { from: number; end: number }[] = [];
  const laid: ReviewLaidSlice[] = [];
  for (const { started: _started, ...slice } of fitting.toSorted((a, b) => b.started.localeCompare(a.started))) {
    let pieces = [{ from: slice.from, end: slice.end }];
    for (const c of covered) pieces = pieces.flatMap((p) => [{ from: p.from, end: Math.min(p.end, c.from) }, { from: Math.max(p.from, c.end), end: p.end }].filter((q) => q.end > q.from));
    for (const { from, end } of pieces) laid.push({ ...slice, from, end, startsAt: slice.from });
    covered.push({ from: slice.from, end: slice.end });
  }
  return laid.toSorted((a, b) => a.from - b.from);
}

/**
 * A new note on the cut, moved onto the slice whose frames hold it (its range's end too): it's about the fixed picture
 * the reviewer saw, so it's written on the slice, at the slice's own frames. `shown`: the laid slices on screen, since
 * `\` may show the cut bare.
 */
export function reviewAnchorOnLaidSlice<A extends Pick<ReviewVideoAnchor, 'frame' | 'end' | 'writtenOn'>>(anchor: A, shown: readonly ReviewLaidSlice[]): A {
  const last = anchor.end ?? anchor.frame;
  const slice = shown.find((s) => s.from <= anchor.frame && last < s.end);
  if (!slice) return anchor;
  return {
    ...anchor, frame: anchor.frame - slice.startsAt, ...(anchor.end !== undefined && { end: anchor.end - slice.startsAt }),
    writtenOn: { path: slice.path, hash: slice.hash },
  };
}

export type PlacedReviewThread = ReviewThread & { placement: ReviewPlacement };

/** Where `thread` shows on `target`, or null when it's about something else (another still, the plan). */
export function placeReviewThread(thread: ReviewThread, target: ReviewPlacementTarget): ReviewPlacement | null {
  const { anchor } = thread;
  switch (anchor.on) {
    case 'video': return target.kind === 'video' ? placeReviewVideoNote(anchor, target) : null;
    case 'still': return target.kind === 'still' && anchor.writtenOn.path === target.path ? { shifted: false } : null;
    case 'plan': return null;
    // About the cut as a whole ("is 24 s right?"): beside a video, where it's answered, and noise beside a still.
    case 'project': return target.kind === 'video' ? { shifted: false } : null;
  }
  // A decision thread is about no one frame or file.
  return { shifted: false };
}

function placeReviewVideoNote(anchor: Extract<ReviewAnchor, { on: 'video' }>, target: ReviewPlacementTarget): ReviewPlacement {
  const { writtenOn, moment } = anchor, last = target.durationInFrames - 1;
  if (writtenOn.hash === target.hash) return { frame: anchor.frame, ...(anchor.end !== undefined && { end: anchor.end }), shifted: false };
  const splice = target.splices?.find((s) => s.hash === writtenOn.hash);
  if (splice) {
    const by = splice.startsAt - (target.timing?.startsAt ?? 0);
    return { frame: anchor.frame + by, ...(anchor.end !== undefined && { end: anchor.end + by }), shifted: false };
  }
  if (!moment) return { unplaced: `${writtenOn.path} \`${writtenOn.hash}\` had no snapshot, so its moment wasn't kept` };
  if (!target.timing) return { unplaced: 'this render has no snapshot to place it by' };
  const placed = placeReviewMoment(moment, target.timing);
  if ('unplaced' in placed) return placed;
  const frame = placed.frame - target.timing.startsAt, shift = frame - anchor.frame;
  if (frame < 0 || frame > last) return { unplaced: `its moment falls on f${frame}, outside this render's f0–f${last}` };
  return { frame, ...(anchor.end !== undefined && { end: Math.min(anchor.end + shift, last) }), shifted: shift !== 0 };
}

export type ReviewVideoAnchor = Extract<NewAnchor, { on: 'video' }>;

/**
 * What a thread is about: a video, a still, the plan, or a decision (with `candidate`, that candidate). It lists
 * what's anchored there, on a render or still the project's own notes too, and on a candidate the whole decision's.
 */
export type ReviewThreadSubject = { on: ReviewAnchor['on']; decision?: number; candidate?: string };

export function reviewThreadsInScope(threads: readonly PlacedReviewThread[], { on, decision, candidate }: ReviewThreadSubject): PlacedReviewThread[] {
  return threads.filter(({ anchor }) => {
    if (anchor.on === 'decision') return on === 'decision' && anchor.decision === decision && (candidate === undefined || anchor.candidate === undefined || anchor.candidate === candidate);
    if (anchor.on === 'project') return on === 'video' || on === 'still';
    return anchor.on === on;
  });
}

/** A sound marker's name without the scene it's filed under, which the row already shows. */
export const reviewCueNameOf = (cue: string) => cue.slice(cue.lastIndexOf('/') + 1);

/** A placed thread's frame on the open render; undefined off a video or when unplaced. */
export const reviewThreadFrameOf = ({ placement }: PlacedReviewThread): number | undefined => ('frame' in placement ? placement.frame : undefined);

/** Placed notes in time order, then the rest by id: the order the thread lists, and `[` `]` step through. */
export function sortReviewThreadsByPlace(threads: readonly PlacedReviewThread[]): PlacedReviewThread[] {
  const rank = (t: PlacedReviewThread) => reviewThreadFrameOf(t) ?? Number.POSITIVE_INFINITY;
  return threads.toSorted((a, b) => rank(a) - rank(b) || a.id - b.id);
}

/** A video note's anchor at `frame` of the open render, with the moment that carries it to the next render. */
export function reviewVideoAnchorAt(artifact: Pick<ReviewArtifact, 'path' | 'render' | 'timing'>, frame: number): ReviewVideoAnchor {
  const { timing } = artifact;
  const moment = timing && reviewMomentAt(frame + timing.startsAt, timing);
  return { on: 'video', frame, writtenOn: { path: artifact.path, hash: artifact.render.hash }, ...(moment && { moment }) };
}

/** How far either side of a moment note `/` loops, in seconds: long enough to see it arrive and leave. */
const REVIEW_NOTE_LOOP_REACH_SECONDS = 1;

/** The `/` loop's note step: a range note's span, or a second either side of a moment note. */
export function reviewNoteLoopOf(thread: PlacedReviewThread, fps: number, durationInFrames: number): { from: number; to: number } | null {
  const { placement } = thread;
  if (!('frame' in placement)) return null;
  if (placement.end !== undefined && placement.end > placement.frame) return { from: placement.frame, to: placement.end };
  const reach = Math.round(REVIEW_NOTE_LOOP_REACH_SECONDS * fps);
  return { from: Math.max(0, placement.frame - reach), to: Math.min(durationInFrames - 1, placement.frame + reach) };
}

// review-placement.ts: where a thread shows on what the reviewer has open, worked out each time it's read and never
// stored, so the render a note was written on (`writtenOn`) stays as written.
//
// A video note shows on every video render of the project: on its own render at its frame, on another at its
// moment's frame there (review-moment.ts). A still note shows on its still's path. A script note shows on the script,
// on its line's same word. Decision and project threads show anywhere.
import type { ReviewArtifact } from './review-artifact.ts';
import { placeReviewMoment, placeReviewWord, reviewMomentAt, type ReviewTiming } from './review-moment.ts';
import type { NewAnchor } from './review-ops.ts';
import type { ReviewMediaKind } from './review-context.ts';
import { reviewScriptLineWords, type ReviewScriptLine } from './review-script.ts';
import type { ReviewAnchor, ReviewThread } from './review-threads.ts';

/**
 * A video note's frame (and range end) on this render; a script note's word; or why it can't be placed. `shifted`
 * says it landed elsewhere than it was written.
 */
export type ReviewPlacement =
  | { frame: number; end?: number; shifted: boolean }
  | { word?: number; wordEnd?: number; shifted: boolean }
  | { unplaced: string };

/**
 * What's open: a render (`timing` from its snapshot, when it has one), a still, or the voice take, with the script's
 * lines where it's shown.
 */
export type ReviewPlacementTarget = {
  kind: ReviewMediaKind | 'audio';
  hash: string;
  path: string;
  timing?: ReviewTiming;
  durationInFrames: number;
  scriptLines?: readonly ReviewScriptLine[];
};

export type PlacedReviewThread = ReviewThread & { placement: ReviewPlacement };

/** Where `thread` shows on `target`, or null when it's about something else (another still, the script elsewhere). */
export function placeReviewThread(thread: ReviewThread, target: ReviewPlacementTarget): ReviewPlacement | null {
  const { anchor } = thread;
  switch (anchor.on) {
    case 'video': return target.kind === 'video' ? placeReviewVideoNote(anchor, target) : null;
    case 'still': return target.kind === 'still' && anchor.writtenOn.path === target.path ? { shifted: false } : null;
    case 'script': return target.scriptLines ? placeReviewScriptNote(anchor, target.scriptLines) : null;
    // About the cut as a whole ("is 24 s right?"): beside a video, where it's answered, and noise beside a still.
    case 'project': return target.kind === 'video' ? { shifted: false } : null;
  }
  // A decision thread is about no one frame or file.
  return { shifted: false };
}

function placeReviewVideoNote(anchor: Extract<ReviewAnchor, { on: 'video' }>, target: ReviewPlacementTarget): ReviewPlacement {
  const { writtenOn, moment } = anchor, last = target.durationInFrames - 1;
  if (writtenOn.hash === target.hash) return { frame: anchor.frame, ...(anchor.end !== undefined && { end: anchor.end }), shifted: false };
  if (!moment) return { unplaced: `${writtenOn.path} \`${writtenOn.hash}\` had no snapshot, so its moment wasn't kept` };
  if (!target.timing) return { unplaced: 'this render has no snapshot to place it by' };
  const placed = placeReviewMoment(moment, target.timing);
  if ('unplaced' in placed) return placed;
  const frame = placed.frame - target.timing.startsAt, shift = frame - anchor.frame;
  if (frame < 0 || frame > last) return { unplaced: `its moment falls on f${frame}, outside this render's f0–f${last}` };
  return { frame, ...(anchor.end !== undefined && { end: Math.min(anchor.end + shift, last) }), shifted: shift !== 0 };
}

function placeReviewScriptNote(anchor: Extract<ReviewAnchor, { on: 'script' }>, lines: readonly ReviewScriptLine[]): ReviewPlacement {
  const line = lines.find((l) => l.id === anchor.line);
  if (!line) return { unplaced: `line ${anchor.line} isn't in the script` };
  if (anchor.word === undefined) return { shifted: false };
  const words = reviewScriptLineWords(line);
  // A note on a selection keeps its first word's text to find it by.
  const text = anchor.text?.split(/\s+/).find(Boolean) ?? words[anchor.word]?.text;
  const word = text === undefined ? undefined : placeReviewWord(words, { word: anchor.word, text });
  if (word === undefined) return { unplaced: text === undefined ? `line ${anchor.line} has ${words.length} words now` : `line ${anchor.line} no longer says "${text}"` };
  const shift = word - anchor.word;
  return { word, ...(anchor.wordEnd !== undefined && { wordEnd: anchor.wordEnd + shift }), shifted: shift !== 0 };
}

export type ReviewVideoAnchor = Extract<NewAnchor, { on: 'video' }>;

/**
 * What a thread is about: a video, a still, the script, or a decision (with `candidate`, that candidate). It lists
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

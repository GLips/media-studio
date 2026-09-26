import { formatReviewMoment, type ReviewNote } from '#models/review/review-notes.ts';
import type { TimelineMoment } from '#models/timeline/scene-moments.ts';

/** A note written but not yet saved: no id, and its context is worked out as it's drawn. */
export type ReviewNoteDraft = Omit<ReviewNote, 'id' | 'context'>;

/** `0:01.12 – 0:02.03 · (0.41, 0.66)`: when and where a note is, as its heading reads. */
export function formatReviewNotePlace(note: Pick<ReviewNote, 'frame' | 'end' | 'x' | 'y'>, fps: number) {
  const where = note.x !== undefined && note.y !== undefined ? `(${note.x.toFixed(2)}, ${note.y.toFixed(2)})` : '';
  return [formatReviewNoteWhen(note, fps), where].filter(Boolean).join(' · ') || 'no point yet';
}

function formatReviewNoteWhen(note: Pick<ReviewNote, 'frame' | 'end'>, fps: number): string {
  if (note.frame === undefined) return '';
  if (note.end === undefined || note.end === note.frame) return formatReviewMoment(note.frame, fps);
  return `${formatReviewMoment(note.frame, fps)} – ${formatReviewMoment(note.end, fps)}`;
}

/** Whether the frame falls inside a note's moment or range. */
export const reviewNoteCovers = (note: Pick<ReviewNote, 'frame' | 'end'>, frame: number) =>
  note.frame !== undefined && note.frame <= frame && frame <= (note.end ?? note.frame);

/** A cue by its qualified name, as the timeline and a note's moment write it; a replay or landmark by its own. */
export const formatTimelineMomentName = (m: TimelineMoment, scene: string) => (m.kind === 'cue' ? `${scene}.${m.name}` : m.name);

/** `Sep 25 08:55:12`, local time: enough to tell two renders of a day apart. */
export const formatRenderTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

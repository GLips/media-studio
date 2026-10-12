import { useQuery } from '@tanstack/react-query';
import type { PlacedReviewThread } from '#lib/output/review/models/review-placement.ts';
import type { ReviewPeaks } from '#lib/output/review/models/review-timeline-geometry.ts';
import type { ReviewSearch } from '../controllers/review-search.ts';
import type { ReviewLaneId } from './review-dock.tsx';
import { reviewPeaksQueryOptions } from './review-peaks-canvas.ts';
import { useReviewScreen } from './review-screen-context.tsx';
import { useReviewThreads } from './use-review-threads.ts';

/** A note on the timeline: a thread placed at a frame of the open render. */
export type ReviewTimelineNote = PlacedReviewThread & { placement: { frame: number; end?: number } };

/** A voiced line on the render's own clock, each word at the frame it starts on. */
export type ReviewTimelineLine = { id: string; from: number; to: number; text: string; words: readonly { text: string; from: number }[] };

/** What the dock draws, read once for every lane, and the lanes that have any of it, top to bottom. */
export type ReviewDockLanes = {
  lanes: readonly ReviewLaneId[];
  notes: readonly ReviewTimelineNote[];
  lines: readonly ReviewTimelineLine[];
  peaks: ReviewPeaks | undefined;
};

const REVIEW_LANE_ORDER: readonly ReviewLaneId[] = ['ruler', 'scenes', 'marks', 'notes', 'voice', 'sound'];

/** The thread filter, as the thread panel reads it: absent is everything but resolved. */
function shownOnTimeline(note: ReviewTimelineNote, filter: ReviewSearch['filter']): boolean {
  if (filter === 'all') return true;
  if (filter === 'open') return note.state === 'open' || note.state === 'reopened';
  return note.state !== 'resolved';
}

const isOnTimeline = (thread: PlacedReviewThread): thread is ReviewTimelineNote => 'frame' in thread.placement;

/**
 * The lanes `wanted` (all by default) that have something to draw: scenes and marks from the snapshot, notes from the
 * review, voiced lines from the render's timing, sound once its peaks say it isn't silent or the cue list marks one.
 */
export function useReviewDockLanes(wanted: readonly ReviewLaneId[] = REVIEW_LANE_ORDER): ReviewDockLanes {
  const { artifact, search, draft } = useReviewScreen();
  const threads = useReviewThreads();
  const peaks = useQuery({
    ...reviewPeaksQueryOptions(artifact.project, artifact.path, artifact.render.hash, { pinned: true }),
    enabled: artifact.kind === 'video' && wanted.includes('sound'),
  }).data;

  const notes = (threads?.threads ?? []).filter(isOnTimeline).filter((n) => shownOnTimeline(n, search.filter));
  const startsAt = artifact.timing?.startsAt ?? 0;
  const lines = (artifact.timing?.lines ?? []).map((line) => ({
    id: line.id, from: line.from - startsAt, to: line.to - startsAt, text: line.words.map((w) => w.text).join(' '),
    words: line.words.map((w) => ({ text: w.text, from: w.from - startsAt })),
  }));
  const has: Record<ReviewLaneId, boolean> = {
    ruler: true,
    scenes: (artifact.scenes?.length ?? 0) > 0,
    marks: (artifact.marks?.moments.length ?? 0) > 0,
    // The draft's pin or range shows here too, so a note being written has its lane.
    notes: notes.length > 0 || (draft.anchor.on === 'video' && draft.anchor.frame !== undefined),
    voice: lines.length > 0,
    sound: (artifact.sounds?.length ?? 0) > 0 || (peaks?.peaks.some((p) => p > 0) ?? false),
  };
  return { lanes: REVIEW_LANE_ORDER.filter((lane) => wanted.includes(lane) && has[lane]), notes, lines, peaks };
}

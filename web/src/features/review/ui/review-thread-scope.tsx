import { createContext, useContext, type ReactNode } from 'react';
import type { ReviewArtifact } from '#lib/output/review/models/review-artifact.ts';
import type { PlacedReviewThread, ReviewThreadSubject } from '#lib/output/review/models/review-placement.ts';
import type { ReviewSearch } from '../controllers/review-search.ts';
import type { ReviewOps } from '../controllers/use-review-ops.ts';
import type { ReviewPlayback } from './review-playback-store.ts';
import type { ReviewScreenTiming } from './review-screen-context.tsx';
import type { ReviewComparedVersion } from './use-review-compare-target.ts';
import type { ReviewDraft } from './use-review-draft.ts';

/** The file a thread's notes sit on, with its clock and its kept versions (which name a carried note's `rN`). */
export type ReviewThreadMedia = {
  artifact: ReviewArtifact;
  timing: ReviewScreenTiming;
  playback: ReviewPlayback;
  versions: readonly ReviewComparedVersion[];
  /** Strokes are going on the stage: the draw keys are the stage's, so a pin doesn't pull the cursor to the field. */
  drawing: boolean;
};

/** The thread's share of its screen's URL: the note in focus and the filter. */
export type ReviewThreadSearch = Pick<ReviewSearch, 'note' | 'filter'>;

/** Everything a thread panel and its composer work from, so any screen can mount one. */
export type ReviewThreadScope = {
  project: string;
  /** What the thread lists, and what a new note is about. */
  subject: ReviewThreadSubject;
  /** The project's threads placed on what's shown; undefined until the first read answers. */
  threads: readonly PlacedReviewThread[] | undefined;
  ops: ReviewOps;
  draft: ReviewDraft;
  search: ReviewThreadSearch;
  setSearch: (patch: ReviewThreadSearch) => void;
  /** Null on a decision: its notes are on no frame, so nothing seeks, follows the playhead or cuts a frame image. */
  media: ReviewThreadMedia | null;
  /** On a sound or video candidate, its shared transport's time in seconds, which a new note is anchored `at`. */
  timeNow?: () => number;
  /** The listed notes as the markdown an agent acts on (`Mod+Shift+C`); absent where there's no file to hand off. */
  markdownOf?: (threads: readonly PlacedReviewThread[]) => string;
};

const ReviewThreadScopeContext = createContext<ReviewThreadScope | null>(null);

export function ReviewThreadScopeProvider({ value, children }: { readonly value: ReviewThreadScope; readonly children: ReactNode }) {
  return <ReviewThreadScopeContext value={value}>{children}</ReviewThreadScopeContext>;
}

export function useReviewThreadScope(): ReviewThreadScope {
  const scope = useContext(ReviewThreadScopeContext);
  if (!scope) throw new Error('useReviewThreadScope is for a thread panel, inside its ReviewThreadScopeProvider');
  return scope;
}

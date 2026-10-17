import { createContext, useContext, type ReactNode } from 'react';
import type { ReviewArtifact } from '#lib/output/review/models/review-artifact.ts';
import type { ReviewGuideSet } from '#lib/output/review/models/review-guides.ts';
import type { ProjectPulse } from '#web/features/projects/index.ts';
import type { ReviewSearch, SetReviewSearch } from '../controllers/review-search.ts';
import { useReviewPlaybackState, type ReviewPlayback } from './review-playback-store.ts';
import type { ReviewDraft } from './use-review-draft.ts';

/** What the keys and the body are driving: the stage, the Board in its place, or strokes on the stage. */
export type ReviewScreenMode = 'stage' | 'board' | 'draw';

/** The render's clock: its fps and length, the length from the file once it loads when no snapshot gave one. */
export type ReviewScreenTiming = { fps: number; durationInFrames: number };

export type ReviewScreenValue = {
  project: string;
  /** The render as loaded; a newer one on disk is in the pulse's `files` until it loads. */
  artifact: ReviewArtifact;
  timing: ReviewScreenTiming;
  /** The project's pulse, polled each second: the review's revision, its files on disk, the agent, a render under way. */
  pulse: ProjectPulse;
  playback: ReviewPlayback;
  draft: ReviewDraft;
  search: ReviewSearch;
  setSearch: SetReviewSearch;
  mode: ReviewScreenMode;
  setMode: (mode: ReviewScreenMode) => void;
  /** The guides over the stage (`H`, the transport's ⌗), null for none. */
  guides: ReviewGuideSet | null;
  setGuides: (update: (now: ReviewGuideSet | null) => ReviewGuideSet | null) => void;
};

const ReviewScreenContext = createContext<ReviewScreenValue | null>(null);

/** What every slot of the review screen reads, so the stage, dock, board and thread share one clock, draft and URL. */
export function ReviewScreenProvider({ value, children }: { readonly value: ReviewScreenValue; readonly children: ReactNode }) {
  return <ReviewScreenContext value={value}>{children}</ReviewScreenContext>;
}

export function useReviewScreen(): ReviewScreenValue {
  const screen = useContext(ReviewScreenContext);
  if (!screen) throw new Error('useReviewScreen is for the review screen\'s slots, inside its ReviewScreenProvider');
  return screen;
}

/** The frame the playhead settled on, re-rendering on a pause or a seek and never per played frame. */
export function useReviewFrame(): number {
  return useReviewPlaybackState(useReviewScreen().playback, (s) => s.frame);
}

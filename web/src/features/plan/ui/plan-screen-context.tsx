import { createContext, useContext, type ReactNode } from 'react';
import type { ReviewArtifact } from '#lib/output/review/models/review-artifact.ts';
import type { ReviewPlanSignoffState } from '#lib/output/review/models/review-plan.ts';
import type { ReviewThread } from '#lib/output/review/models/review-threads.ts';
import type { ProjectPulse } from '#web/features/projects/index.ts';
import type { ReviewOps, useReviewDraft } from '#web/features/review/index.ts';
import type { ProjectStoryboard } from '#web/features/storyboard/index.ts';
import type { PlanSearch, SetPlanSearch } from '../controllers/plan-search.ts';
import type { PlanPlacedThread, PlanTarget } from './plan-notes.ts';
import type { PlanPlayback } from './plan-playback.ts';
import type { PlanTiming } from './plan-timing.ts';

type ReviewDraft = ReturnType<typeof useReviewDraft>;

/** The newest render, where the plan's scenes link to their moments: its file and, once read, its snapshot's scenes. */
export type PlanRender = { path: string; hash: string; artifact: ReviewArtifact | undefined };

export type PlanScreenValue = {
  project: string;
  pulse: ProjectPulse;
  plan: ProjectStoryboard;
  /** Null when the plan doesn't time: its diagnostics say why. */
  timing: PlanTiming | null;
  playback: PlanPlayback;
  search: PlanSearch;
  setSearch: SetPlanSearch;
  draft: ReviewDraft;
  ops: ReviewOps;
  /** The plan's notes placed on it; undefined until the review file first loads. */
  threads: readonly PlanPlacedThread[] | undefined;
  /** The video review's notes, by the scene each sits in. */
  videoNotes: ReadonlyMap<string, readonly ReviewThread[]>;
  signoffs: ReadonlyMap<string, { state: ReviewPlanSignoffState; at?: string }>;
  render: PlanRender | null;
  /** What `N` notes when nothing is selected: the cell, line, section or item last clicked. */
  target: PlanTarget | null;
  setTarget: (target: PlanTarget | null) => void;
  /** The scene in focus: the URL's, else the first. */
  focusedScene: string | null;
  signOff: (scene: string) => void;
};

const PlanScreenContext = createContext<PlanScreenValue | null>(null);

export function PlanScreenProvider({ value, children }: { readonly value: PlanScreenValue; readonly children: ReactNode }) {
  return <PlanScreenContext value={value}>{children}</PlanScreenContext>;
}

export function usePlanScreen(): PlanScreenValue {
  const screen = useContext(PlanScreenContext);
  if (!screen) throw new Error('usePlanScreen is for the plan page\'s parts, inside its PlanScreenProvider');
  return screen;
}

// decision-pass.ts: the decisions screen's queue, every open decision in the project in story order, walked one after
// another without going back to the dashboard. The walk itself is review-decisions.ts; this holds which topics the pass
// has taken in and reads the story's order from the storyboard the browser resolves.
//
// Negative space: the pass lives as long as the screen does. A reload starts a new one, which leaves out what was
// signed off before it, as the check queue's does.
import { useState } from 'react';
import { reviewDecisionPass, reviewStoryOrderOf } from '#lib/output/review/models/review-decisions.ts';
import type { ReviewDecision } from '#lib/output/review/models/review-threads.ts';
import type { StoryboardScenes } from '#lib/timing/storyboard/models/storyboard.ts';
import { useProjectStoryboard } from '#web/features/storyboard/index.ts';

export type DecisionPass = {
  /** In story order: those about no scene, or before the storyboard loads, in the order they were posted. */
  decisions: readonly ReviewDecision[];
  /** The storyboard's scenes, for the line a decision is about; null before it loads, or with no storyboard. */
  scenes: StoryboardScenes | null;
};

/** The pass through `topics` (one decision per topic) that the screen opened on `topic`. */
export function useDecisionPass(project: string, topic: string, topics: readonly ReviewDecision[]): DecisionPass {
  const load = useProjectStoryboard(project);
  const scenes = load.state === 'ready' ? load.plan.storyboard.scenes : null;
  const due = [topic, ...topics.filter((d) => d.state === 'open').map((d) => d.topic)];
  const [walked, setWalked] = useState<ReadonlySet<string>>(() => new Set(due));
  // Grown in render: a topic opened or posted since is in the pass from the frame it shows.
  const missing = due.filter((t) => !walked.has(t));
  if (missing.length) setWalked(new Set([...walked, ...missing]));
  const order = load.state === 'ready' ? reviewStoryOrderOf(load.plan.storyboard) : [];
  return { decisions: reviewDecisionPass(topics, new Set([...walked, ...missing]), order), scenes };
}

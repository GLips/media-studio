// review-decisions.ts: which decision stands for a topic. An agent re-posting on a topic with an open decision updates
// it in place; once it's signed off, a new post starts a new decision on the same topic. Every screen shows a topic
// as one decision, picked here, so the dashboard and the decisions page agree.
import type { ReviewDecision } from './review-threads.ts';

/** The decision a topic opens on: its open one, else the newest posted. Null when nothing was posted on it. */
export function reviewDecisionOnTopic(decisions: readonly ReviewDecision[], topic: string): ReviewDecision | null {
  const onTopic = decisions.filter((d) => d.topic === topic);
  return onTopic.find((d) => d.state === 'open') ?? onTopic.at(-1) ?? null;
}

/** One decision per topic, as reviewDecisionOnTopic picks it: open ones first, then newest first. */
export function reviewDecisionTopics(decisions: readonly ReviewDecision[]): ReviewDecision[] {
  return [...new Set(decisions.map((d) => d.topic))]
    .flatMap((topic) => reviewDecisionOnTopic(decisions, topic) ?? [])
    .toSorted((a, b) => Number(b.state === 'open') - Number(a.state === 'open') || b.id - a.id);
}

// review-decisions.ts: which decision stands for a topic, and the order the reviewer walks them in. An agent re-posting
// on a topic with an open decision updates it in place; once it's signed off, a new post starts a new decision on the
// same topic. Every screen shows a topic as one decision, picked here, so the dashboard and the decisions page agree.
import type { Storyboard } from '#lib/timing/storyboard/models/storyboard.ts';
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

/** A storyboard's scenes in story order, each with its lines' ids in reading order. */
export type ReviewStoryOrder = readonly { scene: string; lines: readonly string[] }[];

export function reviewStoryOrderOf(storyboard: Storyboard): ReviewStoryOrder {
  return Object.entries(storyboard.scenes).map(([scene, row]) => ({ scene, lines: Object.keys(row.lines ?? {}) }));
}

/**
 * `decisions` as the story tells them: by scene, then line, a scene's own decision before its lines'. One about no
 * scene, or a scene since cut from the storyboard, comes after them all; ties go in posting order.
 */
export function reviewDecisionsInStoryOrder(decisions: readonly ReviewDecision[], order: ReviewStoryOrder): ReviewDecision[] {
  const placeOf = ({ about }: ReviewDecision): [number, number] => {
    const scene = about ? order.findIndex((s) => s.scene === about.scene) : -1;
    if (!about || scene < 0) return [order.length, 0];
    const { lines } = order[scene];
    // A line cut since sorts after the scene's lines that remain.
    const line = about.line === undefined ? -1 : lines.indexOf(about.line);
    return [scene, about.line !== undefined && line < 0 ? lines.length : line];
  };
  const placed = decisions.map((d) => ({ d, at: placeOf(d) }));
  return placed.toSorted((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1] || a.d.id - b.d.id).map(({ d }) => d);
}

/**
 * The decisions one pass walks, in story order: every topic open now, and each in `walked`, the topics shown or open
 * since the pass began. So one signed off stays in place and "3 of 12" holds still, while one posted mid-pass joins.
 */
export function reviewDecisionPass(decisions: readonly ReviewDecision[], walked: ReadonlySet<string>, order: ReviewStoryOrder): ReviewDecision[] {
  return reviewDecisionsInStoryOrder(reviewDecisionTopics(decisions).filter((d) => d.state === 'open' || walked.has(d.topic)), order);
}

/**
 * Where signing off `topic` leads: the next decision after it still open, else an earlier one, so a pass begun midway
 * still reaches every one. Null when `topic` was the last open.
 */
export function reviewDecisionAfterSignOff(pass: readonly ReviewDecision[], topic: string): string | null {
  const at = pass.findIndex((d) => d.topic === topic);
  const open = (d: ReviewDecision) => d.state === 'open' && d.topic !== topic;
  return (pass.slice(at + 1).find(open) ?? pass.slice(0, Math.max(at, 0)).find(open))?.topic ?? null;
}

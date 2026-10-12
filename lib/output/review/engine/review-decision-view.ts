// review-decision-view.ts: what the decisions screen polls each second for one topic: the decision standing for it
// (review-decisions.ts), which of its candidates' files moved on since posting, its threads, every topic for the
// menu, and the agent's presence. Each poll costs a stat per candidate file while nothing changes.
import { renderFileStamp } from '#lib/output/render/engine/render-snapshot.ts';
import { reviewDecisionOnTopic, reviewDecisionTopics } from '../models/review-decisions.ts';
import type { ReviewCandidate, ReviewDecision, ReviewThread } from '../models/review-threads.ts';
import { projectFolderNamed, ProjectMediaNotFound, resolveProjectMedia } from './project-media.ts';
import { readReviewFile } from './review-file.ts';
import { readReviewWatchPresence } from './review-watch.ts';

/** A candidate's file as it is on disk now, against the bytes it was posted with. Absent when unchanged. */
export type CandidateFileState = 'changed' | 'missing';

/** One topic on the project, for the topic menu. */
export type ReviewDecisionTopic = Pick<ReviewDecision, 'id' | 'topic' | 'state' | 'question'>;

export type ReviewDecisionView = {
  revision: number;
  /** Null when nothing was ever posted on the topic. */
  decision: ReviewDecision | null;
  /** By candidate key, only the candidates whose file moved on since it was posted. */
  files: Record<string, CandidateFileState>;
  /** The threads about this decision, on its candidates or on the whole. */
  threads: ReviewThread[];
  topics: ReviewDecisionTopic[];
  agent?: { since: string };
};

function candidateFileStateOf(project: string, media: NonNullable<ReviewCandidate['media']>): CandidateFileState | undefined {
  try {
    return renderFileStamp(resolveProjectMedia(project, media.path)).hash === media.hash ? undefined : 'changed';
  } catch (error) {
    if (error instanceof ProjectMediaNotFound) return 'missing';
    throw error;
  }
}

export function readReviewDecisionView(project: string, topic: string): ReviewDecisionView {
  const dir = projectFolderNamed(project);
  const file = readReviewFile(dir), agent = readReviewWatchPresence(dir);
  const decision = reviewDecisionOnTopic(file.decisions, topic);
  const files = Object.fromEntries((decision?.candidates ?? []).flatMap((candidate) => {
    const state = candidate.media && candidateFileStateOf(project, candidate.media);
    return state ? [[candidate.key, state]] : [];
  }));
  return {
    revision: file.revision, decision, files,
    threads: decision ? file.threads.filter((t) => t.anchor.on === 'decision' && t.anchor.decision === decision.id) : [],
    topics: reviewDecisionTopics(file.decisions).map(({ id, topic: t, state, question }) => ({ id, topic: t, state, question })),
    ...(agent && { agent }),
  };
}

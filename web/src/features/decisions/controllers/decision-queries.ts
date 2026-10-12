// decision-queries.ts: a decision as its screen shows it, read off the project's review file (the same cached file the
// review screen places from, so an op shows at once on both) and keyed on the project pulse. Only which candidates'
// files moved on comes from the server apart.
//
// Negative space: a candidate's file outside the pulse's listed folders (an audio bed) is looked at again only when
// the review's revision or the project's listed files move.
import { queryOptions, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { useDeferredValue, useMemo } from 'react';
import { projectPulseBeatOf } from '#lib/output/review/models/project-pulse.ts';
import { reviewDecisionOnTopic, reviewDecisionTopics } from '#lib/output/review/models/review-decisions.ts';
import type { ReviewDecision, ReviewFile, ReviewThread } from '#lib/output/review/models/review-threads.ts';
import { projectPulseQueryOptions, type ProjectPulse } from '#web/features/projects/index.ts';
import { reviewFileQueryOptions, useReviewFileRevision } from '#web/features/review/index.ts';
import { fetchReviewCandidateFileStates } from './review-decision.ts';

const candidateFilesQueryOptions = (project: string, topic: string, beat: string) => queryOptions({
  queryKey: ['review-candidate-files', project, topic, beat],
  queryFn: () => fetchReviewCandidateFileStates({ data: { project, topic } }),
  staleTime: Infinity,
});

type CandidateFileStates = Awaited<ReturnType<typeof fetchReviewCandidateFileStates>>;

export type ReviewDecisionView = {
  revision: number;
  /** Null when nothing was ever posted on the topic. */
  decision: ReviewDecision | null;
  /** By candidate key, only the candidates whose file moved on since it was posted. */
  files: CandidateFileStates;
  /** The threads about this decision, on its candidates or on the whole. */
  threads: ReviewThread[];
  /** One decision per topic, for the topic menu. */
  topics: ReviewDecision[];
  agent?: { since: string };
};

function reviewDecisionViewOf(file: ReviewFile, topic: string, files: CandidateFileStates, agent: ProjectPulse['agent']): ReviewDecisionView {
  const decision = reviewDecisionOnTopic(file.decisions, topic);
  return {
    revision: file.revision, decision, files,
    threads: decision ? file.threads.filter((t) => t.anchor.on === 'decision' && t.anchor.decision === decision.id) : [],
    topics: reviewDecisionTopics(file.decisions),
    ...(agent && { agent }),
  };
}

/** A loader's: the project's pulse, then its review file and the candidates' files as of it. The decision, or null. */
export async function loadReviewDecision(client: QueryClient, project: string, topic: string): Promise<ReviewDecision | null> {
  const pulse = await client.ensureQueryData(projectPulseQueryOptions(project));
  const [file] = await Promise.all([
    client.ensureQueryData(reviewFileQueryOptions(project, pulse.revision)),
    client.ensureQueryData(candidateFilesQueryOptions(project, topic, projectPulseBeatOf(pulse))),
  ]);
  return reviewDecisionOnTopic(file.decisions, topic);
}

/**
 * The topic's decision as of the project pulse. Its parts are deferred, so a new revision loads behind the one shown
 * instead of suspending the screen; an op the reviewer sends shows at once, in the cached file.
 */
export function useReviewDecisionView(project: string, topic: string): ReviewDecisionView {
  const pulse = useSuspenseQuery(projectPulseQueryOptions(project)).data;
  const revision = useDeferredValue(useReviewFileRevision(project, pulse.revision)), beat = useDeferredValue(projectPulseBeatOf(pulse));
  const file = useSuspenseQuery(reviewFileQueryOptions(project, revision)).data;
  const files = useSuspenseQuery(candidateFilesQueryOptions(project, topic, beat)).data;
  const { agent } = pulse;
  return useMemo(() => reviewDecisionViewOf(file, topic, files, agent), [file, topic, files, agent]);
}

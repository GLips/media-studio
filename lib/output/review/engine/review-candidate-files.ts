// review-candidate-files.ts: the one part of a decision the page can't read off review/review.json: which candidates'
// files moved on since they were posted. The decision, its threads and the topic menu the page derives from the file
// itself (models/review-decisions.ts). Costs a stat per candidate file while nothing changes.
import { renderFileStamp } from '#lib/output/render/engine/render-snapshot.ts';
import { reviewDecisionOnTopic } from '../models/review-decisions.ts';
import type { ReviewCandidate } from '../models/review-threads.ts';
import { projectFolderNamed, ProjectMediaNotFound, resolveProjectMedia } from './project-media.ts';
import { readReviewFile } from './review-file.ts';

/** A candidate's file as it is on disk now, against the bytes it was posted with. Absent when unchanged. */
export type CandidateFileState = 'changed' | 'missing';

function candidateFileStateOf(project: string, media: NonNullable<ReviewCandidate['media']>): CandidateFileState | undefined {
  try {
    return renderFileStamp(resolveProjectMedia(project, media.path)).hash === media.hash ? undefined : 'changed';
  } catch (error) {
    if (error instanceof ProjectMediaNotFound) return 'missing';
    throw error;
  }
}

/** By candidate key, only the candidates of `topic`'s decision whose file moved on since it was posted. */
export function readReviewCandidateFileStates(project: string, topic: string): Record<string, CandidateFileState> {
  const decision = reviewDecisionOnTopic(readReviewFile(projectFolderNamed(project)).decisions, topic);
  return Object.fromEntries((decision?.candidates ?? []).flatMap((candidate) => {
    const state = candidate.media && candidateFileStateOf(project, candidate.media);
    return state ? [[candidate.key, state]] : [];
  }));
}

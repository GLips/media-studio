import { createServerFn } from '@tanstack/react-start';
import { Schema } from 'effect';
import { readReviewCandidateFileStates } from '#web/infrastructure/studio-engine.server.ts';

/** A project's decision, by its topic. */
const ReviewDecisionRef = Schema.Struct({ project: Schema.String, topic: Schema.String });

/** By candidate key, the candidates of the topic's decision whose file moved on since it was posted. */
export const fetchReviewCandidateFileStates = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(ReviewDecisionRef))
  .handler(({ data }) => readReviewCandidateFileStates(data.project, data.topic));

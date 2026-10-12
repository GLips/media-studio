import { createServerFn } from '@tanstack/react-start';
import { Schema } from 'effect';
import { readReviewDecisionView } from '#web/infrastructure/studio-engine.server.ts';

/** A project's decision, by its topic. */
const ReviewDecisionRef = Schema.Struct({ project: Schema.String, topic: Schema.String });

export const fetchReviewDecision = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(ReviewDecisionRef))
  .handler(({ data }) => readReviewDecisionView(data.project, data.topic));

export type ReviewDecisionView = Awaited<ReturnType<typeof fetchReviewDecision>>;

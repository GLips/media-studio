import { createServerFn } from '@tanstack/react-start';
import { Schema } from 'effect';
import { readReviewArtifact, readReviewStatus } from '#web/infrastructure/studio-engine.server.ts';
import { ReviewArtifactRef, ReviewArtifactVersionRef } from './review-op-schema.ts';

export const fetchReviewArtifact = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(ReviewArtifactVersionRef))
  .handler(({ data }) => readReviewArtifact(data.project, data.path, data.render));

/**
 * Polled apart from the loaded review: the review's revision, the file as it is on disk now (a replaced render shows
 * as a new hash, not a swap), the agent's presence and a render under way.
 */
export const fetchReviewStatus = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(ReviewArtifactRef))
  .handler(({ data }) => readReviewStatus(data.project, data.path));

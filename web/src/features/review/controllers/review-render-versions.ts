import { createServerFn } from '@tanstack/react-start';
import { Schema } from 'effect';
import { listReviewRenderVersions } from '#web/infrastructure/studio-engine.server.ts';
import { ReviewArtifactRef } from './review-op-schema.ts';

/** Every kept version of the open render's path, oldest first, numbered `rN`: what compare and `r14 ▾` choose from. */
export const listReviewRenderVersionsFn = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(ReviewArtifactRef))
  .handler(({ data }) => listReviewRenderVersions(data.project, data.path));

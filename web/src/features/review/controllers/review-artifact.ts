import { createServerFn } from '@tanstack/react-start';
import { Schema } from 'effect';
import { readReviewArtifact, readReviewSplices } from '#web/infrastructure/studio-engine.server.ts';
import { ReviewArtifactVersionRef } from './review-op-schema.ts';

export const fetchReviewArtifact = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(ReviewArtifactVersionRef))
  .handler(({ data }) => readReviewArtifact(data.project, data.path, data.render));

/** The reply slices for the cut at `path` with `hash`, each with whether it's laid in; none unless it's the file now. */
export const fetchReviewSplices = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ project: Schema.String, path: Schema.String, hash: Schema.String })))
  .handler(({ data }) => readReviewSplices(data.project, { path: data.path, hash: data.hash }));

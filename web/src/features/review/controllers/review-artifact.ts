import { createServerFn } from '@tanstack/react-start';
import { Schema } from 'effect';
import { readReviewArtifact, readReviewArtifactStatus, saveReviewNotes } from '#web/infrastructure/studio-engine.server.ts';
import { ReviewArtifactRef, ReviewNoteSchema } from './review-note-schema.ts';

export const fetchReviewArtifact = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(ReviewArtifactRef))
  .handler(({ data }) => readReviewArtifact(data.project, data.path));

/** The file as it is on disk now, polled apart from the loaded review so a replaced render raises a banner, not a swap. */
export const fetchReviewArtifactStatus = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(ReviewArtifactRef))
  .handler(({ data }) => readReviewArtifactStatus(data.project, data.path));

/** Every change saves the file's notes whole. */
export const submitReviewNotes = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({
    ...ReviewArtifactRef.fields,
    notes: Schema.Array(ReviewNoteSchema),
    fps: Schema.optionalKey(Schema.Number),
  })))
  .handler(({ data }) => saveReviewNotes(data.project, data.path, { notes: [...data.notes], ...(data.fps !== undefined && { fps: data.fps }) }));

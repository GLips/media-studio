import { createServerFn } from '@tanstack/react-start';
import { setResponseStatus } from '@tanstack/react-start/server';
import { Schema } from 'effect';
import { applyReviewOps, projectFolderNamed, readReviewFile } from '#web/infrastructure/studio-engine.server.ts';
import { ReviewOpsInput } from './review-op-schema.ts';

/**
 * Applies the screen's ops as the reviewer. Answers the new revision and the ids it touched, or, for an edit to a note
 * changed since it was loaded, 409 with the note as it stands and nothing applied.
 */
export const applyReviewOpsFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(ReviewOpsInput))
  .handler(({ data }) => {
    const applied = applyReviewOps(projectFolderNamed(data.project), data.ops, 'reviewer');
    if ('conflict' in applied) {
      setResponseStatus(409);
      return applied;
    }
    return { revision: applied.file.revision, changed: applied.changed };
  });

/** The project's review/review.json as it is, unplaced: each screen places its threads on what it shows. */
export const readReviewFileFn = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ project: Schema.String })))
  .handler(({ data }) => readReviewFile(projectFolderNamed(data.project)));

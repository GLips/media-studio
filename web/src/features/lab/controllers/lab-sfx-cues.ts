import { createServerFn } from '@tanstack/react-start';
import { Schema } from 'effect';
import type { LabSfxCueEdit } from '#models/lab/lab-catalog.ts';
import { SfxRequestSchema } from './lab-sfx-request-schema.ts';
import { LabSfxCueRequestError, LabSfxCueStaleError, saveLabSfxCueEdits } from '#web/infrastructure/studio-engine.server.ts';

const LabSfxCueEditSchema = Schema.Struct({
  id: Schema.String,
  sound: Schema.optionalKey(Schema.NullOr(SfxRequestSchema)),
  nudge: Schema.optionalKey(Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: -2, maximum: 2 })))),
  volume: Schema.optionalKey(Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 4 })))),
});

/** The decoded edit, which tsc holds to the model's: a schema that drifts from LabSfxCueEdit stops compiling here. */
type ModelLabSfxCueEdit<T extends LabSfxCueEdit> = T;
export type DecodedLabSfxCueEdit = ModelLabSfxCueEdit<typeof LabSfxCueEditSchema.Type>;

/**
 * Saves the demo cue list's edits, as `studio sfx draft` writes a list. A refusal comes back as a value, so the editor
 * can say why (a stale tab reloads; a bad edit is named) rather than fail its whole screen.
 */
export const submitLabSfxCueEdits = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({
    project: Schema.String,
    revision: Schema.String,
    edits: Schema.Array(LabSfxCueEditSchema),
  })))
  .handler(({ data }) => {
    try {
      return { saved: saveLabSfxCueEdits(data.project, { revision: data.revision, edits: data.edits }) };
    } catch (error) {
      if (error instanceof LabSfxCueStaleError) return { refusal: 'stale' as const, message: error.message };
      if (error instanceof LabSfxCueRequestError) return { refusal: 'invalid' as const, message: error.message };
      throw error;
    }
  });

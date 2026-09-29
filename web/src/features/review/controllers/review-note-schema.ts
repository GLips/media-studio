// review-note-schema.ts: a note as the screen posts it, decoded at the server's door so nothing but a note reaches the
// file an agent reads. It spells out lib/output/review/models/review-notes.ts's ReviewNote; `satisfies` below keeps the two in step.
import { Schema } from 'effect';
import type { ReviewNote } from '#lib/output/review/models/review-notes.ts';

const Fraction = Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })));
const FrameNumber = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)));

const MomentCommon = {
  scene: Schema.String,
  bar: Schema.optionalKey(Schema.Number),
  rung: Schema.optionalKey(Schema.Literals(['blocking', 'final'])),
  cue: Schema.optionalKey(Schema.Struct({ name: Schema.String, frames: Schema.Number })),
  frames: Schema.Number,
};

const ReviewMomentSchema = Schema.Union([
  Schema.Struct({ ...MomentCommon, kind: Schema.Literal('beat'), beat: Schema.Number }),
  Schema.Struct({ ...MomentCommon, kind: Schema.Literal('word'), line: Schema.String, word: Schema.Number, text: Schema.String }),
  Schema.Struct({ ...MomentCommon, kind: Schema.Literal('scene') }),
]);

const ReviewNoteContextSchema = Schema.Struct({
  cell: Schema.optionalKey(Schema.Struct({ variant: Schema.String, axes: Schema.Record(Schema.String, Schema.String), refused: Schema.Boolean })),
  scenes: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.String))),
  sounds: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.Struct({ id: Schema.String, sound: Schema.String, frame: Schema.Number, targeted: Schema.optionalKey(Schema.Literal(true)) })))),
  elements: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.Struct({ id: Schema.String, kind: Schema.optionalKey(Schema.String) })))),
  moment: Schema.optionalKey(ReviewMomentSchema),
});

export const ReviewNoteSchema = Schema.Struct({
  id: Schema.String,
  frame: Schema.optionalKey(FrameNumber),
  end: Schema.optionalKey(FrameNumber),
  x: Schema.optionalKey(Fraction),
  y: Schema.optionalKey(Fraction),
  cue: Schema.optionalKey(Schema.String),
  render: Schema.optionalKey(Schema.String),
  movedFrom: Schema.optionalKey(Schema.Struct({ render: Schema.String, frame: Schema.Number })),
  unplaced: Schema.optionalKey(Schema.String),
  text: Schema.String,
  context: ReviewNoteContextSchema,
}).pipe(Schema.check(Schema.makeFilter((note) =>
  (note.end === undefined || (note.frame !== undefined && note.end >= note.frame)) && (note.x === undefined) === (note.y === undefined)
    || 'an end needs a frame at or before it, and x and y come together')));

/** The decoded note, which tsc holds to the model's: a schema that drifts from ReviewNote stops compiling here. */
type ModelReviewNote<T extends ReviewNote> = T;
export type DecodedReviewNote = ModelReviewNote<typeof ReviewNoteSchema.Type>;

/** Which file of which project a request is about. */
export const ReviewArtifactRef = Schema.Struct({ project: Schema.String, path: Schema.String });

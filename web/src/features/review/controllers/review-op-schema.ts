// review-op-schema.ts: the ops the review screen sends, decoded at the server's door so nothing but a well-formed op
// reaches review/review.json. It spells out lib/output/review/models/review-ops.ts's ReviewOp for the ops a reviewer
// makes (an agent's `decision.put` comes only through the CLI); the type check at the bottom keeps the two in step.
import { Schema, Struct } from 'effect';
import type { ReviewOp } from '#lib/output/review/models/review-ops.ts';

const Fraction = Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })));
const FrameNumber = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)));
const Id = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)));
const Rung = Schema.Literals(['blocking', 'final']);

const ReviewPointSchema = Schema.Struct({ x: Fraction, y: Fraction });
const ReviewMarkSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('arrow'), from: ReviewPointSchema, to: ReviewPointSchema }),
  Schema.Struct({ kind: Schema.Literal('ellipse'), c: ReviewPointSchema, rx: Fraction, ry: Fraction }),
  Schema.Struct({ kind: Schema.Literal('path'), points: Schema.mutable(Schema.Array(ReviewPointSchema)) }),
]);

const MomentCommon = {
  scene: Schema.String,
  bar: Schema.optionalKey(Schema.Number),
  rung: Schema.optionalKey(Rung),
  cue: Schema.optionalKey(Schema.Struct({ name: Schema.String, frames: Schema.Number })),
  frames: Schema.Number,
};
const ReviewMomentSchema = Schema.Union([
  Schema.Struct({ ...MomentCommon, kind: Schema.Literal('beat'), beat: Schema.Number }),
  Schema.Struct({ ...MomentCommon, kind: Schema.Literal('word'), line: Schema.String, word: Schema.Number, text: Schema.String }),
  Schema.Struct({ ...MomentCommon, kind: Schema.Literal('scene') }),
]);

const RenderRef = Schema.Struct({ path: Schema.String, hash: Schema.String });
const SourceCommit = Schema.Struct({ commit: Schema.String, dirty: Schema.Boolean });
const WrittenOn = Schema.Struct({ ...RenderRef.fields, commit: Schema.optionalKey(Schema.Struct({ engine: SourceCommit, workspace: Schema.NullOr(SourceCommit) })) });

const VideoAnchorFields = {
  on: Schema.Literal('video'), frame: FrameNumber, end: Schema.optionalKey(FrameNumber), point: Schema.optionalKey(ReviewPointSchema),
  marks: Schema.optionalKey(Schema.mutable(Schema.Array(ReviewMarkSchema))), cue: Schema.optionalKey(Schema.String), moment: Schema.optionalKey(ReviewMomentSchema),
};
const StillAnchorFields = {
  on: Schema.Literal('still'), point: Schema.optionalKey(ReviewPointSchema), marks: Schema.optionalKey(Schema.mutable(Schema.Array(ReviewMarkSchema))),
  cell: Schema.optionalKey(Schema.String),
};
const ScriptAnchor = Schema.Struct({
  on: Schema.Literal('script'), scriptHash: Schema.String, line: Schema.String, word: Schema.optionalKey(FrameNumber), wordEnd: Schema.optionalKey(FrameNumber),
  text: Schema.optionalKey(Schema.String), take: Schema.optionalKey(Schema.String),
});
const DecisionAnchor = Schema.Struct({
  on: Schema.Literal('decision'), decision: Id, candidate: Schema.optionalKey(Schema.String),
  at: Schema.optionalKey(Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
});
const ProjectAnchor = Schema.Struct({ on: Schema.Literal('project') });

const NewVideoAnchor = Schema.Struct({ ...VideoAnchorFields, writtenOn: RenderRef });
const NewStillAnchor = Schema.Struct({ ...StillAnchorFields, writtenOn: RenderRef });
const NewAnchorSchema = Schema.Union([NewVideoAnchor, NewStillAnchor, ScriptAnchor, DecisionAnchor, ProjectAnchor]);
/** An edit moves part of an anchor: each variant with every field optional. */
const everyFieldOptional = Struct.map(Schema.optionalKey);
const NewAnchorPatch = Schema.Union([
  NewVideoAnchor.mapFields(everyFieldOptional), NewStillAnchor.mapFields(everyFieldOptional), ScriptAnchor.mapFields(everyFieldOptional),
  DecisionAnchor.mapFields(everyFieldOptional), ProjectAnchor.mapFields(everyFieldOptional),
]);

const ReviewAnchorSchema = Schema.Union([
  Schema.Struct({ ...VideoAnchorFields, writtenOn: WrittenOn, image: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ ...StillAnchorFields, writtenOn: WrittenOn, image: Schema.optionalKey(Schema.String) }),
  ScriptAnchor, DecisionAnchor, ProjectAnchor,
]);

const Kind = Schema.Literals(['fix', 'question', 'keep']);
const Transition = Schema.Literals(['addressed', 'resolved', 'reopened']);
const ReviewEntrySchema = Schema.Struct({
  author: Schema.Literals(['reviewer', 'agent']), text: Schema.String, at: Schema.String, rev: Schema.Number,
  commit: Schema.optionalKey(Schema.Struct({ engine: Schema.String, workspace: Schema.optionalKey(Schema.String) })),
  render: Schema.optionalKey(Schema.String), transition: Schema.optionalKey(Transition), asks: Schema.optionalKey(Schema.Literal(true)),
});
const ReviewThreadSchema = Schema.Struct({
  id: Id, kind: Kind, state: Schema.Literals(['open', 'addressed', 'resolved', 'reopened']), rev: Schema.Number,
  anchor: ReviewAnchorSchema, entries: Schema.mutable(Schema.Array(ReviewEntrySchema)),
});

const ReviewOpSchema = Schema.Union([
  Schema.Struct({ op: Schema.Literal('thread.add'), kind: Kind, anchor: NewAnchorSchema, text: Schema.String, image: Schema.optionalKey(Schema.Uint8Array) }),
  Schema.Struct({
    op: Schema.Literal('thread.edit'), id: Id, ifRev: Schema.Number, text: Schema.optionalKey(Schema.String), kind: Schema.optionalKey(Kind),
    anchor: Schema.optionalKey(NewAnchorPatch), image: Schema.optionalKey(Schema.Uint8Array),
  }),
  Schema.Struct({ op: Schema.Literal('thread.reply'), id: Id, text: Schema.String, transition: Schema.optionalKey(Schema.Literals(['resolved', 'reopened'])) }),
  Schema.Struct({ op: Schema.Literal('thread.resolveAddressed'), ids: Schema.mutable(Schema.Array(Id)) }),
  Schema.Struct({ op: Schema.Literal('thread.takeBack'), id: Id }),
  Schema.Struct({ op: Schema.Literal('thread.delete'), id: Id }),
  Schema.Struct({ op: Schema.Literal('thread.restore'), thread: ReviewThreadSchema, image: Schema.optionalKey(Schema.Uint8Array) }),
  Schema.Struct({ op: Schema.Literal('decision.verdict'), id: Id, candidate: Schema.String, verdict: Schema.NullOr(Schema.Literals(['pick', 'reject'])) }),
  Schema.Struct({ op: Schema.Literal('decision.close'), id: Id }),
  Schema.Struct({
    op: Schema.Literal('signoff'),
    signoff: Schema.Union([
      Schema.Struct({ on: Schema.Literal('script'), hash: Schema.String, at: Schema.String }),
      Schema.Struct({ on: Schema.Literal('render'), path: Schema.String, hash: Schema.String, rung: Schema.optionalKey(Rung), at: Schema.String }),
    ]),
  }),
]);

/** Which project a request is about, and a file in it. */
export const ReviewArtifactRef = Schema.Struct({ project: Schema.String, path: Schema.String });

/** A file to review, at the version `render` names when the URL's `r` asks for one. */
export const ReviewArtifactVersionRef = Schema.Struct({ project: Schema.String, path: Schema.String, render: Schema.optional(Schema.String) });

/** A batch of ops from the screen, applied together as the reviewer. */
export const ReviewOpsInput = Schema.Struct({ project: Schema.String, ops: Schema.Array(ReviewOpSchema) });

/** The decoded op, which tsc holds to the model's: a schema that drifts from ReviewOp stops compiling here. */
type ModelReviewOp<T extends ReviewOp> = T;
export type DecodedReviewOp = ModelReviewOp<typeof ReviewOpSchema.Type>;

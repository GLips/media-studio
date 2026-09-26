import { Schema } from 'effect';

/** A sound as lib/sfx's SfxRequest names it; whether its recipe and parameters exist, lib/sfx checks on save. */
export const SfxRequestSchema = Schema.Struct({
  sound: Schema.String,
  set: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  seed: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
  mutate: Schema.optionalKey(Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })))),
  category: Schema.optionalKey(Schema.Literals(['ui', 'accent'])),
});

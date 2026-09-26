// lab-catalog-schema.ts: the lab's catalog as the browser decodes it. It arrives by URL, from this app's server or
// from a static host serving an export that may be older than the page, so it's checked at the door.
import { Schema } from 'effect';
import type { LabCatalog } from '#models/lab/lab-catalog.ts';
import { SfxRequestSchema } from './lab-sfx-request-schema.ts';

const array = <S extends Schema.Top>(item: S) => Schema.mutable(Schema.Array(item));
const eventBase = { id: Schema.String, scene: Schema.String, at: Schema.Number };

const SfxEventSchema = Schema.Union([
  Schema.Struct({ ...eventBase, kind: Schema.Literals(['click', 'key', 'placed']), request: SfxRequestSchema, volume: Schema.Number }),
  Schema.Struct({ ...eventBase, kind: Schema.Literal('scene'), index: Schema.Number, dissolve: Schema.optionalKey(Schema.Struct({ from: Schema.Number, to: Schema.Number })) }),
  Schema.Struct({ ...eventBase, kind: Schema.Literal('camera-move'), track: Schema.String, from: Schema.Number, to: Schema.Number, big: Schema.Boolean }),
  Schema.Struct({ ...eventBase, kind: Schema.Literal('reveal'), track: Schema.String }),
]);

const SfxCueSchema = Schema.Struct({
  event: SfxEventSchema,
  draft: Schema.Struct({ sound: Schema.NullOr(SfxRequestSchema), why: Schema.String }),
  alternatives: array(SfxRequestSchema),
  sound: Schema.optionalKey(Schema.NullOr(SfxRequestSchema)),
  nudge: Schema.optionalKey(Schema.Number),
  volume: Schema.optionalKey(Schema.Number),
});

const LabCatalogSchema = Schema.Struct({
  exported: Schema.Boolean,
  gallery: array(Schema.Struct({
    id: Schema.String, project: Schema.String, name: Schema.String, kind: Schema.Literals(['image', 'video', 'audio']), model: Schema.String,
    prompt: Schema.String, params: Schema.Record(Schema.String, Schema.Unknown), cost: Schema.NullOr(Schema.Number),
    generatedAt: Schema.NullOr(Schema.String), files: array(Schema.String), references: array(Schema.String),
  })),
  music: array(Schema.Struct({
    id: Schema.String, project: Schema.String, name: Schema.String, url: Schema.String, duration: Schema.Number, bpm: Schema.Number,
    beats: array(Schema.Number), fit: Schema.optionalKey(Schema.Struct({ source: Schema.String, seams: array(Schema.Number) })),
  })),
  sfxCues: Schema.NullOr(Schema.Struct({
    project: Schema.String,
    list: Schema.Struct({ version: Schema.Literal(1), clickStyle: Schema.Literals(['soft', 'mechanical', 'pop', 'tick']), cues: array(SfxCueSchema) }),
    words: array(Schema.Struct({ text: Schema.String, start: Schema.Number, end: Schema.Number })),
    scenes: array(Schema.Struct({ id: Schema.String, start: Schema.Number, end: Schema.Number })),
    duration: Schema.Number,
    video: Schema.NullOr(Schema.String),
    revision: Schema.String,
  })),
});

/** The decoded catalog, which tsc holds to the model's: a schema that drifts from LabCatalog stops compiling here. */
type ModelLabCatalog<T extends LabCatalog> = T;
type DecodedLabCatalog = ModelLabCatalog<typeof LabCatalogSchema.Type>;

const decodeLabCatalogJson = Schema.decodeUnknownSync(LabCatalogSchema);

/** The catalog a response holds, or a throw naming what in it isn't the shape this page reads. */
export async function readLabCatalogResponse(response: Response): Promise<DecodedLabCatalog> {
  return decodeLabCatalogJson(await response.json());
}

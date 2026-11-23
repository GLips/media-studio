// library-reads.ts: the library's server functions. Each reads or changes committed metadata through the engine door,
// so all of them work with the media folder offline.
import { createServerFn } from '@tanstack/react-start';
import { Schema } from 'effect';
import { changeLibraryFlags, readLibraryFlags, readLibraryItemView, readLibraryShelf, searchStudioLibrary } from '#web/infrastructure/studio-engine.server.ts';

export type { LibraryItemView, LibraryShelf, LibraryShelfItem } from '#web/infrastructure/studio-engine.server.ts';

const LibraryItemRef = Schema.Struct({ item: Schema.String });

/** A change to an item's flags, as library-flags.ts's LibraryFlagOp. */
const LibraryFlagOpInput = Schema.Union([
  Schema.Struct({ op: Schema.Literal('flag.add'), start: Schema.Finite, end: Schema.Finite, note: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ op: Schema.Literal('flag.note'), id: Schema.Finite, note: Schema.String }),
  Schema.Struct({ op: Schema.Literal('flag.remove'), id: Schema.Finite }),
]);
export type LibraryFlagOpInput = typeof LibraryFlagOpInput.Type;

export const fetchLibraryShelf = createServerFn({ method: 'GET' }).handler(() => readLibraryShelf());

export const searchLibraryFn = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ query: Schema.String })))
  .handler(({ data }) => searchStudioLibrary(data.query));

export const fetchLibraryItemView = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(LibraryItemRef))
  .handler(({ data }) => readLibraryItemView(data.item));

export const fetchLibraryFlags = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(LibraryItemRef))
  .handler(({ data }) => readLibraryFlags(data.item));

/** Applies the reviewer's change to an item's flags; the flags file after it. */
export const changeLibraryFlagsFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ item: Schema.String, op: LibraryFlagOpInput })))
  .handler(({ data }) => changeLibraryFlags(data.item, data.op));

// library-app.ts: what the studio app reads and changes of the library, as Effects its server runs: the shelf of
// items, a search, one item with its transcript, and its flags. Committed metadata alone, so every page but playback
// works with the media offline, and says when it is; and a range checked for a take choice. Node only.
import { Effect, Option } from 'effect';
import { LibraryMediaFolder } from '#lib/footage/library-media/engine/library-media-folder.ts';
import type { ReviewAuthor } from '#lib/output/review/models/review-threads.ts';
import type { LibraryFlagOp, LibraryFlagsFile } from '../models/library-flags.ts';
import { libraryFootage, type LibraryTranscriptFile } from '../models/library-footage.ts';
import type { LibraryItem } from '../models/library-item.ts';
import { libraryRangeOf, libraryWordsSaidIn } from '../models/library-range.ts';
import { searchLibrary, type LibrarySearchHit } from '../models/library-search.ts';
import { LibraryStore } from './library-store.ts';

/** One item as the shelf lists it. */
export type LibraryShelfItem = { item: LibraryItem; flags: number };

/** Every item, newest first, and whether the media is there to play. */
export type LibraryShelf = { items: LibraryShelfItem[]; media: { path: string; online: boolean } };

const libraryMediaPlace = Effect.fn('LibraryApp.mediaPlace')(function* () {
  const media = yield* LibraryMediaFolder;
  return { path: (yield* media.location()).path, online: yield* media.isOnline() };
});

export const readLibraryShelfEffect = Effect.fn('LibraryApp.shelf')(function* () {
  const store = yield* LibraryStore;
  const items = yield* Effect.forEach(yield* store.itemIds(), (id) => Effect.all({
    item: store.readItem(id),
    flags: Effect.map(store.readFlags(id), (file) => file.flags.length),
  }));
  // Ids lead with the day they were recorded or added, so the newest recordings come first.
  return { items: items.toReversed(), media: yield* libraryMediaPlace() } satisfies LibraryShelf;
});

/** Every place the library says `query`, as `studio library search` finds them; a query of no words is refused. */
export const searchLibraryEffect = Effect.fn('LibraryApp.search')(function* (query: string) {
  const items = yield* (yield* LibraryStore).readForSearch();
  const hits: LibrarySearchHit[] = yield* Effect.fromResult(searchLibrary(items, query));
  return hits;
});

/** One item as its page shows it; none when no item has the id. */
export type LibraryItemView = {
  item: LibraryItem;
  /** Its speech track's words; none before its transcript is made. */
  transcript?: LibraryTranscriptFile;
  /** The projects whose source imports it. */
  usedBy: string[];
  media: { path: string; online: boolean };
};

export const readLibraryItemViewEffect = Effect.fn('LibraryApp.item')(function* (id: string) {
  const store = yield* LibraryStore;
  const item = yield* store.readItem(id).pipe(Effect.map(Option.some), Effect.catchTag('LibraryItemMissing', () => Effect.succeedNone));
  if (Option.isNone(item)) return null;
  const transcript = Option.getOrUndefined(yield* store.readTranscript(id));
  const view: LibraryItemView = { item: item.value, ...(transcript && { transcript }), usedBy: yield* store.projectsUsing(id), media: yield* libraryMediaPlace() };
  return view;
});

export const readLibraryFlagsEffect = Effect.fn('LibraryApp.flags')(function* (id: string) {
  const file: LibraryFlagsFile = yield* (yield* LibraryStore).readFlags(id);
  return file;
});

/** Applies `op` to item `id`'s flags as `by`; the flags file after it. */
export const changeLibraryFlagsEffect = Effect.fn('LibraryApp.changeFlags')(function* (id: string, op: LibraryFlagOp, by: ReviewAuthor) {
  const store = yield* LibraryStore;
  yield* store.changeFlags(id, op, by);
  return yield* store.readFlags(id);
});

/** A range of an item, named by its id or a part of it, checked against the item, with what's said in it. */
export type LibraryRangeRead = { item: string; from: number; to: number; said: string };

export const readLibraryRangeEffect = Effect.fn('LibraryApp.range')(function* (named: string, from: number, to: number) {
  const store = yield* LibraryStore;
  const id = yield* store.resolveItemId(named);
  const item = yield* store.readItem(id);
  const range = yield* Effect.fromResult(libraryRangeOf(item, from, to));
  const transcript = Option.getOrUndefined(yield* store.readTranscript(id));
  const read: LibraryRangeRead = { item: id, ...range, said: libraryWordsSaidIn(libraryFootage(item, transcript).words, range.from, range.to) };
  return read;
});

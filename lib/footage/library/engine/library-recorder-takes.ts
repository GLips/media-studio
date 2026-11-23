// library-recorder-takes.ts: Studio Recorder's takes wherever they went, and removing them. Each take begins in the
// recorder's recordings folder (its inbox) and moves into the library as an item; one the add failed on stays in the
// inbox. The recorder's menu lists its recent takes and throws one away through these. Node only.
//
// A take is named by its folder in the recordings folder, which its item records as its source; an item and an inbox
// folder are the same take when their folder names match, as the add's already-added check judges.
import { Effect, FileSystem, Option, Path, Schema } from 'effect';
import { LibraryMediaFolder } from '#lib/footage/library-media/engine/library-media-folder.ts';
import { studioProcessRunning } from '#lib/platform/process/engine/studio-process.ts';
import { LIBRARY_ADD_MARKER_FILE, LibraryAddMarkerText, type LibraryAddMarker } from '../models/library-add-marker.ts';
import { LibraryItemInUse, LibraryRequestRefused } from '../models/library-errors.ts';
import type { LibraryItem } from '../models/library-item.ts';
import { LibraryStore } from './library-store.ts';
import { readRecorderTakeFolder } from './recorder-take-folder.ts';

/** One take as `studio library recordings --json` prints it, which the recorder's menu decodes. */
export type LibraryRecorderTake = {
  /** The take's folder in the recordings folder, by which the recorder names it; gone once it's in the library. */
  readonly folder: string;
  readonly recordedAt: string | null;
  /** None for a take the recorder was killed in, still in the inbox. */
  readonly durationSeconds: number | null;
  /** None while it's in the inbox. `mediaFolder` is none while the media is offline. */
  readonly item: { readonly id: string; readonly mediaFolder: string | null } | null;
};

const recorderItems = Effect.fn('LibraryRecorderTakes.items')(function* () {
  const store = yield* LibraryStore;
  const items = yield* Effect.forEach(yield* store.itemIds(), (id) => store.readItem(id).pipe(
    Effect.map(Option.some),
    Effect.catchTag('LibraryFileUnreadable', (error) => Effect.as(Effect.logWarning(`skipping ${id}: ${error.message}`), Option.none<LibraryItem>())),
  ));
  return items.flatMap((item) => (Option.isSome(item) && item.value.source.kind === 'studio-recorder' ? [{ item: item.value, folder: item.value.source.folder }] : []));
});

/**
 * The recorder's takes, newest first: those in the library, then with `inbox` those still in it that the recorder is
 * done with. A take it's still writing is left out, and so is an inbox folder no reader can use, said on stderr.
 */
export const listLibraryRecorderTakes = Effect.fn('LibraryRecorderTakes.list')(function* ({ inbox, limit }: { inbox?: string; limit?: number }) {
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path, media = yield* LibraryMediaFolder;
  const online = yield* media.isOnline();
  const added = yield* recorderItems();
  const takes: LibraryRecorderTake[] = yield* Effect.forEach(added, ({ item, folder }) => Effect.gen(function* () {
    return {
      folder, recordedAt: item.recordedAt ?? null, durationSeconds: item.durationSeconds,
      item: { id: item.id, mediaFolder: online ? yield* media.itemFolder(item.id) : null },
    };
  }));
  if (inbox && (yield* fs.exists(inbox))) {
    const known = new Set(added.map(({ folder }) => path.basename(folder)));
    for (const name of (yield* fs.readDirectory(inbox)).toSorted()) {
      const folder = path.join(inbox, name);
      if (known.has(name) || !(yield* fs.exists(path.join(folder, 'recording.json')))) continue;
      const read = yield* readRecorderTakeFolder(folder, folder).pipe(
        Effect.map(Option.some),
        Effect.catchTags({
          LibraryFileUnreadable: (error) => Effect.as(Effect.logWarning(`skipping ${error.message}`), Option.none()),
          // A take being added moves its files out while this reads them: it's listed once it's an item.
          PlatformError: (error) => Effect.as(Effect.logWarning(`skipping ${folder}: ${error.message}`), Option.none()),
        }),
      );
      if (Option.isNone(read) || !read.value.ending) continue;
      const { recording } = read.value;
      takes.push({ folder, recordedAt: recording.startedAt, durationSeconds: recording.durationSeconds ?? null, item: null });
    }
  }
  // A take's folder is named by when it began (`2026-11-22 18.19.29`), so its name sorts it.
  const newestFirst = takes.toSorted((a, b) => path.basename(b.folder).localeCompare(path.basename(a.folder)));
  return limit === undefined ? newestFirst : newestFirst.slice(0, limit);
});

/**
 * Removes an item: its media, then its metadata (item.json, transcript, flags), so a remove stopped part way leaves an
 * item that can be removed again, never media nobody lists. Refused while a project uses it or its media is offline.
 */
export const removeLibraryItem = Effect.fn('LibraryRemove.item')(function* (id: string) {
  const store = yield* LibraryStore, media = yield* LibraryMediaFolder, fs = yield* FileSystem.FileSystem;
  const projects = yield* store.projectsUsing(id);
  if (projects.length) yield* new LibraryItemInUse({ id, projects });
  yield* fs.remove(yield* media.itemFolder(id), { recursive: true, force: true });
  yield* store.removeItemMetadata(id);
  yield* Effect.log(`removed ${id}`);
});

/** The add marker in an item's media folder, if one is there and reads. */
const readAddMarker = Effect.fn('LibraryRecorderTakes.readAddMarker')(function* (itemMedia: string) {
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  const file = path.join(itemMedia, LIBRARY_ADD_MARKER_FILE);
  if (!(yield* fs.exists(file))) return Option.none<LibraryAddMarker>();
  return Schema.decodeUnknownOption(LibraryAddMarkerText)(yield* fs.readFileString(file));
});

/**
 * Removes a recorder take wherever it went: the item added from it, media an add stopped part way left without an
 * item, and its folder in the inbox. Refused while the recorder is still writing it or an add is still running on it.
 */
export const removeLibraryRecorderTake = Effect.fn('LibraryRemove.recorderTake')(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path, store = yield* LibraryStore, media = yield* LibraryMediaFolder;
  const name = path.basename(folder);
  const items = (yield* recorderItems()).filter((added) => path.basename(added.folder) === name).map(({ item }) => item.id);
  const leftByAdds: string[] = [];
  if (yield* media.isOnline()) {
    const ids = new Set(yield* store.itemIds());
    for (const id of yield* fs.readDirectory(yield* media.online())) {
      const marker = yield* readAddMarker(path.join(yield* media.online(), id));
      if (Option.isNone(marker) || path.basename(marker.value.take) !== name) continue;
      if (studioProcessRunning(marker.value.process)) yield* new LibraryRequestRefused({ reason: `${name} is still being added to the library: throw it away once that's done` });
      if (!ids.has(id)) leftByAdds.push(id);
    }
  }
  const inInbox = yield* fs.exists(folder);
  const found = items.length > 0 || leftByAdds.length > 0;
  // A folder is removed whole only when it's this take's: a take the add hasn't taken, or one the library names.
  if (inInbox && (!found || (yield* fs.exists(path.join(folder, 'recording.json'))))) {
    const { ending } = yield* readRecorderTakeFolder(folder, folder);
    if (!ending) yield* new LibraryRequestRefused({ reason: `${folder} is still recording` });
  }
  if (!found && !inInbox) yield* new LibraryRequestRefused({ reason: `no take ${name} is in the library or at ${folder}` });
  for (const id of items) yield* removeLibraryItem(id);
  for (const id of leftByAdds) {
    yield* fs.remove(yield* media.itemFolder(id), { recursive: true });
    yield* Effect.log(`removed ${id}'s media, which a stopped add left`);
  }
  if (inInbox) {
    yield* fs.remove(folder, { recursive: true });
    yield* Effect.log(`removed ${folder}`);
  }
});

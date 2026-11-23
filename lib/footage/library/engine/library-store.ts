// library-store.ts: where the library's committed metadata lives, as a service; every file read is decoded. Its
// media is in a media folder set once per machine (library-media-folder.ts). Node only.
//
//   work/library/items/<id>/item.json        the item (library-item.ts)
//   work/library/items/<id>/transcript.json  what its speech track says, on that track's media time
//   work/library/items/<id>/flags.json       its flags, the library's review scope (library-flags.ts)
import type { PlatformError } from 'effect';
import { Context, DateTime, Effect, FileSystem, Layer, Option, Path, Result, Schema } from 'effect';
import { readReviewStore, writeReviewStore, type ReviewStoreScope } from '#lib/output/review/engine/review-store.ts';
import type { ReviewAuthor } from '#lib/output/review/models/review-threads.ts';
import { makeReplaceFileWholeEffect } from '#lib/platform/files/engine/replace-file-whole-effect.ts';
import { STUDIO_PROJECTS_DIR, STUDIO_WORKSPACE_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { assertStudioWorkspace } from '#lib/platform/project/engine/studio-workspace.ts';
import type { LibraryFlagRefused } from '../models/library-errors.ts';
import { LibraryFileUnreadable, LibraryFlagsLocked, LibraryItemAmbiguous, LibraryItemMissing, LibraryItemUnknown, LibraryRequestRefused } from '../models/library-errors.ts';
import { applyLibraryFlagOp, emptyLibraryFlagsFile, LIBRARY_FLAGS_VERSION, LibraryFlagsFile, type LibraryFlag, type LibraryFlagChange, type LibraryFlagOp } from '../models/library-flags.ts';
import { LibraryTranscriptFileText, type LibraryTranscriptFile } from '../models/library-footage.ts';
import { LIBRARY_ITEM_FORMAT, LibraryItemText, type LibraryItem } from '../models/library-item.ts';
import type { LibrarySearchItem } from '../models/library-search.ts';
import { libraryItemsImportedBy } from '../models/library-uses.ts';

type StoreFailure = LibraryFileUnreadable | PlatformError.PlatformError;

export class LibraryStore extends Context.Service<LibraryStore, {
  /** The folder holding item `id`'s metadata. */
  readonly itemDir: (id: string) => string;
  /** Every item's id, oldest first by id; none before the first add. */
  readonly itemIds: () => Effect.Effect<string[], LibraryRequestRefused | PlatformError.PlatformError>;
  readonly readItem: (id: string) => Effect.Effect<LibraryItem, LibraryItemMissing | StoreFailure>;
  readonly writeItem: (item: LibraryItem) => Effect.Effect<void, PlatformError.PlatformError>;
  /**
   * Item `id` re-read and changed by `change`, then written: for a step that ran long, while another process may
   * have changed item.json. Returns the item written.
   */
  readonly updateItem: (id: string, change: (item: LibraryItem) => LibraryItem) => Effect.Effect<LibraryItem, LibraryItemMissing | StoreFailure>;
  /** An item named by its whole id, or a part of it only one id holds. */
  readonly resolveItemId: (named: string) => Effect.Effect<string, LibraryItemUnknown | LibraryItemAmbiguous | LibraryRequestRefused | PlatformError.PlatformError>;
  readonly readTranscript: (id: string) => Effect.Effect<Option.Option<LibraryTranscriptFile>, StoreFailure>;
  /** One word to a line, so a hand correction is a one-line diff. */
  readonly writeTranscript: (id: string, transcript: LibraryTranscriptFile) => Effect.Effect<void, PlatformError.PlatformError>;
  readonly readFlags: (id: string) => Effect.Effect<LibraryFlagsFile, LibraryFileUnreadable>;
  /** Applies `op` to the item's newest flags under their lock, as `by`; the flag it touched. */
  readonly changeFlags: (id: string, op: LibraryFlagOp, by: ReviewAuthor) => Effect.Effect<LibraryFlag, LibraryFlagRefused | LibraryFlagsLocked | LibraryItemMissing | StoreFailure>;
  /** The projects (work/projects/<name>) whose source imports item `id`'s metadata, by name, sorted. */
  readonly projectsUsing: (id: string) => Effect.Effect<string[], PlatformError.PlatformError>;
  /** What search reads of every item: committed metadata alone, never the media. */
  readonly readForSearch: () => Effect.Effect<LibrarySearchItem[], LibraryItemMissing | LibraryRequestRefused | StoreFailure>;
}>()('LibraryStore') {}

/** Where a store keeps its files: the library's folder and the projects whose imports say who uses an item. */
export type LibraryStorePlace = { readonly libraryDir: string; readonly projectsDir: string; readonly workspaceRequired: boolean };

// A project's generated folders: renders, audio and captures hold no source that could import an item.
const PROJECT_GENERATED_DIRS = new Set(['out', 'audio', 'captures', 'node_modules']);

const jsonLines = (items: readonly (LibraryTranscriptFile['words'][number] | LibraryTranscriptFile['pauses'][number])[]) => (items.length ? `[\n${items.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]` : '[]');

/** Why a flags file can't be read or written, as review's store words it. */
const reviewStoreFailure = (path: string) => (cause: unknown) =>
  new LibraryFileUnreadable({ path, reason: `can't be used: ${cause instanceof Error ? cause.message : String(cause)}` });

// review-store throws plain Errors; its lock's timeout, the one a caller can simply retry, is told apart by its wording.
const REVIEW_STORE_LOCK_TIMEOUT = /has been locked by process \d+/;

const reviewStoreWriteFailure = (path: string) => (cause: unknown) =>
  (cause instanceof Error && REVIEW_STORE_LOCK_TIMEOUT.test(cause.message) ? new LibraryFlagsLocked({ path, why: cause.message }) : reviewStoreFailure(path)(cause));

const decodeFlags = Schema.decodeUnknownResult(LibraryFlagsFile);
const decodeFormatOnly = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ format: Schema.String })));

export const makeLibraryStoreLayer = ({ libraryDir, projectsDir, workspaceRequired }: LibraryStorePlace) => Layer.effect(LibraryStore, Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const itemsDir = path.join(libraryDir, 'items');
  const itemDir = (id: string) => path.join(itemsDir, id);

  const replaceWhole = yield* makeReplaceFileWholeEffect;

  const itemIds = Effect.fn('LibraryStore.itemIds')(function* () {
    if (workspaceRequired) yield* Effect.try({ try: assertStudioWorkspace, catch: (cause) => new LibraryRequestRefused({ reason: cause instanceof Error ? cause.message : String(cause) }) });
    if (!(yield* fs.exists(itemsDir))) return [];
    const names = yield* fs.readDirectory(itemsDir);
    const withItem = yield* Effect.filter(names, (name) => fs.exists(path.join(itemsDir, name, 'item.json')));
    return withItem.toSorted();
  });

  const readItem = Effect.fn('LibraryStore.readItem')(function* (id: string) {
    const file = path.join(itemDir(id), 'item.json');
    if (!(yield* fs.exists(file))) return yield* new LibraryItemMissing({ id });
    const text = yield* fs.readFileString(file);
    return yield* Schema.decodeUnknownEffect(LibraryItemText)(text).pipe(Effect.mapError((error) => {
      // Another format is said as such: a newer studio's item, not a broken one.
      const format = Option.map(decodeFormatOnly(text), (read) => read.format).pipe(Option.filter((read) => read !== LIBRARY_ITEM_FORMAT));
      return new LibraryFileUnreadable({ path: file, reason: Option.match(format, { onSome: (read) => `is ${read}, not ${LIBRARY_ITEM_FORMAT}`, onNone: () => `isn't an item the library wrote: ${error.message}` }) });
    }));
  });

  const writeItem = (item: LibraryItem) => replaceWhole(path.join(itemDir(item.id), 'item.json'), `${JSON.stringify(item, null, 2)}\n`);

  const flagsScope = (id: string): ReviewStoreScope<LibraryFlagsFile> => ({ path: path.join(itemDir(id), 'flags.json'), version: LIBRARY_FLAGS_VERSION, empty: emptyLibraryFlagsFile });

  const readFlags = Effect.fn('LibraryStore.readFlags')(function* (id: string) {
    const scope = flagsScope(id);
    const read = yield* Effect.try({ try: () => readReviewStore(scope), catch: reviewStoreFailure(scope.path) });
    return yield* Effect.fromResult(decodeFlags(read)).pipe(
      Effect.mapError((error) => new LibraryFileUnreadable({ path: scope.path, reason: `isn't flags the library wrote: ${error.message}` })),
    );
  });

  const readTranscript = Effect.fn('LibraryStore.readTranscript')(function* (id: string) {
    const file = path.join(itemDir(id), 'transcript.json');
    if (!(yield* fs.exists(file))) return Option.none();
    const transcript = yield* Schema.decodeUnknownEffect(LibraryTranscriptFileText)(yield* fs.readFileString(file)).pipe(
      Effect.mapError((error) => new LibraryFileUnreadable({ path: file, reason: `isn't a transcript the library wrote: ${error.message}` })),
    );
    return Option.some(transcript);
  });

  // Entry types, never stat: a symlink is never followed, so a link loop inside a project can't recurse forever.
  const projectImports = (dir: string, id: string): Effect.Effect<boolean, PlatformError.PlatformError> => Effect.gen(function* () {
    for (const { name, type: listed } of yield* fs.readDirectoryEntries(dir)) {
      if (name.startsWith('.')) continue;
      const entry = path.join(dir, name), type = listed === 'Unknown' ? (yield* fs.lstat(entry)).type : listed;
      if (type === 'SymbolicLink') continue;
      if (type === 'Directory' ? !PROJECT_GENERATED_DIRS.has(name) && (yield* projectImports(entry, id))
        : /\.tsx?$/.test(name) && libraryItemsImportedBy(yield* fs.readFileString(entry)).has(id)) return true;
    }
    return false;
  });

  return LibraryStore.of({
    itemDir,
    itemIds,
    readItem,
    writeItem,
    updateItem: Effect.fn('LibraryStore.updateItem')(function* (id, change) {
      const changed = change(yield* readItem(id));
      yield* writeItem(changed);
      return changed;
    }),
    resolveItemId: Effect.fn('LibraryStore.resolveItemId')(function* (named) {
      const ids = yield* itemIds();
      if (ids.includes(named)) return named;
      const near = ids.filter((id) => id.includes(named));
      if (near.length === 1) return near[0];
      return yield* (near.length ? new LibraryItemAmbiguous({ named, ids: near }) : new LibraryItemUnknown({ named, libraryEmpty: !ids.length }));
    }),
    readTranscript,
    writeTranscript: (id, { track, duration, words, pauses }) =>
      replaceWhole(path.join(itemDir(id), 'transcript.json'), `{\n  "track": ${JSON.stringify(track)},\n  "duration": ${duration},\n  "words": ${jsonLines(words)},\n  "pauses": ${jsonLines(pauses)}\n}\n`),
    readFlags,
    changeFlags: Effect.fn('LibraryStore.changeFlags')(function* (id, op, by) {
      const { durationSeconds } = yield* readItem(id);
      const now = DateTime.formatIso(yield* DateTime.now);
      const scope = flagsScope(id);
      // Decided inside review's lock against the newest file; a refused change writes nothing.
      const change = yield* Effect.try({
        try: () => writeReviewStore(scope, (current): Result.Result<LibraryFlagChange, LibraryFlagRefused | LibraryFileUnreadable> => {
          const decoded = decodeFlags(current);
          if (Result.isFailure(decoded)) return Result.fail(new LibraryFileUnreadable({ path: scope.path, reason: `isn't flags the library wrote: ${decoded.failure.message}` }));
          return applyLibraryFlagOp(decoded.success, op, { by, now, durationSeconds });
        }, (applied) => (Result.isSuccess(applied) ? applied.success.file : undefined)),
        catch: reviewStoreWriteFailure(scope.path),
      });
      return (yield* Effect.fromResult(change)).flag;
    }),
    projectsUsing: Effect.fn('LibraryStore.projectsUsing')(function* (id) {
      if (!(yield* fs.exists(projectsDir))) return [];
      const projects = yield* fs.readDirectory(projectsDir);
      const using = yield* Effect.filter(projects, (name) => Effect.gen(function* () {
        const dir = path.join(projectsDir, name);
        return (yield* fs.stat(dir)).type === 'Directory' && (yield* projectImports(dir, id));
      }));
      return using.toSorted();
    }),
    readForSearch: Effect.fn('LibraryStore.readForSearch')(function* () {
      return yield* Effect.forEach(yield* itemIds(), (id) => Effect.gen(function* () {
        const item = yield* readItem(id), transcript = yield* readTranscript(id), { flags } = yield* readFlags(id);
        return { item, transcript: Option.getOrUndefined(transcript), flags };
      }));
    }),
  });
}));

/** This checkout's workspace's library. */
export const libraryStoreLayer = makeLibraryStoreLayer({ libraryDir: `${STUDIO_WORKSPACE_DIR}/library`, projectsDir: STUDIO_PROJECTS_DIR, workspaceRequired: true });

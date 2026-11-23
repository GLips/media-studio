// library-store.ts: where the library lives. Its metadata is committed in the workspace; its media is in a media folder
// set once per machine, which may be an external drive. Node only.
//
//   work/library/items/<id>/item.json        the item (library-item.ts)
//   work/library/items/<id>/transcript.json  what its speech track says, on that track's media time
//   work/library/items/<id>/flags.json       its flags, the library's review scope (library-flags.ts)
//   <media folder>/<id>/                      its tracks' files, its input log, proxies/
//   work/library.local.json                  this machine's settings, ignored: { "mediaFolder": "/Volumes/…" }
//
// The media folder defaults to work/library/media/, ignored too. Moving it to a drive is a setting, not a migration:
// every path into it is the folder joined with an item's id and a track's file.
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { LibraryTranscriptFile } from '../models/library-footage.ts';
import { readReviewStore, writeReviewStore, type ReviewStoreScope } from '#lib/output/review/engine/review-store.ts';
import type { ReviewAuthor } from '#lib/output/review/models/review-threads.ts';
import { replaceFileWhole } from '#lib/platform/files/engine/replace-file-whole.ts';
import { STUDIO_PROJECTS_DIR, STUDIO_WORKSPACE_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { assertStudioWorkspace } from '#lib/platform/project/engine/studio-workspace.ts';
import { applyLibraryFlagOp, emptyLibraryFlagsFile, LIBRARY_FLAGS_VERSION, type LibraryFlag, type LibraryFlagOp, type LibraryFlagsFile } from '../models/library-flags.ts';
import { LIBRARY_ITEM_FORMAT, type LibraryItem } from '../models/library-item.ts';
import type { LibrarySearchItem } from '../models/library-search.ts';
import { libraryItemsImportedBy } from '../models/library-uses.ts';

export const LIBRARY_DIR = join(STUDIO_WORKSPACE_DIR, 'library');
const LIBRARY_ITEMS_DIR = join(LIBRARY_DIR, 'items');
const DEFAULT_MEDIA_FOLDER = join(LIBRARY_DIR, 'media');
const LIBRARY_SETTINGS_FILE = join(STUDIO_WORKSPACE_DIR, 'library.local.json');

/** This machine's library settings. */
export type LibraryMachineSettings = { mediaFolder?: string };

export function readLibraryMachineSettings(): LibraryMachineSettings {
  // SAFETY: writeLibraryMachineSettings writes it; a hand edit that breaks the shape fails where it's read.
  return existsSync(LIBRARY_SETTINGS_FILE) ? (JSON.parse(readFileSync(LIBRARY_SETTINGS_FILE, 'utf8')) as LibraryMachineSettings) : {};
}

export function writeLibraryMachineSettings(settings: LibraryMachineSettings): void {
  replaceFileWhole(LIBRARY_SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);
}

/** The media folder this machine keeps the library's media in, whether or not it's there now. */
export function libraryMediaFolder(): { path: string; configured: boolean } {
  const { mediaFolder } = readLibraryMachineSettings();
  return mediaFolder ? { path: isAbsolute(mediaFolder) ? mediaFolder : resolve(STUDIO_WORKSPACE_DIR, mediaFolder), configured: true } : { path: DEFAULT_MEDIA_FOLDER, configured: false };
}

/** The library's media folder isn't there: a drive unplugged, or a setting pointing nowhere. */
export class LibraryMediaOffline extends Error {}

/**
 * The media folder, refused with LibraryMediaOffline when it isn't there. The default folder is the workspace's own and
 * is made when `make` is set (adding an item); a configured one is never made, since its absence means a missing drive.
 */
export function onlineLibraryMediaFolder({ make = false }: { make?: boolean } = {}): string {
  const { path, configured } = libraryMediaFolder();
  if (!existsSync(path)) {
    if (make && !configured) mkdirSync(path, { recursive: true });
    else throw new LibraryMediaOffline(`media offline: the library's media folder ${path} isn't there. Plug in the drive it's on, or point the library at where it is now with \`studio library config --media-folder <path>\``);
  }
  return path;
}

/** Whether the media folder is there now: false when it's offline. */
export function libraryMediaIsOnline(): boolean {
  try {
    onlineLibraryMediaFolder();
    return true;
  } catch (error) {
    if (error instanceof LibraryMediaOffline) return false;
    throw error;
  }
}

/** The absolute path of a file in `item`'s media, refused when the media is offline or the file has gone. */
export function libraryMediaPath(item: LibraryItem, file: string): string {
  const path = join(onlineLibraryMediaFolder(), item.id, file);
  if (!existsSync(path)) throw new Error(`${item.id}'s ${file} isn't in the media folder (${path})`);
  return path;
}

export const libraryItemDir = (id: string) => join(LIBRARY_ITEMS_DIR, id);

/** Every item's id, oldest first by id; none before the first add. */
export function listLibraryItemIds(): string[] {
  assertStudioWorkspace();
  if (!existsSync(LIBRARY_ITEMS_DIR)) return [];
  return readdirSync(LIBRARY_ITEMS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(LIBRARY_ITEMS_DIR, d.name, 'item.json'))).map((d) => d.name).toSorted();
}

export function readLibraryItem(id: string): LibraryItem {
  const file = join(libraryItemDir(id), 'item.json');
  if (!existsSync(file)) throw new Error(`there's no library item ${id}: \`studio library list\` lists them`);
  // SAFETY: the library writes item.json; the format check refuses another shape.
  const item = JSON.parse(readFileSync(file, 'utf8')) as Omit<LibraryItem, 'format'> & { format: string };
  if (item.format !== LIBRARY_ITEM_FORMAT) throw new Error(`${file} is ${item.format}, not ${LIBRARY_ITEM_FORMAT}`);
  return { ...item, format: LIBRARY_ITEM_FORMAT };
}

/** An item named by its whole id, or a part of it only one id holds. */
export function resolveLibraryItemId(arg: string): string {
  const ids = listLibraryItemIds();
  if (ids.includes(arg)) return arg;
  const near = ids.filter((id) => id.includes(arg));
  if (near.length === 1) return near[0];
  throw new Error(near.length ? `"${arg}" names ${near.length} items: ${near.join(', ')}` : `there's no library item ${arg}${ids.length ? '' : ': the library is empty'}`);
}

export function writeLibraryItem(item: LibraryItem): void {
  replaceFileWhole(join(libraryItemDir(item.id), 'item.json'), `${JSON.stringify(item, null, 2)}\n`);
}

export function readLibraryTranscript(id: string): LibraryTranscriptFile | undefined {
  const file = join(libraryItemDir(id), 'transcript.json');
  // SAFETY: only writeLibraryTranscript writes it.
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as LibraryTranscriptFile) : undefined;
}

const jsonLines = (items: readonly (LibraryTranscriptFile['words'][number] | LibraryTranscriptFile['pauses'][number])[]) =>
  (items.length ? `[\n${items.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]` : '[]');

/** One word to a line, so a hand correction is a one-line diff. */
export function writeLibraryTranscript(id: string, transcript: LibraryTranscriptFile): void {
  const { track, duration, words, pauses } = transcript;
  replaceFileWhole(join(libraryItemDir(id), 'transcript.json'), `{\n  "track": ${JSON.stringify(track)},\n  "duration": ${duration},\n  "words": ${jsonLines(words)},\n  "pauses": ${jsonLines(pauses)}\n}\n`);
}

const libraryFlagsScope = (id: string): ReviewStoreScope<LibraryFlagsFile> => ({ path: join(libraryItemDir(id), 'flags.json'), version: LIBRARY_FLAGS_VERSION, empty: emptyLibraryFlagsFile });

export const readLibraryFlags = (id: string): LibraryFlagsFile => readReviewStore(libraryFlagsScope(id));

/** Applies `op` to the item's newest flags under their lock, as `by`; the flag it touched. */
export function changeLibraryFlags(id: string, op: LibraryFlagOp, by: ReviewAuthor): LibraryFlag {
  const { durationSeconds } = readLibraryItem(id);
  return writeReviewStore(libraryFlagsScope(id), (current) => applyLibraryFlagOp(current, op, { by, now: new Date().toISOString(), durationSeconds }), (applied) => applied.file).flag;
}

// A project's generated folders: renders, audio and captures hold no source that could import an item.
const PROJECT_GENERATED_DIRS = new Set(['out', 'audio', 'captures', 'node_modules']);

/** The projects (work/projects/<name>) whose source imports item `id`'s metadata, by name, sorted. */
export function projectsUsingLibraryItem(id: string): string[] {
  if (!existsSync(STUDIO_PROJECTS_DIR)) return [];
  const imports = (dir: string): boolean => readdirSync(dir, { withFileTypes: true }).some((entry) => {
    if (entry.name.startsWith('.')) return false;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return !PROJECT_GENERATED_DIRS.has(entry.name) && imports(path);
    return /\.tsx?$/.test(entry.name) && libraryItemsImportedBy(readFileSync(path, 'utf8')).has(id);
  });
  return readdirSync(STUDIO_PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && imports(join(STUDIO_PROJECTS_DIR, d.name))).map((d) => d.name).toSorted();
}

/** What search reads of every item: committed metadata alone, never the media. */
export const readLibraryForSearch = (): LibrarySearchItem[] => listLibraryItemIds().map((id) => ({ item: readLibraryItem(id), transcript: readLibraryTranscript(id), flags: readLibraryFlags(id).flags }));

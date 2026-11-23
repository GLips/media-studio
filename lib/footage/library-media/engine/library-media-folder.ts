// library-media-folder.ts: where this machine keeps the library's media, which may be an external drive. Apart from
// the library's store (library-store.ts) so what serves the media to pages needs nothing of the library but this.
// Node only.
//
//   <media folder>/<id>/                      an item's tracks' files, its input log, proxies/
//   work/library.local.json                  this machine's settings, ignored: { "mediaFolder": "/Volumes/…" }
//
// The media folder defaults to work/library/media/, ignored too. Moving it to a drive is a setting, not a migration:
// every path into it is the folder joined with an item's id and a track's file.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { replaceFileWhole } from '#lib/platform/files/engine/replace-file-whole.ts';
import { STUDIO_WORKSPACE_DIR } from '#lib/platform/project/engine/studio-project.ts';

const DEFAULT_MEDIA_FOLDER = join(STUDIO_WORKSPACE_DIR, 'library', 'media');
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

// library-media-folder.ts: where this machine keeps the library's media, which may be an external drive, as a
// service. Apart from the library's store (library-store.ts) so what serves the media to pages needs nothing of the
// library but this. Node only.
//
//   <media folder>/<id>/                      an item's tracks' files, its input log, proxies/
//   work/library.local.json                  this machine's settings, ignored: { "mediaFolder": "/Volumes/…" }
//
// The media folder defaults to work/library/media/, ignored too. Moving it to a drive is a setting, not a migration:
// every path into it is the folder joined with an item's id and a track's file.
import type { PlatformError } from 'effect';
import { Context, Effect, FileSystem, Layer, Path, Schema } from 'effect';
import { makeReplaceFileWholeEffect } from '#lib/platform/files/engine/replace-file-whole-effect.ts';
import { STUDIO_WORKSPACE_DIR } from '#lib/platform/project/engine/studio-project.ts';

/** This machine's library settings, work/library.local.json. */
export const LibraryMachineSettings = Schema.Struct({ mediaFolder: Schema.optionalKey(Schema.String) });
export type LibraryMachineSettings = typeof LibraryMachineSettings.Type;

const LibraryMachineSettingsText = Schema.fromJsonString(LibraryMachineSettings, { space: 2 });

/** The library's media folder isn't there: a drive unplugged, or a setting pointing nowhere. */
export class LibraryMediaOffline extends Schema.TaggedError<LibraryMediaOffline>()('LibraryMediaOffline', {
  path: Schema.String,
}) {
  override get message(): string {
    return `media offline: the library's media folder ${this.path} isn't there. Plug in the drive it's on, or point the library at where it is now with \`studio library config --media-folder <path>\``;
  }
}

/** A file an item names isn't in its media folder, which is. */
export class LibraryMediaFileMissing extends Schema.TaggedError<LibraryMediaFileMissing>()('LibraryMediaFileMissing', {
  id: Schema.String,
  file: Schema.String,
  path: Schema.String,
}) {
  override get message(): string {
    return `${this.id}'s ${this.file} isn't in the media folder (${this.path})`;
  }
}

/** work/library.local.json isn't settings this studio reads. */
export class LibrarySettingsUnreadable extends Schema.TaggedError<LibrarySettingsUnreadable>()('LibrarySettingsUnreadable', {
  path: Schema.String,
  why: Schema.String,
}) {
  override get message(): string {
    return `${this.path} isn't the library's settings: ${this.why}`;
  }
}

/** Where the media folder is, whether or not it's there now; `configured` when the settings name it. */
export type LibraryMediaLocation = { readonly path: string; readonly configured: boolean };

export class LibraryMediaFolder extends Context.Service<LibraryMediaFolder, {
  readonly settings: () => Effect.Effect<LibraryMachineSettings, LibrarySettingsUnreadable | PlatformError.PlatformError>;
  readonly writeSettings: (settings: LibraryMachineSettings) => Effect.Effect<void, PlatformError.PlatformError>;
  readonly location: () => Effect.Effect<LibraryMediaLocation, LibrarySettingsUnreadable | PlatformError.PlatformError>;
  /**
   * The media folder, refused when it isn't there. The default folder is the workspace's own and is made with `make`
   * (adding an item); a configured one is never made, since its absence means a missing drive.
   */
  readonly online: (options?: { readonly make?: boolean }) => Effect.Effect<string, LibraryMediaOffline | LibrarySettingsUnreadable | PlatformError.PlatformError>;
  /** Whether the media folder is there now. */
  readonly isOnline: () => Effect.Effect<boolean, LibrarySettingsUnreadable | PlatformError.PlatformError>;
  /** The absolute path of `file` in item `id`'s media, refused when the media is offline or the file has gone. */
  readonly itemFile: (id: string, file: string) => Effect.Effect<string, LibraryMediaOffline | LibraryMediaFileMissing | LibrarySettingsUnreadable | PlatformError.PlatformError>;
}>()('LibraryMediaFolder') {}

/** The media folder of the workspace at `workspaceDir`: work/ itself, or a test's stand-in. */
export const makeLibraryMediaFolderLayer = (workspaceDir: string) => Layer.effect(LibraryMediaFolder, Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const replaceWhole = yield* makeReplaceFileWholeEffect;
  const settingsFile = path.join(workspaceDir, 'library.local.json');
  const defaultFolder = path.join(workspaceDir, 'library', 'media');

  const settings = Effect.fn('LibraryMediaFolder.settings')(function* () {
    if (!(yield* fs.exists(settingsFile))) return {};
    return yield* Schema.decodeUnknownEffect(LibraryMachineSettingsText)(yield* fs.readFileString(settingsFile)).pipe(
      Effect.mapError((error) => new LibrarySettingsUnreadable({ path: settingsFile, why: error.message })),
    );
  });

  const location = Effect.fn('LibraryMediaFolder.location')(function* () {
    const { mediaFolder } = yield* settings();
    return mediaFolder ? { path: path.resolve(workspaceDir, mediaFolder), configured: true } : { path: defaultFolder, configured: false };
  });

  const online = Effect.fn('LibraryMediaFolder.online')(function* (options?: { readonly make?: boolean }) {
    const { path: folder, configured } = yield* location();
    if (yield* fs.exists(folder)) return folder;
    if (!options?.make || configured) return yield* new LibraryMediaOffline({ path: folder });
    yield* fs.makeDirectory(folder, { recursive: true });
    return folder;
  });

  return LibraryMediaFolder.of({
    settings,
    location,
    online,
    // Replaced whole, so another process reading it finds the old settings or the new, never half.
    writeSettings: Effect.fn('LibraryMediaFolder.writeSettings')(function* (next) {
      // A value of the settings type always encodes.
      yield* replaceWhole(settingsFile, `${yield* Schema.encodeEffect(LibraryMachineSettingsText)(next).pipe(Effect.orDie)}\n`);
    }),
    isOnline: Effect.fn('LibraryMediaFolder.isOnline')(function* () {
      return yield* fs.exists((yield* location()).path);
    }),
    itemFile: Effect.fn('LibraryMediaFolder.itemFile')(function* (id, file) {
      const full = path.join(yield* online(), id, file);
      if (!(yield* fs.exists(full))) return yield* new LibraryMediaFileMissing({ id, file, path: full });
      return full;
    }),
  });
}));

/** This checkout's workspace's media folder. */
export const libraryMediaFolderLayer = makeLibraryMediaFolderLayer(STUDIO_WORKSPACE_DIR);

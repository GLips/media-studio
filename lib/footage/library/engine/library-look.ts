// library-look.ts: a track of an item seen at a glance: contact sheets of its frames every few seconds, each labelled
// with its item time, so an agent skims a long recording (what's on screen when, who's on camera, private data
// showing) without watching it. Node only; needs the media online.
//
// Sheets are kept beside the item's media (sheets/), named by what they show, so asking again reads them back.
import { Effect, FileSystem, Path } from 'effect';
import { StudioFfmpeg } from '#lib/platform/ffmpeg/engine/studio-ffmpeg.ts';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';
import { tileLabelledImages } from '#lib/platform/raster/engine/contact-sheet.ts';
import { LibraryMediaFolder } from '#lib/footage/library-media/engine/library-media-folder.ts';
import { LibraryRequestRefused, LibrarySheetFailed } from '../models/library-errors.ts';
import { libraryItemTimeOf, libraryMediaTimeOf } from '../models/library-item.ts';
import { LibraryStore } from './library-store.ts';

// A sheet is this wide whatever its columns: four across shows what's on a screen, one across reads its text.
const SHEET_WIDTH = 1920;
/** Frames a sheet of `columns` holds: rows half again its columns, keeping it about square, or one frame alone. */
const framesPerSheet = (columns: number) => (columns === 1 ? 1 : columns * Math.round(columns * 1.5));

/**
 * What to look at: a track of an item, a frame every `every` seconds from `from` to `to` (item seconds), `columns`
 * across a sheet.
 */
export type LibraryLookRequest = { item: string; track?: string; every: number; from?: number; to?: number; columns: number };

const clockLabel = (seconds: number) => {
  const tenths = Math.round(seconds * 10);
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
};

/** Draws the sheets a request asks for, or finds them drawn already; answers their paths in order. */
export const lookAtLibraryTrack = Effect.fn('LibraryLook.sheets')(function* ({ item: asked, track: trackName, every, from = 0, to, columns }: LibraryLookRequest) {
  const store = yield* LibraryStore, media = yield* LibraryMediaFolder, ffmpeg = yield* StudioFfmpeg;
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  const item = yield* store.readItem(yield* store.resolveItemId(asked));
  const pictured = Object.entries(item.tracks).filter(([, t]) => t.video).map(([name]) => name);
  const name = trackName ?? pictured[0];
  const track = name === undefined ? undefined : item.tracks[name];
  if (!track?.video) return yield* new LibraryRequestRefused({ reason: `${item.id} has no ${trackName ? `${trackName} track with a picture` : 'track with a picture'}; its pictures are ${pictured.join(', ') || 'none'}` });
  if (!(every > 0)) return yield* new LibraryRequestRefused({ reason: `--every must be a number of seconds above 0, not ${every}` });
  if (!Number.isInteger(columns) || columns < 1 || columns > 8) return yield* new LibraryRequestRefused({ reason: `--columns must be a whole number from 1 to 8, not ${columns}` });
  const source = yield* media.itemFile(item.id, track.proxy?.file ?? track.file);

  // Only the seconds the track plays: before its start or after its end it shows nothing.
  const first = Math.max(from, libraryItemTimeOf(track, 0)), last = Math.min(to ?? item.durationSeconds, libraryItemTimeOf(track, track.mediaSeconds) - 0.05);
  const times: number[] = [];
  for (let t = first; t <= last; t += every) times.push(Math.round(t * 100) / 100);
  if (!times.length) return yield* new LibraryRequestRefused({ reason: `${item.id}'s ${name} doesn't play between ${from} and ${to ?? item.durationSeconds} s` });

  const folder = path.join(yield* media.itemFolder(item.id), 'sheets');
  yield* fs.makeDirectory(folder, { recursive: true });
  const perSheet = framesPerSheet(columns), width = SHEET_WIDTH / columns, height = Math.round(width * track.video.height / track.video.width / 2) * 2;
  const sheets: string[] = [];
  for (let at = 0; at < times.length; at += perSheet) {
    const shown = times.slice(at, at + perSheet);
    const out = path.join(folder, `${name}-every${every}s-${columns}across-${shown[0].toFixed(2)}-${shown.at(-1)!.toFixed(2)}.jpg`);
    sheets.push(out);
    if (yield* fs.exists(out)) continue;
    yield* Effect.log(`drawing ${path.basename(out)}`);
    const frames = yield* fs.makeTempDirectoryScoped({ directory: yield* Effect.sync(studioTempRoot), prefix: 'library-look-' });
    const cells = yield* Effect.forEach(shown, (t, i) => Effect.gen(function* () {
      const file = path.join(frames, `${i}.jpg`);
      // -ss before -i seeks by keyframe then decodes to the exact time, fast on a proxy's short GOP.
      yield* ffmpeg.run(['-v', 'error', '-y', '-ss', libraryMediaTimeOf(track, t).toFixed(3), '-i', source, '-frames:v', '1', '-vf', `scale=${Math.round(width)}:${height}`, '-q:v', '3', file]);
      return { file, label: clockLabel(t) };
    }), { concurrency: 4 });
    yield* Effect.tryPromise({
      // Drawn under another name, then renamed in whole: a sheet cut short by a kill would be read back as drawn.
      try: () => tileLabelledImages(cells, `${out}.part.jpg`, { cols: columns, w: Math.round(width), h: height }),
      catch: (error) => new LibrarySheetFailed({ path: out, reason: error instanceof Error ? error.message : String(error) }),
    });
    yield* fs.rename(`${out}.part.jpg`, out);
  }
  return sheets;
}, Effect.scoped);

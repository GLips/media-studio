// library-item.ts: one item of footage in the library, as its committed item.json describes it, and how its tracks
// line up. Pure, so it works with the media offline.
//
// One model for all footage: a recording is an item with several tracks and an input log; a single file is an item
// with one track. Each track is a file on its own clock; item time is where they line up.
//
// Sync corrections are numbers on each track, applied when read (libraryItemTimeOf), never baked into the media: a
// wrong one is fixed by editing item.json, and transcript, scenes and review all line tracks up the same way.
import { Schema } from 'effect';
import type { InputLogCoordinates } from '#lib/footage/input-log/models/input-log.ts';
import { RecordingWindowPlacement } from '#lib/footage/recording/models/recording-window-log.ts';
import { RecordingScreenDisplay } from '#lib/footage/recording/models/studio-recording-json.ts';
import { LibraryGradeMeasurement } from './library-grade.ts';

export const LIBRARY_ITEM_FORMAT = 'studio-library-item/1';

/** What a track's file holds, from ffprobe when it was added. */
export const LibraryTrackStreams = Schema.Struct({
  video: Schema.optionalKey(Schema.Struct({ width: Schema.Finite, height: Schema.Finite, fps: Schema.Finite, variableRate: Schema.Boolean, codec: Schema.String })),
  /** No `sampleRate` where ffprobe read none. */
  audio: Schema.optionalKey(Schema.Struct({ sampleRate: Schema.optionalKey(Schema.Finite), channels: Schema.Finite, codec: Schema.String })),
});
export type LibraryTrackStreams = typeof LibraryTrackStreams.Type;

/** The geometry of the display a screen track recorded, as the recorder wrote it: maps an input log's points onto its pixels. */
export const LibraryScreenDisplay = RecordingScreenDisplay;
export type LibraryScreenDisplay = RecordingScreenDisplay;

/**
 * The window a screen track recorded, and where it sat through the take, on item time: each placement holds from its
 * `t` until the next. Maps an input log's points onto the track's pixels moment by moment, as the window moved.
 */
export const LibraryScreenWindow = Schema.Struct({
  title: Schema.String,
  app: Schema.String,
  placements: Schema.NonEmptyArray(RecordingWindowPlacement),
});
export type LibraryScreenWindow = typeof LibraryScreenWindow.Type;

/** An editing proxy: constant frame rate, edit-friendly size, made once from the track. The original stays the source for final render. */
export const LibraryTrackProxy = Schema.Struct({ file: Schema.String, width: Schema.Finite, height: Schema.Finite, fps: Schema.Finite });
export type LibraryTrackProxy = typeof LibraryTrackProxy.Type;

/**
 * A speech track's sound levelled for the mix: a copy on the track's own media time, brought up (or down) to about
 * LIBRARY_LEVELLED_LUFS, and its loudness as measured. A raw mic can sit 20 dB under a voice line; the mix only lowers.
 */
export const LibraryTrackLevelled = Schema.Struct({
  file: Schema.String,
  lufs: Schema.Finite,
  /** The chain it was made with, libraryLevelledProcessing's; a copy made with another (or none recorded) is stale. */
  processing: Schema.optionalKey(Schema.String),
  /** Where the copy is quiet ([start, end] media seconds, libraryQuietSpans), which a line's edges land in. */
  quiet: Schema.optionalKey(Schema.Array(Schema.Tuple([Schema.Finite, Schema.Finite]))),
});
export type LibraryTrackLevelled = typeof LibraryTrackLevelled.Type;

/**
 * How spoken track `track`'s levelled copy is made, named so a copy made another way is remade. A mic's room noise
 * drops in and out at every cut, so once levelled an 80 Hz high-pass takes its rumble and RNNoise, at a 0.8 mix, its
 * hiss, leaving a faint floor. The system track is clean, so it's levelled alone.
 */
export const libraryLevelledProcessing = (track: string) => (track === 'system' ? 'loudnorm' : 'loudnorm+highpass80+rnnoise-sh-0.8');

/** Where a levelled copy is brought to: above the mix's voice level, so the mix only ever lowers it. */
export const LIBRARY_LEVELLED_LUFS = -16;

export const LibraryTrack = Schema.Struct({
  ...LibraryTrackStreams.fields,
  /** In the item's media folder. */
  file: Schema.String,
  /** The file's own length, in its media time. */
  mediaSeconds: Schema.Finite,
  /** Item time at the track's media time 0. */
  startSeconds: Schema.Finite,
  /** How late the device delivers against the world (the Elgato camera path is about 0.16 s). */
  latencySeconds: Schema.optionalKey(Schema.Finite),
  /** How far the track's sample clock ran from the host clock over its whole length (a mic's drift); none is none. */
  hostDriftSeconds: Schema.optionalKey(Schema.Finite),
  device: Schema.optionalKey(Schema.String),
  /** A screen track's display, or its window. */
  display: Schema.optionalKey(LibraryScreenDisplay),
  window: Schema.optionalKey(LibraryScreenWindow),
  proxy: Schema.optionalKey(LibraryTrackProxy),
  levelled: Schema.optionalKey(LibraryTrackLevelled),
  /** A camera track's colour as `studio grade` measured it, which every look grades it from. */
  grade: Schema.optionalKey(LibraryGradeMeasurement),
});
export type LibraryTrack = typeof LibraryTrack.Type;

/**
 * Where an item came from: the recorder's folder for a recording, else the files it was added from. `interrupted`:
 * the recorder was killed mid-take, so it lost up to its last 2 s and wrote no duration.
 */
export const LibraryItemSource = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('studio-recorder'), folder: Schema.String, status: Schema.Literals(['complete', 'interrupted']) }),
  Schema.Struct({ kind: Schema.Literal('files'), paths: Schema.Array(Schema.String) }),
]);
export type LibraryItemSource = typeof LibraryItemSource.Type;

const LibraryInputCoordinates = Schema.Literals(['global-points', 'viewport-css-pixels'] satisfies readonly InputLogCoordinates[]);

export const LibraryItem = Schema.Struct({
  format: Schema.Literal(LIBRARY_ITEM_FORMAT),
  /** Its folder's name in the library and the media folder: `2026-11-22-181929`, or `2026-11-22-<title slug>`. */
  id: Schema.String,
  title: Schema.String,
  source: LibraryItemSource,
  /** ISO time the footage began, where known. */
  recordedAt: Schema.optionalKey(Schema.String),
  addedAt: Schema.String,
  /** Item time from 0 to the last track's end. */
  durationSeconds: Schema.Finite,
  /** By name: `screen`, `camera`, `mic` for a recording, `video` or `audio` for a single file, else the caller's. */
  tracks: Schema.Record(Schema.String, LibraryTrack),
  /** The person recording's track: a line's default source, and the shelf's opening words. None when no track has sound. */
  speech: Schema.optionalKey(Schema.String),
  /** The input log (input.jsonl in the media folder), on item time. */
  input: Schema.optionalKey(Schema.Struct({ file: Schema.String, coordinates: LibraryInputCoordinates })),
  /** What went wrong with a track during the take, by track, as the recorder reported it. */
  problems: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  /** Tracks the source named that the item holds no file for, and why. */
  leftOut: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type LibraryItem = typeof LibraryItem.Type;

/** item.json's text, parsed and decoded. */
export const LibraryItemText = Schema.fromJsonString(LibraryItem);

/**
 * The item time of `mediaSeconds` into `track`: its start, plus media time stretched by its clock's drift against the
 * host, less the device's latency. The recorder spike's model: video tracks carry no drift term.
 */
export function libraryItemTimeOf(track: LibraryTrack, mediaSeconds: number): number {
  const rate = 1 + (track.hostDriftSeconds ?? 0) / track.mediaSeconds;
  return track.startSeconds + mediaSeconds * rate - (track.latencySeconds ?? 0);
}

/** The media time in `track` at `itemSeconds`, libraryItemTimeOf's inverse; outside 0…mediaSeconds the track isn't playing. */
export function libraryMediaTimeOf(track: LibraryTrack, itemSeconds: number): number {
  const rate = 1 + (track.hostDriftSeconds ?? 0) / track.mediaSeconds;
  return (itemSeconds - track.startSeconds + (track.latencySeconds ?? 0)) / rate;
}

/**
 * A global point as it lands in a screen track's own pixels (the original's, not a proxy's). `inside`: on the display
 * it recorded, or within its window as the window sat then.
 */
export type LibraryScreenPoint = { x: number; y: number; inside: boolean };

/**
 * Where `point`, in an input log's global points, lands in screen track `track` at item second `t`. A point outside
 * is placed where it would be, beside the picture. A click on another window lying over the recorded one counts as
 * inside: the input log doesn't say which window took it. Throws for a track with no display or window.
 */
export function libraryScreenPointOf(track: LibraryTrack, t: number, point: { x: number; y: number }): LibraryScreenPoint {
  const { boundsPoints: [left, top, width, height], contentPixels: [pictureLeft, pictureTop, pictureWidth, pictureHeight] } = screenPlacementAt(track, t);
  return {
    x: pictureLeft + ((point.x - left) * pictureWidth) / width,
    y: pictureTop + ((point.y - top) * pictureHeight) / height,
    inside: point.x >= left && point.x < left + width && point.y >= top && point.y < top + height,
  };
}

/** Where a screen track's picture came from on screen at item second `t`, and where it sits in the track. */
function screenPlacementAt({ file, display, window }: LibraryTrack, t: number): Pick<RecordingWindowPlacement, 'boundsPoints' | 'contentPixels'> {
  if (window) return window.placements.findLast((p) => p.t <= t) ?? window.placements[0];
  if (display) return { boundsPoints: display.boundsPoints, contentPixels: [0, 0, display.widthPixels, display.heightPixels] };
  throw new Error(`${file} has no display or window to place a point on: is it a screen track?`);
}

/** Item time from 0 to the latest track's end. */
export const libraryItemDuration = (tracks: Readonly<Record<string, LibraryTrack>>): number =>
  Math.max(0, ...Object.values(tracks).map((track) => libraryItemTimeOf(track, track.mediaSeconds)));

// A proxy fits in this box at this rate: a 5K screen or 4K camera scrubs and edits like HD.
const PROXY_MAX_WIDTH = 1920, PROXY_MAX_HEIGHT = 1080;
export const LIBRARY_PROXY_FPS = 30;

/** The size and rate of a proxy a track needs. */
export type LibraryProxySize = { width: number; height: number; fps: number };

/**
 * The proxy a track needs, by its size and rate, or none: one whose video is variable-rate, larger than HD or not
 * H.264 (HEVC may not decode on Linux render workers) gets one at HD size and LIBRARY_PROXY_FPS.
 */
export function libraryProxyNeeded({ video }: LibraryTrackStreams): LibraryProxySize | undefined {
  if (!video) return undefined;
  const large = video.width > PROXY_MAX_WIDTH || video.height > PROXY_MAX_HEIGHT;
  if (!large && !video.variableRate && video.codec === 'h264') return undefined;
  const scale = Math.min(1, PROXY_MAX_WIDTH / video.width, PROXY_MAX_HEIGHT / video.height);
  // Even sides, as H.264's 4:2:0 needs.
  const even = (v: number) => Math.max(2, Math.round((v * scale) / 2) * 2);
  return { width: even(video.width), height: even(video.height), fps: LIBRARY_PROXY_FPS };
}

/** The proxies `item` needs and hasn't made yet, by track: derived from item.json, the one record of what's made. */
export const libraryProxiesWanted = (item: LibraryItem): { track: string; size: LibraryProxySize }[] =>
  Object.entries(item.tracks).flatMap(([track, streams]) => {
    const size = libraryProxyNeeded(streams);
    return size && !streams.proxy ? [{ track, size }] : [];
  });

/** The track to hear speech from: the mic, else the first with sound but the system's, which is the Mac's own sound. */
export function librarySpeechTrack(tracks: Readonly<Record<string, LibraryTrackStreams>>): string | undefined {
  if (tracks.mic?.audio) return 'mic';
  return Object.entries(tracks).find(([name, track]) => track.audio && name !== 'system')?.[0];
}

/**
 * The tracks a line can be spoken from, each transcribed and levelled: every track with sound, its speech first. A
 * call's far side (a voice agent, a meeting) is heard on `system`; a track with no speech has an empty transcript.
 */
export function librarySpokenTracks(item: LibraryItem): string[] {
  const audible = Object.keys(item.tracks).filter((name) => item.tracks[name].audio);
  return audible.toSorted((a, b) => Number(b === item.speech) - Number(a === item.speech));
}

/** `lg-ultrafine-trial`: lower case, words joined by hyphens, at most 48 characters. */
export function librarySlug(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'footage';
}

/** `base`, or `base-2`, `base-3`… past the ids taken. */
export function unusedLibraryItemId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** The picture an item leads with (its screen, else its first track with picture), and the rest inset over it. */
export function libraryPictureTracksOf(item: LibraryItem): { main?: string; insets: string[] } {
  const pictures = Object.entries(item.tracks).filter(([, t]) => t.video).map(([name]) => name);
  const main = pictures.includes('screen') ? 'screen' : pictures[0];
  return { main, insets: pictures.filter((name) => name !== main).slice(0, 1) };
}

/** Where the shelf takes an item's poster from: a file in its media folder, and seconds of that file's media time. */
export type LibraryPosterFrame = { file: string; seconds: number };

/** How far into an item its poster is taken: past a take's opening, where the recorder's own window tends to sit. */
const LIBRARY_POSTER_AT = 1 / 3;

/** The poster of `item`: its leading picture a third of the way in, from its proxy where it has one. None without picture. */
export function libraryPosterFrameOf(item: LibraryItem): LibraryPosterFrame | undefined {
  const { main } = libraryPictureTracksOf(item);
  if (!main) return undefined;
  const track = item.tracks[main];
  const seconds = Math.min(Math.max(0, libraryMediaTimeOf(track, item.durationSeconds * LIBRARY_POSTER_AT)), track.mediaSeconds);
  return { file: track.proxy?.file ?? track.file, seconds };
}

/** What a track's name says its source is: the recorder's names (`system` is the Mac's own sound), or a single file's. */
export type LibrarySourceKind = 'screen' | 'camera' | 'mic' | 'system' | 'video' | 'audio' | 'other';

const LIBRARY_SOURCE_ORDER: readonly LibrarySourceKind[] = ['screen', 'camera', 'mic', 'system', 'video', 'audio', 'other'];

const LIBRARY_SOURCE_LABELS: Partial<Record<LibrarySourceKind, string>> = { system: 'System audio' };

const librarySourceKindOf = (track: string): LibrarySourceKind => LIBRARY_SOURCE_ORDER.find((kind) => kind === track) ?? 'other';

/**
 * `item`'s tracks as sources, each named in words (`screen` reads Screen, `system` System audio), in one order whatever
 * item.json's: screen, camera, mic, system, then a file's video or audio.
 */
export function librarySourcesOf(item: LibraryItem): { track: string; kind: LibrarySourceKind; label: string }[] {
  return Object.keys(item.tracks).map((track) => {
    const kind = librarySourceKindOf(track);
    return { track, kind, label: LIBRARY_SOURCE_LABELS[kind] ?? track.charAt(0).toUpperCase() + track.slice(1) };
  })
    .toSorted((a, b) => LIBRARY_SOURCE_ORDER.indexOf(a.kind) - LIBRARY_SOURCE_ORDER.indexOf(b.kind));
}

/** The title a recording is added with: `Recording 2026-11-23 21.25.22`, after its take folder's name. */
export const libraryRecorderTitle = (folderName: string) => `Recording ${folderName}`;

/** Whether `item` still has the title the recorder gave it: only a date, which the shelf shows once, in its own column. */
export function libraryItemHasRecorderTitle(item: LibraryItem): boolean {
  return item.source.kind === 'studio-recorder' && item.title === libraryRecorderTitle(item.source.folder.split('/').at(-1) ?? '');
}

/** `4:17`: an item's length to the nearest second, as a shelf reads it; the review clock's minutes, without hundredths. */
export function formatLibraryLength(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

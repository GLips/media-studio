// library-item.ts: one item of footage in the library, as its committed item.json describes it, and how its tracks
// line up. Pure, so it works with the media offline.
//
// One model for all footage: a recording is an item with several tracks and an input log; a single file is an item
// with one track. Each track is a file on its own clock; item time is where they line up.
//
// Sync corrections are numbers on each track, applied when read (libraryItemTimeOf), never baked into the media: a
// wrong one is fixed by editing item.json, and transcript, scenes and review all line tracks up the same way.
import type { InputLogCoordinates } from '#lib/footage/input-log/models/input-log.ts';

export const LIBRARY_ITEM_FORMAT = 'studio-library-item/1';

/** What a track's file holds, from ffprobe when it was added. */
export type LibraryTrackStreams = {
  video?: { width: number; height: number; fps: number; variableRate: boolean; codec: string };
  audio?: { sampleRate: number; channels: number; codec: string };
};

/** The geometry of the display a screen track recorded, which maps an input log's global points onto its pixels. */
export type LibraryScreenDisplay = {
  name: string;
  /** The display's [x, y, width, height] in global points: origin at the main display's top left, y down. */
  boundsPoints: readonly [number, number, number, number];
  scale: number;
  widthPixels: number;
  heightPixels: number;
};

/** An editing proxy: constant frame rate, edit-friendly size, made once from the track. The original stays the source for final render. */
export type LibraryTrackProxy = { file: string; width: number; height: number; fps: number };

/**
 * A speech track's sound levelled for the mix: a copy on the track's own media time, brought up (or down) to about
 * LIBRARY_LEVELLED_LUFS, and its loudness as measured. A raw mic can sit 20 dB under a voice line; the mix only lowers.
 */
export type LibraryTrackLevelled = { file: string; lufs: number };

/** Where a levelled copy is brought to: above the mix's voice level, so the mix only ever lowers it. */
export const LIBRARY_LEVELLED_LUFS = -16;

export type LibraryTrack = LibraryTrackStreams & {
  /** In the item's media folder. */
  file: string;
  /** The file's own length, in its media time. */
  mediaSeconds: number;
  /** Item time at the track's media time 0. */
  startSeconds: number;
  /** How late the device delivers against the world (the Elgato camera path is about 0.16 s). */
  latencySeconds?: number;
  /** How far the track's sample clock ran from the host clock over its whole length (a mic's drift); none is none. */
  hostDriftSeconds?: number;
  device?: string;
  display?: LibraryScreenDisplay;
  proxy?: LibraryTrackProxy;
  levelled?: LibraryTrackLevelled;
};

/** Where an item came from: the recorder's folder for a recording, else the files it was added from. */
export type LibraryItemSource =
  /** `interrupted`: the recorder was killed mid-take, so it lost up to its last 2 s and wrote no duration. */
  | { kind: 'studio-recorder'; folder: string; status: 'complete' | 'interrupted' }
  | { kind: 'files'; paths: readonly string[] };

export type LibraryItem = {
  format: typeof LIBRARY_ITEM_FORMAT;
  /** Its folder's name in the library and the media folder: `2026-11-22-181929`, or `2026-11-22-<title slug>`. */
  id: string;
  title: string;
  source: LibraryItemSource;
  /** ISO time the footage began, where known. */
  recordedAt?: string;
  addedAt: string;
  /** Item time from 0 to the last track's end. */
  durationSeconds: number;
  /** By name: `screen`, `camera`, `mic` for a recording, `video` or `audio` for a single file, else the caller's. */
  tracks: Readonly<Record<string, LibraryTrack>>;
  /** The track transcript.json was heard from; none when no track has sound. */
  speech?: string;
  /** The input log (input.jsonl in the media folder), on item time. */
  input?: { file: string; coordinates: InputLogCoordinates };
  /** What went wrong with a track during the take, by track, as the recorder reported it. */
  problems?: Readonly<Record<string, string>>;
  /** Tracks the source named that the item holds no file for, and why. */
  leftOut?: Readonly<Record<string, string>>;
};

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

/** Item time from 0 to the latest track's end. */
export const libraryItemDuration = (tracks: Readonly<Record<string, LibraryTrack>>): number =>
  Math.max(0, ...Object.values(tracks).map((track) => libraryItemTimeOf(track, track.mediaSeconds)));

// A proxy fits in this box at this rate: a 5K screen or 4K camera scrubs and edits like HD.
const PROXY_MAX_WIDTH = 1920, PROXY_MAX_HEIGHT = 1080;
export const LIBRARY_PROXY_FPS = 30;

/**
 * The proxy a track needs, by its size and rate, or none: one whose video is variable-rate, larger than HD or not
 * H.264 (HEVC may not decode on Linux render workers) gets one at HD size and LIBRARY_PROXY_FPS.
 */
export function libraryProxyNeeded({ video }: LibraryTrackStreams): { width: number; height: number; fps: number } | undefined {
  if (!video) return undefined;
  const large = video.width > PROXY_MAX_WIDTH || video.height > PROXY_MAX_HEIGHT;
  if (!large && !video.variableRate && video.codec === 'h264') return undefined;
  const scale = Math.min(1, PROXY_MAX_WIDTH / video.width, PROXY_MAX_HEIGHT / video.height);
  // Even sides, as H.264's 4:2:0 needs.
  const even = (v: number) => Math.max(2, Math.round((v * scale) / 2) * 2);
  return { width: even(video.width), height: even(video.height), fps: LIBRARY_PROXY_FPS };
}

/** The track to hear speech from: the mic, else the first with sound. */
export function librarySpeechTrack(tracks: Readonly<Record<string, LibraryTrackStreams>>): string | undefined {
  if (tracks.mic?.audio) return 'mic';
  return Object.entries(tracks).find(([, track]) => track.audio)?.[0];
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

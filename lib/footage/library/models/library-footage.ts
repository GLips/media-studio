// library-footage.ts: a library item as a project uses it: its tracks and how they line up, what's said in it on item
// time, and stretches of its speech for a storyboard's lines. Pure, from the item's committed metadata, which a
// project imports by the item's id, so a storyboard loads it in plain Node and a page bundles it, the media offline:
//
//   import item from '#library/<id>/item.json' with { type: 'json' };
//   import transcript from '#library/<id>/transcript.json' with { type: 'json' };
//   const footage = libraryFootage(item, transcript);
//
// Those imports are how a project refers to footage: `studio library show` lists an item's projects by them.
import type { FootageTranscript } from '#lib/footage/transcript/models/footage-transcript.ts';
import type { SpokenWord } from '#lib/footage/transcript/models/spoken-word.ts';
import { inputLogWaypoints, type InputLog } from '#lib/footage/input-log/models/input-log.ts';
import type { TimedPoint } from '#lib/picture/camera/models/follow-point.ts';
import type { SceneClock } from '#lib/timing/timeline/models/video-layout.ts';
import type { RecordedSpeech } from '#lib/timing/voice/models/recorded-speech.ts';
import { LIBRARY_ITEM_FORMAT, libraryItemTimeOf, libraryMediaTimeOf, type LibraryItem } from './library-item.ts';

/** An item's transcript.json: what its speech track says, on that track's media time. */
export type LibraryTranscriptFile = FootageTranscript & { track: string };

/** A library item as a project uses it (libraryFootage). */
export type LibraryFootage = {
  item: LibraryItem;
  /** Every word said in it, on item time; none for an item with no speech or no transcript yet. */
  words: readonly SpokenWord[];
  /**
   * The stretch from `from` to `to`, in item seconds, as a storyboard line's `speech`: what's said in it and its
   * levelled sound. Find the seconds with `studio library search` or `show`.
   */
  speech(from: number, to: number): RecordedSpeech;
  /**
   * The item second a scene shows at its time `s.t`, kept to its lines spoken in this item: within a line, where it's
   * being said; after one, running on from it until the next line jumps; before the first, running up to it.
   */
  timeAt(s: SceneClock): number;
  /**
   * Where the cursor went over screen track `track`, in that track's video pixels and item seconds, from the item's
   * input log (useLibraryInputLog loads it): for followPointAt to aim a camera. Moves off that screen are left out.
   */
  cursorOn(track: string, log: InputLog): TimedPoint[];
};

/** What a project imports of an item.json: read as the library wrote it once its format is checked. */
type LibraryItemJson = { format: string; id: string };

/**
 * An item from its imported item.json and transcript.json. Refuses metadata in a format this studio doesn't read, and a
 * transcript that isn't of the item's speech track.
 */
export function libraryFootage(itemJson: LibraryItemJson, transcript?: LibraryTranscriptFile): LibraryFootage {
  if (itemJson.format !== LIBRARY_ITEM_FORMAT) throw new Error(`library item ${itemJson.id} is ${itemJson.format}, not ${LIBRARY_ITEM_FORMAT}: this studio can't read it`);
  // SAFETY: the library writes item.json as a LibraryItem, and its format is the one checked above.
  const item = itemJson as LibraryItem;
  const speechTrack = item.speech === undefined ? undefined : item.tracks[item.speech];
  if (transcript && transcript.track !== item.speech) throw new Error(`${item.id}'s transcript is of ${transcript.track}, but its speech is ${item.speech ?? 'none'}`);
  const words = speechTrack && transcript
    ? transcript.words.map((w) => ({ text: w.text, start: libraryItemTimeOf(speechTrack, w.start), end: libraryItemTimeOf(speechTrack, w.end) }))
    : [];
  return {
    item,
    words,
    speech(from, to) {
      if (!speechTrack) throw new Error(`${item.id} has no speech track to speak a line from`);
      // A word belongs to the stretch its middle falls in, so a cut a little inside its edge keeps or drops it whole.
      const heard = words.filter((w) => (w.start + w.end) / 2 >= from && (w.start + w.end) / 2 <= to)
        .map((w) => ({ text: w.text, start: Math.max(0, w.start - from), end: Math.min(to - from, w.end - from) }));
      // A stretch reaching outside the speech track has no sound there to play.
      const first = libraryItemTimeOf(speechTrack, 0), last = libraryItemTimeOf(speechTrack, speechTrack.mediaSeconds);
      if (from < first || to > last) throw new Error(`${item.id}'s speech runs ${first.toFixed(3)}–${last.toFixed(3)} s: a line can't be spoken from ${from}–${to} s`);
      const { levelled } = speechTrack;
      const sound = levelled ? { item: item.id, file: levelled.file, start: libraryMediaTimeOf(speechTrack, from), lufs: levelled.lufs } : null;
      return { item: item.id, from, to, heard, sound };
    },
    cursorOn(name, log) {
      const { display, video } = item.tracks[name] ?? {};
      if (!display || !video) throw new Error(`${item.id}'s ${name} has no display geometry to place the cursor on: is it a screen track?`);
      if (log.coordinates !== 'global-points') throw new Error(`${item.id}'s input log is in ${log.coordinates}, not the display's points`);
      // To the video's own pixels, which a recorder may have scaled from the display's.
      const [left, top, width, height] = display.boundsPoints, scale = video.width / width;
      return inputLogWaypoints(log).flatMap((p) => (p.x >= left && p.x < left + width && p.y >= top && p.y < top + height
        ? [{ t: p.t, x: (p.x - left) * scale, y: (p.y - top) * scale }]
        : []));
    },
    timeAt(s) {
      const spans = s.lines.flatMap((id) => {
        const { start, speech } = s.line(id);
        return speech?.item === item.id ? [{ start, from: speech.from }] : [];
      });
      if (!spans.length) throw new Error(`this scene speaks no line from ${item.id}, so nothing says which of its seconds to show`);
      const current = spans.findLast((line) => line.start <= s.t) ?? spans[0];
      return current.from + (s.t - current.start);
    },
  };
}

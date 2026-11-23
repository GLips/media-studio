// library-footage.ts: a library item as a project uses it: its tracks and how they line up, what's said in it on item
// time, and stretches of its speech for a storyboard's lines. Pure, from the item's committed metadata, which a
// project imports by the item's id, so a storyboard loads it in plain Node and a page bundles it, the media offline:
//
//   import item from '#library/<id>/item.json' with { type: 'json' };
//   import transcript from '#library/<id>/transcript.json' with { type: 'json' };
//   const footage = libraryFootage(item, transcript);
//
// Those imports are how a project refers to footage: `studio library show` lists an item's projects by them.
import { Result, Schema } from 'effect';
import { FootageTranscript } from '#lib/footage/transcript/models/footage-transcript.ts';
import type { SpokenWord } from '#lib/footage/transcript/models/spoken-word.ts';
import { inputLogWaypoints, type InputLog } from '#lib/footage/input-log/models/input-log.ts';
import type { TimedPoint } from '#lib/picture/camera/models/follow-point.ts';
import type { SceneClock } from '#lib/timing/timeline/models/video-layout.ts';
import type { RecordedSpeech } from '#lib/timing/voice/models/recorded-speech.ts';
import { LibraryFileUnreadable } from './library-errors.ts';
import { LIBRARY_ITEM_FORMAT, LibraryItem, libraryItemTimeOf, libraryMediaTimeOf } from './library-item.ts';

/** An item's transcript.json: what its speech track says, on that track's media time. */
export const LibraryTranscriptFile = Schema.Struct({ track: Schema.String, ...FootageTranscript.fields });
export type LibraryTranscriptFile = typeof LibraryTranscriptFile.Type;

/** transcript.json's text, parsed and decoded. */
export const LibraryTranscriptFileText = Schema.fromJsonString(LibraryTranscriptFile);

/** A library item as a project uses it (libraryFootage). */
export type LibraryFootage = {
  item: LibraryItem;
  /** Every word said in it, on item time; none for an item with no speech or no transcript yet. */
  words: readonly SpokenWord[];
  /**
   * The words said between `from` and `to`, in item seconds, as a storyboard line's `speech`: what's said and its
   * levelled sound. A word is in when its middle is; each edge then moves into the pause beside the words kept, so
   * the times `studio library search` and `show` print (a line's start, the next line's start) cut cleanly.
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

/**
 * What a project imports of an item.json: JSON whose literals TypeScript widens (a format is any string), so it's
 * decoded, never trusted.
 */
type LibraryItemJsonImport = { readonly format: string; readonly id: string };

// Quiet a spoken line keeps beside its words, at most half the pause it's cut in: a soft first consonant can sit under
// the quiet level, and a last word's decay runs longer than its attack.
const CUT_QUIET_BEFORE = 0.15, CUT_QUIET_AFTER = 0.25;
// A transcript places a word's edge at the pause beside it (wordsTimedAtPauses), give or take a frame of rounding.
const WORD_EDGE_SLACK = 0.02;
const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

const decodeLibraryItem = Schema.decodeUnknownResult(LibraryItem);
const decodeLibraryTranscript = Schema.decodeUnknownResult(LibraryTranscriptFile);

/**
 * An item from its imported item.json and transcript.json, each decoded. Refuses metadata in a format this studio
 * doesn't read, and a transcript that isn't of the item's speech track, with a LibraryFileUnreadable.
 */
export function libraryFootage(itemJson: LibraryItemJsonImport, transcriptJson?: LibraryTranscriptFile): LibraryFootage {
  const named = `library item ${itemJson.id}`;
  if (itemJson.format !== LIBRARY_ITEM_FORMAT) throw new LibraryFileUnreadable({ path: named, reason: `is ${itemJson.format}, not ${LIBRARY_ITEM_FORMAT}: this studio can't read it` });
  const decoded = decodeLibraryItem(itemJson);
  if (Result.isFailure(decoded)) throw new LibraryFileUnreadable({ path: named, reason: `isn't an item the library wrote: ${decoded.failure.message}` });
  const item = decoded.success;
  const transcriptRead = transcriptJson && decodeLibraryTranscript(transcriptJson);
  if (transcriptRead && Result.isFailure(transcriptRead)) throw new LibraryFileUnreadable({ path: `${item.id}'s transcript`, reason: `isn't a transcript the library wrote: ${transcriptRead.failure.message}` });
  const transcript = transcriptRead?.success;
  const speechTrack = item.speech === undefined ? undefined : item.tracks[item.speech];
  if (transcript && transcript.track !== item.speech) throw new LibraryFileUnreadable({ path: `${item.id}'s transcript`, reason: `is of ${transcript.track}, but its speech is ${item.speech ?? 'none'}` });
  const words = speechTrack && transcript
    ? transcript.words.map((w) => ({ text: w.text, start: libraryItemTimeOf(speechTrack, w.start), end: libraryItemTimeOf(speechTrack, w.end) }))
    : [];
  const pauses = speechTrack && transcript
    ? transcript.pauses.map((p) => ({ start: libraryItemTimeOf(speechTrack, p.start), end: libraryItemTimeOf(speechTrack, p.end) }))
    : [];
  /**
   * `from` and `to` moved into the pauses touching the words whose middles lie between them: a cut on a word's raw
   * time clips its first or last sound. Words that run into the next with no pause are cut midway. With no transcript
   * there are no pauses to cut in, so they stay.
   */
  const cutInPauses = (from: number, to: number) => {
    if (!transcript) return { from, to };
    const first = words.findIndex((w) => (w.start + w.end) / 2 >= from);
    const last = words.findLastIndex((w) => (w.start + w.end) / 2 <= to);
    if (first < 0 || last < first) throw new Error(`${item.id} has no words said between ${from} and ${to} s to speak a line from`);
    const start = words[first].start, end = words[last].end;
    const before = pauses.findLast((p) => Math.abs(p.end - start) <= WORD_EDGE_SLACK && p.start < start);
    const after = pauses.find((p) => Math.abs(p.start - end) <= WORD_EDGE_SLACK && p.end > end);
    return {
      from: round(before ? before.end - Math.min(CUT_QUIET_BEFORE, (before.end - before.start) / 2) : (start + (words[first - 1]?.end ?? start)) / 2),
      to: round(after ? after.start + Math.min(CUT_QUIET_AFTER, (after.end - after.start) / 2) : (end + (words[last + 1]?.start ?? end)) / 2),
    };
  };
  return {
    item,
    words,
    speech(asked, askedTo) {
      if (!speechTrack) throw new Error(`${item.id} has no speech track to speak a line from`);
      const { from, to } = cutInPauses(asked, askedTo);
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

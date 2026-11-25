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
import { FootageTranscript, transcriptLines, type TranscriptLine } from '#lib/footage/transcript/models/footage-transcript.ts';
import type { SpokenWord } from '#lib/footage/transcript/models/spoken-word.ts';
import { inputLogWaypoints, type InputLog, type InputWaypoint } from '#lib/footage/input-log/models/input-log.ts';
import type { TimedPoint } from '#lib/picture/camera/models/follow-point.ts';
import type { SceneClock } from '#lib/timing/timeline/models/video-layout.ts';
import type { RecordedSpeech } from '#lib/timing/voice/models/recorded-speech.ts';
import { LibraryFileUnreadable } from './library-errors.ts';
import { LIBRARY_ITEM_FORMAT, LibraryItem, type LibraryTrack, libraryItemTimeOf, libraryMediaTimeOf, libraryScreenPointOf } from './library-item.ts';

/**
 * An item's transcript.json: what each spoken track (every track with sound) says, by track name, each on its own
 * media time. A call's far side is its `system` track.
 */
export const LibraryTranscriptFile = Schema.Struct({ tracks: Schema.Record(Schema.String, FootageTranscript) });
export type LibraryTranscriptFile = typeof LibraryTranscriptFile.Type;

/** A word said in an item, on item time, and the spoken track it was heard on. */
export type LibraryWord = SpokenWord & { track: string };

/** A transcript line as read, on item time: one track's words, run together until a pause or the other side speaks. */
export type LibraryTranscriptLine = TranscriptLine & { track: string };

/** transcript.json's text, parsed and decoded. */
export const LibraryTranscriptFileText = Schema.fromJsonString(LibraryTranscriptFile);

/**
 * A cursor waypoint on a screen track, in its video pixels and item seconds. `inside`: on the display it recorded, or
 * within its window then; a waypoint outside is placed where it would be, beside the picture.
 */
export type LibraryScreenWaypoint = InputWaypoint & { inside: boolean };

/** A library item as a project uses it (libraryFootage). */
export type LibraryFootage = {
  item: LibraryItem;
  /** Every word said on any spoken track, each with its track, in reading order (libraryTranscriptLines's); none before its transcript. */
  words: readonly LibraryWord[];
  /**
   * The words on spoken `track` (the item's speech unless named; `system` for a call's far side) whose middles lie
   * between `from` and `to` (item seconds), as a line's `speech`: what's said and its levelled sound. Each edge moves
   * into the pause beside the words, so `studio library show`'s times cut cleanly. Throws when no word lies between.
   */
  speech(from: number, to: number, track?: string): RecordedSpeech;
  /**
   * The item second a scene shows at its time `s.t`, kept to its lines spoken in this item: within a line, where it's
   * being said; after one, running on from it until the next line jumps; before the first, running up to it.
   */
  timeAt(s: SceneClock): number;
  /**
   * Every move, drag and click of the item's input log (useLibraryInputLog loads it) on screen track `track`, in
   * that track's video pixels and item seconds, each saying whether it was on what the track recorded.
   */
  waypointsOn(track: string, log: InputLog): LibraryScreenWaypoint[];
  /**
   * Where the cursor went over screen track `track`, as waypointsOn places it: for followPointAt to aim a camera.
   * Moves off the recorded display or outside the recorded window are left out.
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

/** A track a line can be spoken from, its words and pauses on item time. `untranscribed`: its transcript wasn't given. */
type LibraryVoice = { track: LibraryTrack; words: LibraryWord[]; pauses: { start: number; end: number }[]; untranscribed?: true };

const decodeLibraryItem = Schema.decodeUnknownResult(LibraryItem);
const decodeLibraryTranscript = Schema.decodeUnknownResult(LibraryTranscriptFile);

/**
 * An item from its imported item.json and transcript.json, each decoded. Refuses metadata in a format this studio
 * doesn't read, and a transcript of a track the item has no sound on, with a LibraryFileUnreadable.
 */
export function libraryFootage(itemJson: LibraryItemJsonImport, transcriptJson?: LibraryTranscriptFile): LibraryFootage {
  const named = `library item ${itemJson.id}`;
  if (itemJson.format !== LIBRARY_ITEM_FORMAT) throw new LibraryFileUnreadable({ path: named, reason: `is ${itemJson.format}, not ${LIBRARY_ITEM_FORMAT}: this studio can't read it` });
  const decoded = decodeLibraryItem(itemJson);
  if (Result.isFailure(decoded)) throw new LibraryFileUnreadable({ path: named, reason: `isn't an item the library wrote: ${decoded.failure.message}` });
  const item = decoded.success;
  const read = transcriptJson && decodeLibraryTranscript(transcriptJson);
  if (read && Result.isFailure(read)) throw new LibraryFileUnreadable({ path: `${item.id}'s transcript`, reason: `isn't a transcript the library wrote: ${read.failure.message}` });
  const voices = new Map(Object.entries(read?.success.tracks ?? {}).map(([name, heard]) => {
    const track = item.tracks[name];
    if (!track?.audio) throw new LibraryFileUnreadable({ path: `${item.id}'s transcript`, reason: `has ${name}, a track ${item.id} has no sound on` });
    const voice: LibraryVoice = {
      track,
      words: heard.words.map((w) => ({ text: w.text, start: libraryItemTimeOf(track, w.start), end: libraryItemTimeOf(track, w.end), track: name })),
      pauses: heard.pauses.map((p) => ({ start: libraryItemTimeOf(track, p.start), end: libraryItemTimeOf(track, p.end) })),
    };
    return [name, voice] as const;
  }));
  // In reading order: each track's lines (its words run together until a pause) by when they start, so two sides
  // talking over each other read as two whole lines, not their words shuffled together.
  const allWords = [...voices.values()].flatMap((voice) => transcriptLines(voice).map((line) => voice.words.slice(line.firstWord, line.firstWord + line.wordCount)))
    .toSorted((x, y) => x[0].start - y[0].start).flat();
  const voiceOf = (name: string): LibraryVoice | undefined => {
    if (voices.has(name)) return voices.get(name);
    const track = item.tracks[name];
    return track ? { track, words: [], pauses: [], untranscribed: true } : undefined;
  };
  /**
   * `from` and `to` moved into the pauses touching the words whose middles lie between them: a cut on a word's raw
   * time clips its first or last sound. Words that run into the next with no pause are cut midway. With no transcript
   * there are no pauses to cut in, so they stay.
   */
  const cutInPauses = ({ words, pauses, untranscribed }: LibraryVoice, from: number, to: number) => {
    if (untranscribed) return { from, to };
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
  const waypointsOn = (name: string, log: InputLog): LibraryScreenWaypoint[] => {
    const track = item.tracks[name];
    if (!track) throw new Error(`${item.id} has no track ${name}`);
    if (log.coordinates !== 'global-points') throw new Error(`${item.id}'s input log is in ${log.coordinates}, not the screen's points`);
    return inputLogWaypoints(log).map(({ t, x, y, click }) => {
      const placed = libraryScreenPointOf(track, t, { x, y });
      return { t, x: placed.x, y: placed.y, click, inside: placed.inside };
    });
  };
  return {
    item,
    words: allWords,
    speech(asked, askedTo, name = item.speech) {
      const voice = name === undefined ? undefined : voiceOf(name);
      if (!name || !voice) throw new Error(`${item.id} has no ${name ?? 'speech'} track to speak a line from`);
      const { track } = voice;
      // A track starting on a fraction of a millisecond can round an edge on its first or last word just outside it.
      const first = libraryItemTimeOf(track, 0), last = libraryItemTimeOf(track, track.mediaSeconds);
      const cut = cutInPauses(voice, asked, askedTo);
      const from = Math.max(first, cut.from), to = Math.min(last, cut.to);
      const heard = voice.words.filter((w) => (w.start + w.end) / 2 >= from && (w.start + w.end) / 2 <= to)
        .map((w) => ({ text: w.text, start: Math.max(0, w.start - from), end: Math.min(to - from, w.end - from) }));
      // A stretch reaching outside the track has no sound there to play.
      if (from < first || to > last) throw new Error(`${item.id}'s ${name} runs ${first.toFixed(3)}–${last.toFixed(3)} s: a line can't be spoken from ${from}–${to} s`);
      const { levelled } = track;
      const sound = levelled ? { item: item.id, file: levelled.file, start: libraryMediaTimeOf(track, from), lufs: levelled.lufs } : null;
      return { item: item.id, from, to, heard, sound };
    },
    waypointsOn,
    cursorOn(name, log) {
      return waypointsOn(name, log).flatMap(({ t, x, y, inside }) => (inside ? [{ t, x, y }] : []));
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

/**
 * `words` (libraryFootage's, in reading order) as lines to read: each line one track's, broken at a pause or where
 * the other side speaks. `firstWord` indexes `words`.
 */
export function libraryTranscriptLines(words: readonly LibraryWord[]): LibraryTranscriptLine[] {
  const runs: { track: string; first: number; words: LibraryWord[] }[] = [];
  words.forEach((word, i) => {
    const run = runs.at(-1);
    if (run?.track === word.track) run.words.push(word);
    else runs.push({ track: word.track, first: i, words: [word] });
  });
  return runs.flatMap((run) => transcriptLines(run).map((line) => Object.assign(line, { firstWord: run.first + line.firstWord, track: run.track })));
}

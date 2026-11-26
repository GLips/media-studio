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
import { spokenItemTimeAt, type RecordedSpeech, type SpokenEdge, type SpokenStretch } from '#lib/timing/voice/models/recorded-speech.ts';
import { LibraryFileUnreadable } from './library-errors.ts';
import { cutLibraryLine, type LibraryLineCleanup, type LibraryLineEdits, type LibraryLineSound, type LibraryLineVoice } from './library-line-cut.ts';
import { librarySyllableRate } from './library-pause-pacing.ts';
import { LIBRARY_QUIET_WINDOW } from './library-quiet.ts';
import { LIBRARY_ITEM_FORMAT, LibraryItem, type LibraryTrack, libraryItemTimeOf, libraryMediaTimeOf, libraryScreenPointOf } from './library-item.ts';

/**
 * An item's transcript.json: what each spoken track (every track with sound) says, by track name, each on its own
 * media time. A call's far side is its `system` track. `heardBy` names the transcriber that heard it
 * (FootageTranscriber's), so `studio library finish` hears a transcript made another way again.
 */
export const LibraryTranscriptFile = Schema.Struct({ heardBy: Schema.String, tracks: Schema.Record(Schema.String, FootageTranscript) });
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
   * The words on spoken `track` (the item's speech unless named; `system` for a call's far side) with middles between
   * `from` and `to` (item seconds), as a line's `speech`: its edges in the quiet beside them (`rough` where none is,
   * which the plan flags), cleaned as the footage says unless `edits` say otherwise (library-line-cut.ts).
   */
  speech(from: number, to: number, edits?: LibrarySpeechEdits): RecordedSpeech;
  /**
   * The item second a scene shows at its time `s.t`, kept to its lines spoken in this item: within a line and after
   * it, running on from its start, so a screen plays on across what it cut out, until the next line jumps; before
   * the first, running up to it. A face takes heardAt.
   */
  timeAt(s: SceneClock): number;
  /** As timeAt, but within a line, the item second being heard: it jumps where the line cut something out. */
  heardAt(s: SceneClock): number;
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

/** One line's choices: the track it's spoken on, its cleanup over the footage's, and moments it keeps or cuts. */
export type LibrarySpeechEdits = LibraryLineEdits & { track?: string };

/**
 * What a project imports of an item.json: JSON whose literals TypeScript widens (a format is any string), so it's
 * decoded, never trusted.
 */
type LibraryItemJsonImport = { readonly format: string; readonly id: string };

// Fades a recorded line plays with, by edge: a clean edge only needs the click taken off; a rough one cuts into sound.
const EDGE_FADES = { clean: { in: 0.03, out: 0.06 }, rough: { in: 0.06, out: 0.12 } } as const;

/** `spans` of `track`'s levelled copy (media seconds) on item time; none before it's levelled. */
const onItemTime = (track: LibraryTrack, spans: readonly (readonly [number, number])[] = []): Span[] =>
  spans.map(([start, end]) => ({ start: libraryItemTimeOf(track, start), end: libraryItemTimeOf(track, end) }));

type Span = { start: number; end: number };
/**
 * A track a line can be spoken from, on item time: its words and pauses, the speech whisper wrote no word for, and
 * where its levelled copy is quiet, breathes and clicks (none before it's levelled). `untranscribed`: its transcript
 * wasn't given.
 */
type LibraryVoice = {
  track: LibraryTrack; words: LibraryWord[]; pauses: Span[]; unheard: Span[]; untranscribed?: true;
} & Omit<LibraryLineVoice, 'sounds'>;

const levelledSpans = (track: LibraryTrack) => ({
  envelope: track.levelled?.rms ? {
    levels: Uint8Array.from(atob(track.levelled.rms), (byte) => byte.charCodeAt(0)),
    start: libraryItemTimeOf(track, 0), step: libraryItemTimeOf(track, LIBRARY_QUIET_WINDOW) - libraryItemTimeOf(track, 0),
  } : undefined,
  quiet: onItemTime(track, track.levelled?.quiet), soft: onItemTime(track, track.levelled?.soft), clicks: onItemTime(track, track.levelled?.clicks),
});

const decodeLibraryItem = Schema.decodeUnknownResult(LibraryItem);
const decodeLibraryTranscript = Schema.decodeUnknownResult(LibraryTranscriptFile);

/**
 * An item from its imported item.json and transcript.json, each decoded, its lines cleaned by `cleanup` (each line's
 * own edits win). Refuses metadata in a format this studio doesn't read, and a transcript of a track the item has no
 * sound on, with a LibraryFileUnreadable.
 */
export function libraryFootage(itemJson: LibraryItemJsonImport, transcriptJson?: LibraryTranscriptFile, cleanup: LibraryLineCleanup = {}): LibraryFootage {
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
      pauses: onItemTime(track, heard.pauses.map((p) => [p.start, p.end])),
      unheard: onItemTime(track, heard.unheard.map((p) => [p.start, p.end])),
      ...levelledSpans(track),
    };
    voice.syllableRate = librarySyllableRate(voice.words, voice.quiet);
    return [name, voice] as const;
  }));
  // In reading order: each track's lines (its words run together until a pause) by when they start, so two sides
  // talking over each other read as two whole lines, not their words shuffled together.
  const allWords = [...voices.values()].flatMap((voice) => transcriptLines(voice).map((line) => voice.words.slice(line.firstWord, line.firstWord + line.wordCount)))
    .toSorted((x, y) => x[0].start - y[0].start).flat();
  const voiceOf = (name: string): LibraryVoice | undefined => {
    if (voices.has(name)) return voices.get(name);
    const track = item.tracks[name];
    return track ? { track, words: [], pauses: [], unheard: [], ...levelledSpans(track), untranscribed: true } : undefined;
  };
  /** The line `from`–`to` on `voice`, cut by `edits`; untranscribed, it plays whole between the moments asked. */
  const cutOf = (voice: LibraryVoice, from: number, to: number, edits: LibraryLineEdits) => {
    if (voice.untranscribed) {
      const edgeAt = (t: number): SpokenEdge => (voice.quiet.some((q) => q.start <= t && t <= q.end) ? 'clean' : 'rough');
      return { from, to, edges: { in: edgeAt(from), out: edgeAt(to) }, pieces: [{ from, to }], joins: [], removals: [], unheard: [], heard: [], dips: [], pauses: [], sound: { pieces: [{ from, to }], joins: [] } };
    }
    const sounds: LibraryLineSound[] = [...voice.words, ...voice.unheard.map((u) => ({ text: '', ...u, unheard: true as const }))].toSorted((a, b) => a.start - b.start);
    return cutLibraryLine({ ...voice, sounds }, from, to, edits, item.id);
  };
  /** The item second a scene shows at `s.t`: `within` a line `t` seconds in (or before its start, or past its end). */
  const lineTimeAt = (s: SceneClock, within: (speech: SpokenStretch, t: number) => number) => {
    const spans = s.lines.flatMap((id) => {
      const { start, speech } = s.line(id);
      return speech?.item === item.id ? [{ start, speech }] : [];
    });
    if (!spans.length) throw new Error(`this scene speaks no line from ${item.id}, so nothing says which of its seconds to show`);
    const current = spans.findLast((line) => line.start <= s.t) ?? spans[0];
    return s.t < current.start ? current.speech.from + (s.t - current.start) : within(current.speech, s.t - current.start);
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
    speech(asked, askedTo, { track: name = item.speech, ...edits } = {}) {
      const voice = name === undefined ? undefined : voiceOf(name);
      if (!name || !voice) throw new Error(`${item.id} has no ${name ?? 'speech'} track to speak a line from`);
      const { track } = voice;
      const cut = cutOf(voice, asked, askedTo, { ...cleanup, ...edits });
      // A track starting on a fraction of a millisecond can round an edge on its first or last word just outside it.
      const first = libraryItemTimeOf(track, 0), last = libraryItemTimeOf(track, track.mediaSeconds);
      const pieces = cut.pieces.map((p, k) => ({ ...p, from: k ? p.from : Math.max(first, p.from), to: k < cut.pieces.length - 1 ? p.to : Math.min(last, p.to) }));
      const from = pieces[0].from, to = pieces.at(-1)!.to;
      // A stretch reaching outside the track has no sound there to play.
      if (from < first || to > last) throw new Error(`${item.id}'s ${name} runs ${first.toFixed(3)}–${last.toFixed(3)} s: a line can't be spoken from ${from}–${to} s`);
      const fade = { in: EDGE_FADES[cut.edges.in].in, out: EDGE_FADES[cut.edges.out].out };
      const { levelled } = track;
      let at = 0;
      const soundPieces = cut.sound.pieces.map((p, k) => ({ ...p, from: k ? p.from : Math.max(first, p.from), to: k < cut.sound.pieces.length - 1 ? p.to : Math.min(last, p.to) }));
      const sound = levelled && {
        item: item.id, file: levelled.file, lufs: levelled.lufs, fade, joins: cut.sound.joins, dips: cut.dips,
        pieces: soundPieces.map((p) => {
          const piece = { start: libraryMediaTimeOf(track, p.from), at, duration: p.to - p.from };
          at += piece.duration;
          return piece;
        }),
      };
      return { item: item.id, from, to, pieces, removals: cut.removals, unheard: cut.unheard, heard: cut.heard, pauses: cut.pauses, edges: cut.edges, sound: sound ?? null };
    },
    waypointsOn,
    cursorOn(name, log) {
      return waypointsOn(name, log).flatMap(({ t, x, y, inside }) => (inside ? [{ t, x, y }] : []));
    },
    timeAt: (s) => lineTimeAt(s, (speech, t) => speech.from + t),
    heardAt: (s) => lineTimeAt(s, spokenItemTimeAt),
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

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
      const { levelled } = speechTrack;
      const sound = levelled ? { item: item.id, file: levelled.file, start: libraryMediaTimeOf(speechTrack, from), lufs: levelled.lufs } : null;
      return { item: item.id, from, to, heard, sound };
    },
  };
}

// recorded-speech.ts: a line spoken in a recording rather than read by a voice, as a storyboard names it (`speech` on a
// line) and a video plays it. The library makes one from an item and a range (libraryFootage's `speech`); timing,
// captions, cues and the mix take it as they take a voice's clip.
//
// A stretch keeps its source in and out: nothing is cut or copied, so a picture laid against it stays in sync, and
// moving an edge is an edit to the storyboard, not a re-import.

import type { SpokenWord } from '#lib/footage/transcript/models/spoken-word.ts';

/**
 * Where a line's sound is in a library item's media: `file`, from `start` seconds into it, faded in and out over
 * `fade` seconds at its edges, longer where an edge cuts into sound.
 */
export type LibraryVoiceSound = { item: string; file: string; start: number; fade: { in: number; out: number } };

/** A line edge in the quiet beside its words (`clean`), or cutting into sound because no quiet came before the next word (`rough`). */
export type SpokenEdge = 'clean' | 'rough';

/** Where in a library item a line is spoken: its id, and the stretch's edges in item seconds. */
export type SpokenStretch = { item: string; from: number; to: number };

/**
 * A stretch of a library recording a line is spoken in: its item, its edges in item seconds and whether each lands
 * in quiet, what the item's transcript heard in it (from `from`), and its sound: the spoken track levelled for the
 * mix, with its loudness, or null while the item has no levelled copy (`studio library finish` makes it).
 */
export type RecordedSpeech = SpokenStretch & {
  heard: readonly SpokenWord[];
  edges: { in: SpokenEdge; out: SpokenEdge };
  sound: (LibraryVoiceSound & { lufs: number }) | null;
};

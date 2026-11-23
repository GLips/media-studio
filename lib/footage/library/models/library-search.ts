// library-search.ts: finding footage by what's said in it and what its flags note. Pure: it reads each item's committed
// transcript and flags, never its media, so search works with the media folder offline.
import { transcriptLines, type FootageTranscript } from '#lib/footage/transcript/models/footage-transcript.ts';
import type { LibraryFlag } from './library-flags.ts';
import { libraryItemTimeOf, type LibraryItem } from './library-item.ts';

/** What search reads of one item. */
export type LibrarySearchItem = { item: LibraryItem; transcript?: FootageTranscript; flags: readonly LibraryFlag[] };

/** A match, its range in item time; `text` is the transcript's line around it, or the flag's note. */
export type LibrarySearchHit =
  | { item: string; on: 'transcript'; start: number; end: number; text: string }
  | { item: string; on: 'flag'; flag: number; start: number; end: number; text: string };

// Whisper writes punctuation and capitals a speaker never chose; search compares the words alone.
const searchToken = (word: string) => word.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Every place in `items` that says `query` (its words in order, ignoring case and punctuation), and every flag whose
 * note says it (its words in order, as the transcript is matched), in the order of `items`, each item's in time order.
 */
export function searchLibrary(items: readonly LibrarySearchItem[], query: string): LibrarySearchHit[] {
  const wanted = query.split(/\s+/).map(searchToken).filter(Boolean);
  if (!wanted.length) throw new Error('search for at least one word');
  return items.flatMap(({ item, transcript, flags }) => {
    const spoken = transcript && item.speech ? transcriptHits(item, item.tracks[item.speech], transcript, wanted) : [];
    const flagged = flags.filter((f) => f.note && holdsTokens(f.note.split(/\s+/).map(searchToken).filter(Boolean), wanted))
      .map((f): LibrarySearchHit => ({ item: item.id, on: 'flag', flag: f.id, start: f.start, end: f.end, text: f.note ?? '' }));
    return [...spoken, ...flagged].toSorted((a, b) => a.start - b.start);
  });
}

const tokensAt = (tokens: readonly string[], i: number, wanted: readonly string[]) => wanted.every((token, k) => tokens[i + k] === token);
const holdsTokens = (tokens: readonly string[], wanted: readonly string[]) => tokens.some((_, i) => tokensAt(tokens, i, wanted));

function transcriptHits(item: LibraryItem, track: LibraryItem['tracks'][string], transcript: FootageTranscript, wanted: readonly string[]): LibrarySearchHit[] {
  const tokens = transcript.words.map((w) => searchToken(w.text)), lines = transcriptLines(transcript), hits: LibrarySearchHit[] = [];
  for (let i = 0; i + wanted.length <= tokens.length; i++) {
    if (!tokensAt(tokens, i, wanted)) continue;
    const first = transcript.words[i], last = transcript.words[i + wanted.length - 1];
    const line = lines.find((l) => l.start <= first.start && first.start <= l.end);
    hits.push({ item: item.id, on: 'transcript', start: libraryItemTimeOf(track, first.start), end: libraryItemTimeOf(track, last.end), text: line?.text ?? '' });
  }
  return hits;
}

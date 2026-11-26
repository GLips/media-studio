// library-pause-pacing.ts: how long a recorded line keeps each pause. A pause longer than its kind keeps is cut in its
// quiet, keeping the room after one word and the run into the next, like any other cut a line makes.
//
// Prior art: Audacity's Truncate Silence and Descript's "Shorten word gaps" (a target length). Unlike them, a pause's
// target depends on what it's for (spoken-pauses.ts): Adobe warns that removing pauses in bulk flattens the ones held
// for effect.
import { spokenWordKey } from '#lib/footage/transcript/models/spoken-disfluencies.ts';
import type { SpokenPauseClassifier, SpokenPauseKind } from '#lib/footage/transcript/models/spoken-pauses.ts';
import type { SpokenWord } from '#lib/footage/transcript/models/spoken-word.ts';

/**
 * How long a line keeps its pauses. Seconds are for a speaker at LIBRARY_REFERENCE_SYLLABLE_RATE: a slower one's
 * targets stretch, a faster one's shrink, within a third either way.
 */
export type LibraryPausePacing = {
  /** How long a pause mid-phrase plays at most, word to word, in seconds. */
  hesitation: number;
  /** How long a pause where a sentence or clause ends plays at least once shortened, in seconds; a break keeps this. */
  boundary: number;
  /** The share of a boundary pause past `boundary` it keeps (0 to 1), so one held for effect stays longer than a plain one. */
  boundaryExcess: number;
  /** Seconds of quiet past which a pause is a break between takes, cut to `boundary` whatever it was for. */
  breakFrom: number;
  /** What each pause is for. Default spokenPauseKindOf. */
  classify?: SpokenPauseClassifier;
};

/** The pacing a line gets unless its cleanup says otherwise: conservative, so a pause that carries meaning still reads. */
// breakFrom: in the library's takes, pauses inside a thought run to about 2.5 s; nearly every longer one is the
// speaker stopping (reading, waiting, starting over).
export const LIBRARY_PAUSE_PACING: LibraryPausePacing = { hesitation: 0.3, boundary: 0.6, boundaryExcess: 0.25, breakFrom: 2.5 };

// A pause at least this long where the speaker then says again what they'd just said is a restart, so a break.
const RESTART_PAUSE = 1;
/** Each two words in a row of `words`, as keys. */
const wordPairsOf = (words: readonly SpokenWord[]) => words.slice(0, -1).map((w, k) => `${spokenWordKey(w)} ${spokenWordKey(words[k + 1])}`);

/**
 * Whether a pause heard for `heard` seconds between the words `before` and `after` it is a break between takes: past
 * `breakFrom`, or a restart, where the first words after repeat two in a row of the last before.
 */
export function libraryPauseIsBreak(heard: number, before: readonly SpokenWord[], after: readonly SpokenWord[], { breakFrom }: Pick<LibraryPausePacing, 'breakFrom'>): boolean {
  if (heard >= breakFrom) return true;
  if (heard < RESTART_PAUSE) return false;
  const said = new Set(wordPairsOf(before.slice(-4)));
  return wordPairsOf(after.slice(0, 3)).some((pair) => said.has(pair));
}

/**
 * Syllables a second, pauses left out, of the speaker pacing's seconds are written for. Conversational English runs
 * 4.5 to 6 (articulation rate); this studio's own takes measure about 5.
 */
export const LIBRARY_REFERENCE_SYLLABLE_RATE = 5;
// A speaker this far from the reference still gets targets near it: whisper's word timings measure the rate roughly.
const RATE_SCALE_MIN = 0.75, RATE_SCALE_MAX = 1.33;

// Vowel groups, less a silent final e: a count within a syllable of a dictionary's on most English words.
const syllablesIn = (text: string) => {
  const word = text.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return 0;
  return Math.max(1, (word.replace(/(?<=[^aeiouy])e$/, '').match(/[aeiouy]+/g) ?? []).length);
};

/**
 * The speaker's articulation rate over `words`, in syllables a second: their syllables over the time they sound, with
 * the `quiet` whisper stretched a word across left out. Undefined with too few words to say.
 */
export function librarySyllableRate(words: readonly SpokenWord[], quiet: readonly { start: number; end: number }[]): number | undefined {
  let syllables = 0, sounding = 0, q = 0;
  for (const word of words) {
    while (q < quiet.length && quiet[q].end <= word.start) q++;
    let silent = 0;
    for (let k = q; k < quiet.length && quiet[k].start < word.end; k++) silent += Math.min(word.end, quiet[k].end) - Math.max(word.start, quiet[k].start);
    syllables += syllablesIn(word.text);
    sounding += Math.max(0, word.end - word.start - silent);
  }
  return syllables >= 20 && sounding > 0 ? syllables / sounding : undefined;
}

/** How much a speaker at `rate` syllables a second stretches pacing's seconds. */
export const libraryPaceScale = (rate: number | undefined) =>
  rate === undefined ? 1 : Math.min(RATE_SCALE_MAX, Math.max(RATE_SCALE_MIN, LIBRARY_REFERENCE_SYLLABLE_RATE / rate));

/** How long a pause of `kind` heard for `heard` seconds plays, word to word, under `pacing` scaled by `scale`. */
export function libraryPauseTarget(kind: SpokenPauseKind, heard: number, pacing: LibraryPausePacing, scale: number): number {
  const target = (kind === 'hesitation' ? pacing.hesitation : pacing.boundary) * scale;
  if (heard <= target) return heard;
  return kind === 'boundary' ? target + (heard - target) * pacing.boundaryExcess : target;
}

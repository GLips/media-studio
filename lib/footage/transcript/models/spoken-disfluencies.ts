// spoken-disfluencies.ts: what a verbatim transcript says that a cleaned line leaves out: hesitations, stutters, false
// starts. Each kind is a rule over a run of words, so a project writes its own (lexical fillers it wants gone, a phrase
// it always retakes) the same way and passes it beside these. Pure.
//
// Negative space: lexical fillers ("like", "you know", "so", "I mean") are left in, as only context says when one is
// filler; a filler fused into the word beside it ("and-uh") is one word, so it stays with that word.
import type { SpokenWord } from './spoken-word.ts';

/**
 * Words a rule takes out of a line: `count` words from `first` (indexes into the words it was given), the rule's
 * `kind`, and `flag` when review should listen twice (which of two takes was kept).
 */
export type SpokenDisfluency = { kind: string; first: number; count: number; flag?: string };

/** A rule finding disfluencies in a line's words, in any order; overlapping finds are fine. */
export type SpokenDisfluencyRule = (words: readonly SpokenWord[]) => SpokenDisfluency[];

/** A word as compared: lower case, letters, digits and apostrophes only. */
export const spokenWordKey = (word: SpokenWord) => word.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

// Non-lexical hesitations, as whisper spells them led by a verbatim prompt. "hmm" and "ah" carry a thought or a
// reaction, so they stay.
const NON_LEXICAL_FILLERS = new Set(['uh', 'uhh', 'um', 'umm', 'uhm', 'er', 'erm']);

/** Standalone non-lexical fillers: uh, um, er. */
export const spokenFillers: SpokenDisfluencyRule = (words) =>
  words.flatMap((word, first) => (NON_LEXICAL_FILLERS.has(spokenWordKey(word)) ? [{ kind: 'filler', first, count: 1 }] : []));

/**
 * Words cut off mid-word, which whisper writes ending in a dash, that the speaker then starts again: "we- we went",
 * "inst- installed", or the phrase restarted, "the tr- the bar", which takes the words it restarts too. One followed by
 * another word ("drive the- session") is a hesitation, so it stays.
 */
export const spokenFalseStarts: SpokenDisfluencyRule = (words) => {
  const keys = words.map(spokenWordKey);
  return words.flatMap((word, first): SpokenDisfluency[] => {
    if (!/\p{L}[-–—]+$/u.test(word.text) || first + 1 >= words.length) return [];
    if (keys[first + 1].startsWith(keys[first])) return [{ kind: 'false start', first, count: 1 }];
    const led = [1, 2].find((n) => first - n >= 0 && keys.slice(first - n, first).every((key, k) => key !== '' && key === keys[first + 1 + k]));
    return led ? [{ kind: 'false start', first: first - led, count: led + 1 }] : [];
  });
};

// The longest phrase a retake repeats that this rule finds.
const RETAKE_MAX_WORDS = 6;
// Words English says twice on purpose: "I know that that works", "it had had", "what it is is".
const MEANT_TWICE = new Set(['that', 'had', 'is']);

/**
 * A word or phrase said again at once: a stutter ("I I") or a retake ("each agent has, each agent has a"). The earlier
 * is taken out; a retake of more than a word is flagged, as the later take may not be the better one.
 */
export const spokenRepeats: SpokenDisfluencyRule = (words) => {
  const keys = words.map(spokenWordKey), found: SpokenDisfluency[] = [];
  const same = (a: number, b: number, n: number) => keys.slice(a, a + n).every((key, k) => key !== '' && key === keys[b + k]);
  for (let i = 0; i < words.length;) {
    const n = [...Array(RETAKE_MAX_WORDS).keys()].map((k) => RETAKE_MAX_WORDS - k)
      .find((len) => i + 2 * len <= words.length && same(i, i + len, len) && !(len === 1 && MEANT_TWICE.has(keys[i])));
    if (n === undefined) {
      i++;
      continue;
    }
    found.push({ kind: n > 1 ? 'retake' : 'repeat', first: i, count: n, ...(n > 1 && { flag: 'the later take is kept' }) });
    i += n;
  }
  return found;
};

/** The rules a line from a recording is cleaned by unless its project or line names others. */
export const SPOKEN_CLEANUP_RULES: readonly SpokenDisfluencyRule[] = [spokenFillers, spokenRepeats, spokenFalseStarts];

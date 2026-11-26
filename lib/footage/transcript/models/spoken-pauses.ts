// spoken-pauses.ts: what a pause between two words is for, read from the transcript. A pause where a sentence or clause
// ends (its punctuation) helps a listener parse; one mid-phrase is a speaker searching for the next word. A line's
// cleanup plays the second much shorter than the first. Pure.
import type { SpokenWord } from './spoken-word.ts';
import { spokenWordKey } from './spoken-disfluencies.ts';

/**
 * A pause where a sentence or clause ends (`boundary`), one in the middle of a phrase (`hesitation`), or one between
 * two takes, where the speaker stopped and started again (`break`): an editor's cut, not a pause to pace.
 */
export type SpokenPauseKind = 'boundary' | 'hesitation' | 'break';

/** What the pause between `before` and `after` is for. A project passes its own in place of spokenPauseKindOf. */
export type SpokenPauseClassifier = (before: SpokenWord, after: SpokenWord) => SpokenPauseKind;

// Words a clause doesn't end on: whisper's comma after "And," or "So," marks the speaker's hesitation, not a clause.
const LEADING_WORDS = new Set([
  'and', 'but', 'or', 'so', 'because', 'then', 'if', 'when', 'that', 'which', 'who', 'the', 'a', 'an', 'to', 'of', 'in',
  'on', 'for', 'with', 'at', 'from', 'by', 'my', 'your', 'our', 'their', 'his', 'her', 'its', 'this', 'these', 'i', "i'm",
  'we', 'you', 'they', 'it', "it's", 'is', 'are', 'was', 'like', 'um', 'uh', 'er', 'erm', 'umm', 'uhm',
]);

/**
 * A boundary after a word ending a sentence (. ? !) or a clause (, ; : —), unless the word is one a clause leads with
 * ("And," "the,"). A trailing ellipsis is whisper hearing a speaker tail off, and a dash a word cut off: hesitations.
 */
export const spokenPauseKindOf: SpokenPauseClassifier = (before) => {
  const text = before.text.trim();
  if (/(\.\.\.|…)$/.test(text) || /\p{L}-$/u.test(text)) return 'hesitation';
  if (/[.?!]["')\]]*$/.test(text)) return 'boundary';
  if (/[,;:—–]["')\]]*$/.test(text)) return LEADING_WORDS.has(spokenWordKey(before)) ? 'hesitation' : 'boundary';
  return 'hesitation';
};

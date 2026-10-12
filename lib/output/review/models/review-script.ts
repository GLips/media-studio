// review-script.ts: the script as the read-along shows it, and whether its sign-off still holds. The engine reads the
// lines from voiceover.json and their word times from audio/take.json (review-script-source.ts), and hashes them there,
// so this stays free of node:crypto.
import type { SpokenWord } from '#lib/timing/voice/models/voice-words.ts';
import type { ReviewSignoff } from './review-threads.ts';

/** A voiceover line; `start`, `end` and `words` (seconds in the take) are absent until the script is voiced. */
export type ReviewScriptLine = { id: string; text: string; start?: number; end?: number; words?: SpokenWord[] };

/** The line's words as a script note counts them: the take's where it has them, else the text split on spaces. */
export const reviewScriptLineWords = (line: ReviewScriptLine): readonly { text: string }[] =>
  line.words ?? line.text.split(/\s+/).filter(Boolean).map((text) => ({ text }));

/** True when the script was signed off and has changed since; a script never signed off isn't stale. */
export function reviewScriptSignoffStale(signoffs: readonly ReviewSignoff[], currentHash: string): boolean {
  const signed = signoffs.findLast((s) => s.on === 'script');
  return signed !== undefined && signed.hash !== currentHash;
}

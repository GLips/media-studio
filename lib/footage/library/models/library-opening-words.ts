// library-opening-words.ts: what an item opens by saying, for the shelf's line under its title, so takes with the same
// dated title read apart. Pure.
import type { SpokenWord } from '#lib/footage/transcript/models/spoken-word.ts';

/** Words the shelf leaves out: hesitations, which say nothing about the take. */
const LIBRARY_FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'erm', 'er', 'hmm', 'mm', 'ah']);

/** More words than a shelf row shows at any width; the row cuts the line where it runs out. */
const LIBRARY_OPENING_WORDS = 24;

/** The first words said, hesitations left out, as one line: `All right, I'm starting recording here, and...`. */
export function libraryOpeningWords(words: readonly SpokenWord[]): string {
  const said = words.filter((word) => !LIBRARY_FILLERS.has(word.text.toLowerCase().replace(/[^a-z]/g, '')));
  return said.slice(0, LIBRARY_OPENING_WORDS).map((word) => word.text).join(' ');
}

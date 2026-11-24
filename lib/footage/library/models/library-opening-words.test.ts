import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryOpeningWords } from './library-opening-words.ts';

test("a take's opening words leave out its hesitations, however they're punctuated", () => {
  const words = ['Um,', 'all', 'right,', 'um...', "I'm", 'starting', 'Uh.'].map((text, i) => ({ text, start: i, end: i + 0.5 }));
  assert.equal(libraryOpeningWords(words), "all right, I'm starting");
});

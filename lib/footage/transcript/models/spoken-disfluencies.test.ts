import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SPOKEN_CLEANUP_RULES, spokenRepeats } from './spoken-disfluencies.ts';

const words = (text: string) => text.split(' ').map((t, i) => ({ text: t, start: i, end: i + 0.5 }));
const found = (text: string) => SPOKEN_CLEANUP_RULES.flatMap((rule) => rule(words(text))).map(({ kind, first, count, flag }) => [kind, first, count, flag]);

test('fillers, stutters and false starts are found; lexical fillers, fused fillers and words meant twice are not', () => {
  assert.deepEqual(found('So, um, I I think we- we know, like, you know, that that and-uh works.'), [
    ['filler', 1, 1, undefined], ['repeat', 2, 1, undefined], ['repeat', 5, 1, undefined], ['false start', 5, 1, undefined],
  ]);
});

test('a retake drops the earlier take and flags it; the longest repeat wins', () => {
  assert.deepEqual(spokenRepeats(words('each agent has, each agent has a definition')), [{ kind: 'retake', first: 0, count: 3, flag: 'the later take is kept' }]);
});

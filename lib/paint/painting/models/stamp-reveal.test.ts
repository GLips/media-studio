import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampRevealShownAt, type StampReveal, type StampRevealStroke } from './stamp-reveal.ts';

/** A stroke 100 px along y = 50 from x = 0, 20 px wide, reaching its end a second after it starts. */
const ALONG: StampRevealStroke = { points: [{ x: 0, y: 50 }, { x: 100, y: 50 }], widthPx: 20, from: 0, to: 1 };
const strokes = (...each: StampRevealStroke[]): StampReveal => ({ kind: 'strokes', strokes: each });
const shown = (reveal: StampReveal, x: number, y: number, t: number) => +stampRevealShownAt(reveal, { x, y }, t).toFixed(3);

test('a stroke shows its band as its front passes, at constant speed by arclength; what it never covers never shows', () => {
  const reveal = strokes(ALONG);
  assert.deepEqual([shown(reveal, 25.5, 50.5, 0.5), shown(reveal, 75.5, 50.5, 0.5), shown(reveal, 75.5, 59.5, 1)], [1, 0, 1]);
  assert.deepEqual([shown(reveal, 50.5, 70.5, Infinity), shown(reveal, 50.5, 70.5, 5)], [0, 0]);
  // Its side antialiased over a texel: a centre half a px inside its edge shows all, one on it half.
  assert.deepEqual([shown(reveal, 50.5, 59.5, 1), shown(reveal, 50.5, 60, 1)], [1, 0.5]);
});

test('a round cap reaches half its width past each end; a flat one stops square at it', () => {
  const past = (cap: StampRevealStroke['cap']) => shown(strokes({ ...ALONG, cap }), 105.5, 50.5, Infinity);
  assert.deepEqual([past('round'), past('flat')], [1, 0]);
});

test('where strokes cross, the earliest to arrive shows the texel', () => {
  const down: StampRevealStroke = { points: [{ x: 50, y: 0 }, { x: 50, y: 100 }], widthPx: 20, from: 3, to: 4 };
  const reveal = strokes(ALONG, down);
  assert.deepEqual([shown(reveal, 50.5, 50.5, 0.6), shown(reveal, 50.5, 20.5, 0.6), shown(reveal, 50.5, 20.5, 3.5)], [1, 0, 1]);
});

test('bands meeting edge to edge between texel centres cover the texel they share whole once both have arrived', () => {
  // Their shared edge at y = 60.25: the texel centred on 60.5 is a quarter the first's, three quarters the second's.
  const above: StampRevealStroke = { ...ALONG, points: [{ x: 0, y: 50.25 }, { x: 100, y: 50.25 }] };
  const below: StampRevealStroke = { points: [{ x: 0, y: 70.25 }, { x: 100, y: 70.25 }], widthPx: 20, from: 2, to: 3 };
  const reveal = strokes(above, below);
  assert.deepEqual([shown(reveal, 50.5, 60.5, 1.5), shown(reveal, 50.5, 60.5, 2.75), shown(reveal, 50.5, 60.5, Infinity)], [0.25, 1, 1]);
});

test('softS ramps a texel in over its seconds; a field arrives at its base plus its delay', () => {
  const soft = { ...strokes(ALONG), softS: 1 };
  assert.ok(Math.abs(shown(soft, 50.5, 50.5, 1) - 0.5) < 0.02);
  const flood: StampReveal = {
    kind: 'field', base: { kind: 'linear', from: { x: 0, y: 0, value: 0 }, to: { x: 100, y: 0, value: 2 } }, delay: { kind: 'constant', value: 1 },
  };
  assert.deepEqual([shown(flood, 25.5, 10.5, 2), shown(flood, 75.5, 10.5, 2), shown(flood, 75.5, 10.5, Infinity)], [1, 0, 1]);
  // A constant field's hard front steps just after its arrival, fully revealed included.
  const cut: StampReveal = { kind: 'field', base: { kind: 'constant', value: 3 } };
  assert.deepEqual([shown(cut, 5.5, 5.5, 3), shown(cut, 5.5, 5.5, 3.01), shown(cut, 5.5, 5.5, Infinity)], [0, 1, 1]);
});

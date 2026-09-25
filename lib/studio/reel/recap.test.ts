import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../tsx-test-hooks.ts';

const { RecapGrid, recapPopStarts } = await import('./recap.tsx');

const frames = (starts: number[]) => starts.map((s) => Math.round(s * 30 * 1e6) / 1e6);

test('tiles pop in the reference\'s orders, on whole frames', () => {
  // The 2×2 in Z order, a frame apart; the 3×3 by anti-diagonal over 0.1 s; a 3×2 from its middle column out.
  assert.deepEqual(frames(recapPopStarts(4, 2, 2, 'z', 0.1)), [0, 1, 2, 3]);
  assert.deepEqual(frames(recapPopStarts(9, 3, 3, 'antidiagonal', 0.1)), [0, 1, 2, 1, 2, 2, 2, 2, 3]);
  assert.deepEqual(frames(recapPopStarts(6, 3, 2, 'centre', 0.1)), [3, 0, 3, 3, 0, 3]);
});

test('a tile pops on the frame it\'s due, though the frame\'s time minus the grid\'s start lands a hair under it', () => {
  // 17/30 − 0.5 is a hair under 2/30, the third tile's start.
  const tilesAt = (t: number) => {
    const html = renderToStaticMarkup(createElement(RecapGrid, { t, at: 0.5, tiles: Array.from({ length: 4 }, () => ({ shot: () => null })) }));
    return html.split('data-motion-kind="recap-tile"').length - 1;
  };
  assert.equal(tilesAt(16 / 30), 2);
  assert.equal(tilesAt(17 / 30), 3);
});

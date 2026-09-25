import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../tsx-test-hooks.ts';

const { RecapGrid } = await import('./recap.tsx');

test('a tile pops on the frame it\'s due, though the frame\'s time minus the grid\'s start lands a hair under it', () => {
  // 17/30 − 0.5 is a hair under 2/30, the third tile's start.
  const tilesAt = (t: number) => {
    const html = renderToStaticMarkup(createElement(RecapGrid, { t, at: 0.5, tiles: Array.from({ length: 4 }, () => ({ shot: () => null })) }));
    return html.split('data-motion-kind="recap-tile"').length - 1;
  };
  assert.equal(tilesAt(16 / 30), 2);
  assert.equal(tilesAt(17 / 30), 3);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Thumbnail } from '@remotion/player';
import '#lib/output/render/engine/tsx-test-hooks.ts';

const { RecapGrid } = await import('./recap.tsx');

const FPS = 30;

test('a tile pops on the frame it\'s due, though the frame\'s time minus the grid\'s start lands a hair under it', () => {
  // 17/30 − 0.5 is a hair under 2/30, the third tile's start.
  const tilesAt = (t: number) => {
    // In a composition, as RecapGrid reads the video's format from it.
    const grid = () => createElement(RecapGrid, { t, at: 0.5, tiles: Array.from({ length: 4 }, () => ({ shot: () => null })) });
    const html = renderToStaticMarkup(createElement(Thumbnail, { component: grid, compositionWidth: 1920, compositionHeight: 1080, fps: FPS, durationInFrames: 1, frameToDisplay: 0 }));
    return html.split('data-motion-kind="recap-tile"').length - 1;
  };
  assert.equal(tilesAt(16 / FPS), 2);
  assert.equal(tilesAt(17 / FPS), 3);
});

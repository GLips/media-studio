import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Thumbnail } from '@remotion/player';
import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';
import { defineVideo } from '#lib/picture/video/studio/video.ts';

// The hooks load .tsx in Node; they must be in place before Video.tsx is imported.
await import('#lib/output/render/engine/tsx-test-hooks.ts');
const { BlockoutSolo, Video } = await import('./Video.tsx');

const FPS = 30;
const video = defineVideo({
  title: 'A house',
  storyboard: defineStoryboard({ title: 'A house', scenes: { house: { onScreen: 'The house', motion: 'A push-in', seconds: 2 } } }),
  scenes: {
    house: (clock) => ({
      id: clock.id,
      previs: { blockout: '3d', prompt: 'A house.', overlay: () => createElement('p', null, 'THE-TITLE') },
      render: () => createElement('p', null, 'THE-BLOCKOUT'),
    }),
  },
});

const markupOf = (component: ComponentType) => renderToStaticMarkup(createElement(Thumbnail, {
  component, compositionWidth: 1920, compositionHeight: 1080, fps: FPS, durationInFrames: 60, frameToDisplay: 10,
}));

test('a previs scene\'s overlay plays over its footage, and stays out of the blockout sent to the model', () => {
  const played = markupOf(() => createElement(Video, {
    video, previsClips: { house: { src: 'house.mp4', from: 0, duration: 2 } }, sfxCues: null, captions: false, probe: false, blockouts: false, reportTimeline: false,
  }));
  assert.match(played, /THE-TITLE/);
  assert.doesNotMatch(played, /THE-BLOCKOUT/);

  const sent = markupOf(() => createElement(BlockoutSolo, { video, scene: 'house', seconds: 2 }));
  assert.match(sent, /THE-BLOCKOUT/);
  assert.doesNotMatch(sent, /THE-TITLE/);
});

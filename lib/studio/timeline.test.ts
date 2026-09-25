import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineScene, defineVideo, layoutVideo, scenesAt, visibleSpan } from './timeline.ts';

test('every frame paints a scene whose Sequence is mounted on it, where cut scenes meet on a frame', () => {
  // A reel's bars: scene lengths in whole frames, given in seconds, so their summed starts are a hair off the frames.
  const FPS = 30;
  const frames = [86, 60, 60, 60, 60, 60, 60, 60, 86];
  const video = defineVideo({
    title: 'bars', voice: {},
    scenes: frames.map((n, i) => defineScene({ id: `bar${i + 1}`, min: n / FPS, lead: 0, tail: 0, cut: true, render: () => null })),
  });
  const tl = layoutVideo(video);
  const mounted = tl.scenes.map((_, i) => {
    const span = visibleSpan(tl, i);
    return { from: Math.floor(span.start * FPS), to: Math.ceil(span.end * FPS) };
  });
  for (let f = 0; f < frames.reduce((a, b) => a + b); f++) {
    for (const { scene } of scenesAt(tl, f / FPS)) {
      const { from, to } = mounted[tl.scenes.indexOf(scene)];
      assert.ok(f >= from && f < to, `frame ${f} paints ${scene.id}, mounted on ${from}–${to - 1}`);
    }
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineTimeline, fixedSpan, voiceSpan } from './timeline.ts';
import { scenesAtFrame, videoLayoutOf } from './video-layout.ts';

test('every frame paints a scene mounted on it, cut scenes meeting on a frame and crossfades straddling theirs', () => {
  // A reel's bars in whole frames, given in seconds whose sums land a hair off the frames, two odd-frame crossfades and
  // one 0.08 s long, whose fade frames round away from its cut.
  const FPS = 30;
  const frames = [86, 60, 60, 60, 60, 60, 60, 60, 86];
  const timeline = defineTimeline({
    fps: FPS,
    scenes: Object.fromEntries(frames.map((n, i) => [`bar${i + 1}`, fixedSpan(n / FPS, { crossfade: i === 3 || i === 6 ? 0.5 : i === 5 ? 0.08 : 0 })])),
  });
  const layout = videoLayoutOf(timeline, {});
  assert.equal(layout.frames, frames.reduce((a, b) => a + b));
  for (let f = 0; f < layout.frames; f++) {
    const painted = scenesAtFrame(layout, f);
    for (const { k } of painted) {
      const { visible, id } = layout.scenes[k];
      assert.ok(f >= visible.from && f < visible.to, `frame ${f} paints ${id}, mounted on ${visible.from}–${visible.to - 1}`);
    }
    const cut = layout.scenes.find((s) => s.from === f);
    if (cut && !cut.xfade) assert.deepEqual(painted.map(({ k }) => layout.scenes[k].id), [cut.id], `frame ${f} is ${cut.id}'s cut`);
  }
  // A crossfade's scenes are mounted for all of it, so the fade runs from clear to opaque rather than popping at an end.
  layout.scenes.forEach((scene, k) => {
    if (!scene.xfade) return;
    const half = (scene.xfade * FPS) / 2;
    assert.ok(scene.from - scene.visible.from >= half && layout.scenes[k - 1].visible.to - scene.from >= half, `${scene.id} is mounted for all of its fade`);
  });
});

test('a line read past its scene still has the scene under its last frame', () => {
  const take = { duration: 1.01, pauseBefore: null, words: [], src: null, text: 'hi', caption: 'hi', paragraph: false, lufs: null };
  const layout = videoLayoutOf(defineTimeline({ fps: 30, voice: { hi: take }, scenes: { only: voiceSpan(['hi'], { lead: 0, tail: 0 }) } }), { hi: take });
  assert.equal(layout.frames, 31);
  assert.equal(layout.scenes[0].visible.to, 31);
});

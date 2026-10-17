import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';
import { defineVideo, laidVideoOf } from './video.ts';

const plan = (line: string) => defineStoryboard({
  title: 'A plan', target: { seconds: 5 }, voice: 'Kore',
  scenes: {
    open: { onScreen: 'The plate', motion: 'Shutter on "photo"', lines: { snap: { text: line, cues: { shutter: 'photo' } } } },
    close: { onScreen: 'The end card', motion: 'It fades in', seconds: 1 },
  },
});

test('defineVideo times the storyboard, binds each scene to its clock, and notes it with its row', () => {
  const video = defineVideo({
    title: 'A plan', storyboard: plan('Snap a photo.'),
    scenes: { open: (clock) => ({ id: clock.id, render: () => clock.cues.shutter }), close: (clock) => ({ id: clock.id, render: () => null }) },
  });
  // No take yet, so the line is estimated: placed, with no audio for a render to refuse.
  assert.equal(video.voice.snap.src, null);
  assert.deepEqual(laidVideoOf(video).scenes.map((scene) => [scene.id, scene.note]), [['open', 'The plate'], ['close', 'The end card']]);
});

test('defineVideo refuses a storyboard with a diagnostic, naming its scene and cue', () => {
  assert.throws(
    () => defineVideo({ title: 'A plan', storyboard: plan('Snap your plate.'), scenes: { open: (clock) => ({ id: clock.id, render: () => null }), close: (clock) => ({ id: clock.id, render: () => null }) } }),
    /the storyboard of A plan doesn't resolve:\n {2}scene open, line snap, cue shutter: cue shutter: "photo" isn't in/,
  );
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveStoryboard } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';
import type { VoiceLine } from '#lib/timing/voice/models/voice-manifest.ts';
import { planTimingOf } from './plan-timing.ts';

test('a line said for 3 s raises no hold: speech is something happening', () => {
  const storyboard = defineStoryboard({
    title: 'One long line',
    target: { seconds: 4 },
    voice: 'Callirrhoe',
    scenes: { pitch: { onScreen: 'The app', motion: 'It sits still', lines: { pitch: { text: 'Plan a week of meals in one go.' } }, timing: { lead: 0.2, tail: 0.3 } } },
  });
  const words = ['Plan', 'a', 'week', 'of', 'meals', 'in', 'one', 'go.'].map((text, k) => ({ text, start: 0.1 + k * 0.36, end: 0.4 + k * 0.36 }));
  const clip: VoiceLine = { src: 'audio/pitch.wav', duration: 3, lufs: -15, pauseBefore: null, paragraph: false, text: 'Plan a week of meals in one go.', caption: 'Plan a week of meals in one go.', words };
  const voice = { pitch: clip };
  const timing = planTimingOf({ storyboard, voice, music: {}, voiceRead: 'final', resolved: resolveStoryboard(storyboard, { voice }) });
  assert.ok(timing);
  assert.equal(timing.lines[0].read, 'recorded');
  assert.deepEqual(timing.flags.filter((f) => f.kind === 'hold'), []);
});

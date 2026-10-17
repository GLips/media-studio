import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VoiceLine } from '#lib/timing/voice/models/voice-manifest.ts';
import { resolveStoryboard } from './resolve-storyboard.ts';
import { defineStoryboard, type StoryboardSceneClock } from './storyboard.ts';
import { storyboardSceneHash } from './storyboard-sign-off.ts';

const plan = (snap: string) => defineStoryboard({
  title: 'A test plan',
  target: { seconds: 10, max: 30 },
  voice: 'Callirrhoe',
  scenes: {
    plate: {
      onScreen: 'The camera on a plate',
      motion: 'Shutter on "photo"',
      lines: { snap: { text: snap, cues: { shutter: 'photo' } } },
      cues: { scan: { after: 'shutter', frames: 6 } },
      timing: { lead: 0.3, tail: 0.2, nudge: { shutter: 4 } },
    },
    close: { onScreen: 'The end card', motion: 'It fades in', seconds: 1.5, cues: { icon: 0.25 } },
  },
});

// A recorded clip of "Snap a photo of your plate,": 1.48 s, "photo" from 0.27 s.
const snapClip: VoiceLine = {
  src: 'audio/snap.wav', duration: 1.48, lufs: -15, pauseBefore: null, paragraph: false, text: 'Snap a photo of your plate,', caption: 'Snap a photo of your plate,',
  words: [['Snap', 0.08, 0.22], ['a', 0.22, 0.27], ['photo', 0.27, 0.47], ['of', 0.57, 0.65], ['your', 0.65, 0.86], ['plate,', 0.86, 1.3]].map(([text, start, end]) => ({ text: String(text), start: Number(start), end: Number(end) })),
};

test('a line is timed by its clip while the clip says it, and re-timed by its word count once reworded', () => {
  const recorded = resolveStoryboard(plan('Snap a *photo* of your plate,'), { voice: { snap: snapClip } });
  assert.deepEqual(recorded.diagnostics, []);
  assert.deepEqual(recorded.lines, [{ scene: 'plate', line: 'snap', read: 'recorded' }]);
  const clock: StoryboardSceneClock<ReturnType<typeof plan>, 'plate'> = recorded.timeline!.clock('plate');
  // The lead is 9 frames, "photo" 0.27 s (8 frames) in, and the nudge 4 more; the scan 6 after that; the end after
  // the lead, the clip and the tail (1.98 s).
  assert.deepEqual([clock.cues.shutter, clock.cues.scan, clock.end], [21, 27, 59]);
  // @ts-expect-error: the clock's cues are the plan's, so one it doesn't declare fails to compile.
  assert.equal(clock.cues.flash, undefined);
  // The caption is the storyboard's, so markup added after the read needs no re-read.
  assert.equal(recorded.voice.snap.caption, 'Snap a *photo* of your plate,');

  const reworded = resolveStoryboard(plan('Snap a quick photo of your dinner plate before you eat,'), { voice: { snap: snapClip } });
  assert.deepEqual(reworded.lines.map((line) => line.read), ['estimated']);
  assert.equal(reworded.voice.snap.src, null);
  assert.ok(reworded.timeline!.clock('plate').end > clock.end);
});

test('a cue whose word has gone is a diagnostic on its scene, and the rest of the plan still times', () => {
  const resolved = resolveStoryboard(plan('Snap your plate,'));
  assert.deepEqual(resolved.diagnostics.map(({ scene, line, cue }) => ({ scene, line, cue })), [{ scene: 'plate', line: 'snap', cue: 'shutter' }]);
  assert.match(resolved.diagnostics[0].message, /"photo" isn't in "Snap your plate,"/);
  assert.ok(resolved.timeline);
});

test('a scene\'s sign-off hash covers its own content and timing, not where it starts', () => {
  // The close's icon (0.25 s) falls between frames, so where the close starts inside a frame moves it by one: the
  // three reads start it at different fractions, and its sign-off must stand through all of them.
  const plans = ['Snap a photo.', 'Snap a photo now.', 'Snap a photo of the whole plate, the sauce and the garnish.'].map(plan);
  const timed = plans.map((p) => resolveStoryboard(p));
  assert.equal(new Set(timed.map((t) => t.timeline!.scene('close').from)).size, 3);
  assert.equal(new Set(plans.map((p, i) => storyboardSceneHash(p, timed[i], 'close'))).size, 1);
  assert.notEqual(storyboardSceneHash(plans[0], timed[0], 'plate'), storyboardSceneHash(plans[2], timed[2], 'plate'));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SpokenWord } from '#models/voice/voice-words.ts';
import type { SfxEvent } from './cue-events.ts';
import { draftSfxCues, sfxCueOverrides, sfxCueSound, staleSfxCues, type SfxCueList } from './cues.ts';

const click = (id: string, at: number): SfxEvent => ({ id, kind: 'click', scene: 'a', at, request: { sound: 'click' }, volume: 1 });
const scene = (id: string, at: number, index: number): SfxEvent => ({ id, kind: 'scene', scene: id, at, index, dissolve: { from: at - 0.25, to: at + 0.25 } });
const words: SpokenWord[] = [{ text: 'price', start: 9.8, end: 10.4 }, { text: 'later', start: 13, end: 15 }, { text: 'end', start: 25, end: 26 }];
const events: SfxEvent[] = [
  click('click:a:1', 1), click('click:a:2', 1.1), click('click:a:3', 1.5),
  scene('scene:b', 5, 1), scene('scene:c', 12, 2), scene('scene:d', 20, 3),
  { id: 'move:d:1', kind: 'camera-move', scene: 'd', track: 'd/cam', at: 22, from: 21.4, to: 22.9, big: true },
  { id: 'reveal:d/ring:1', kind: 'reveal', scene: 'd', at: 10.1, track: 'd/ring' },
  // A whoosh the scene placed itself, under "later": its scene's choice, so not reported.
  { id: 'placed:c:1', kind: 'placed', scene: 'c', at: 14, request: { sound: 'whoosh' }, volume: 1 },
];
const cueOf = (list: SfxCueList, id: string) => list.cues.find((c) => c.event.id === id)!;
const soundOf = (list: SfxCueList, id: string) => sfxCueSound(cueOf(list, id), list.clickStyle);

test('the draft debounces clicks, spaces accents, skips a cut beside an accented one, keeps them off words, and fits a whoosh to its move', () => {
  const { list } = draftSfxCues(events, words, { clickStyle: 'tick' });
  assert.equal(list.cues.length, events.length, 'every event gets a cue, silent or not');
  assert.equal(soundOf(list, 'click:a:1')?.sound, 'click.trackpad');
  assert.equal(soundOf(list, 'click:a:2'), null, 'a click 0.1 s after another is silent');
  assert.ok(soundOf(list, 'click:a:3'));
  assert.ok(soundOf(list, 'scene:b'));
  assert.equal(soundOf(list, 'scene:c'), null, 'the cut after an accented one');
  assert.ok(soundOf(list, 'scene:d'));
  assert.equal(soundOf(list, 'reveal:d/ring:1'), null, 'a reveal under "price"');
  assert.equal(soundOf(list, 'move:d:1'), null, '2 s after the accent on scene:d');
  assert.deepEqual(cueOf(list, 'move:d:1').alternatives[0].set, { approach: 0.6, recede: 0.9 }, "a whoosh's offered shape is its move's");
  assert.deepEqual(sfxCueOverrides(list, words), [], 'the draft breaks no rule');
  assert.equal(soundOf({ ...list, clickStyle: 'pop' }, 'click:a:1')?.sound, 'pop.soft', 'editing the click style changes every click');
});

test("a redraft keeps edits where a series' ids still name the same events, and the check reports the rules they break", () => {
  const { list } = draftSfxCues(events, words, { clickStyle: 'soft' });
  cueOf(list, 'reveal:d/ring:1').sound = cueOf(list, 'reveal:d/ring:1').alternatives[0];
  cueOf(list, 'click:a:1').sound = null;
  cueOf(list, 'scene:b').nudge = 0.2;
  // A re-voice moved scene:d later, and a click was added before the others, renumbering them.
  const now = [...events.map((e) => (e.id === 'scene:d' ? { ...e, at: 21 } : e)), click('click:a:4', 3)];
  const { list: redrafted, dropped } = draftSfxCues(now, words, { clickStyle: 'soft', previous: list });
  assert.deepEqual(dropped.map((d) => d.id), ['click:a:1'], 'the click series grew, so its ids may have shifted');
  assert.equal(soundOf(redrafted, 'click:a:1')?.sound, 'click.soft');
  assert.equal(soundOf(redrafted, 'reveal:d/ring:1')?.sound, 'riser.short');
  const problems = sfxCueOverrides(redrafted, words).map((o) => `${o.id}: ${o.problem}`);
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.match(problems.find((p) => p.startsWith('scene:b'))!, /lands 0\.20 s off its event/);
  assert.match(problems.find((p) => p.startsWith('reveal'))!, /under "price"/);
});

test('the check finds cues whose event moved or went, and events with no cue, leaving motion unjudged in part of a video', () => {
  const { list } = draftSfxCues(events, words, { clickStyle: 'soft' });
  const now = [...events.map((e) => (e.id === 'scene:b' ? { ...e, at: 5.5 } : e)).filter((e) => e.id !== 'click:a:3' && e.id !== 'move:d:1'), click('click:a:4', 3)];
  const all = staleSfxCues(list, now, { from: 0, to: 30, fps: 30, partial: false });
  assert.deepEqual(all.map((s) => s.id), ['click:a:3', 'click:a:4', 'scene:b', 'scene:b', 'move:d:1']);
  assert.match(all[1].problem, /no cue for, so it plays nothing/);
  assert.match(all[2].problem, /moved to 5\.50 s/);
  assert.deepEqual(staleSfxCues(list, now, { from: 4, to: 30, fps: 30, partial: true }).map((s) => s.id), ['scene:b', 'scene:b'], 'only the checked stretch, without camera moves');
});

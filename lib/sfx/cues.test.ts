import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SfxEvent } from './cue-events.ts';
import { draftSfxCues, sfxCueOverrides, sfxCuePlays, sfxCueSound, staleSfxCues, type Word } from './cues.ts';

const click = (id: string, at: number): SfxEvent => ({ id, kind: 'click', scene: 'a', at, request: { sound: 'click' }, volume: 1 });
const scene = (id: string, at: number, index: number): SfxEvent => ({ id, kind: 'scene', scene: id, at, index, from: at - 0.25, to: at + 0.25 });
const words: Word[] = [{ text: 'price', start: 9.8, end: 10.4 }, { text: 'later', start: 13, end: 15 }, { text: 'end', start: 25, end: 26 }];
const events: SfxEvent[] = [
  click('click:a:1', 1), click('click:a:2', 1.1), click('click:a:3', 1.5),
  scene('scene:b', 5, 1), scene('scene:c', 12, 2), scene('scene:d', 20, 3),
  { id: 'move:d:1', kind: 'camera-move', scene: 'd', at: 22, from: 21.4, to: 22.9, big: true },
  { id: 'reveal:d/ring:1', kind: 'reveal', scene: 'd', at: 10.1, track: 'd/ring' },
];
const soundOf = (list: ReturnType<typeof draftSfxCues>['list'], id: string) => sfxCueSound(list.cues.find((c) => c.id === id)!);

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
  const move = list.cues.find((c) => c.id === 'move:d:1')!;
  assert.deepEqual(move.alternatives[0].set, { approach: 0.6, recede: 0.9 }, "a whoosh's offered shape is its move's");
  assert.deepEqual(sfxCueOverrides(sfxCuePlays(list), words), [], 'the draft breaks no rule');
});

test('a redraft keeps edits for events that still exist, and the check reports the rules they break', () => {
  const { list } = draftSfxCues(events, words, { clickStyle: 'soft' });
  const reveal = list.cues.find((c) => c.id === 'reveal:d/ring:1')!;
  reveal.sound = reveal.alternatives[0];
  list.cues.find((c) => c.id === 'click:a:1')!.sound = null;
  list.cues.find((c) => c.id === 'scene:b')!.nudge = 0.2;
  // A re-voice moved scene:d later; the edited cues' events are where they were.
  const moved = events.map((e) => (e.id === 'scene:d' ? { ...e, at: 21 } : e)).filter((e) => e.id !== 'click:a:3');
  const { list: redrafted, dropped } = draftSfxCues(moved, words, { clickStyle: 'soft', previous: list });
  assert.deepEqual(dropped, []);
  assert.equal(soundOf(redrafted, 'click:a:1'), null);
  assert.equal(soundOf(redrafted, 'click:a:2')?.sound, 'click.soft', 'with the first click silenced, the second sounds');
  assert.equal(soundOf(redrafted, 'reveal:d/ring:1')?.sound, 'riser.short');
  const problems = sfxCueOverrides(sfxCuePlays(redrafted), words).map((o) => `${o.id}: ${o.problem}`);
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.match(problems.find((p) => p.startsWith('scene:b'))!, /lands 0\.20 s off its event/);
  assert.match(problems.find((p) => p.startsWith('reveal'))!, /under "price"/);
});

test('a cue whose event moved or went is stale, matched by kind and time', () => {
  const { list } = draftSfxCues(events, words, { clickStyle: 'soft' });
  const now = events.map((e) => (e.id === 'scene:b' ? { ...e, at: 5.5 } : e)).filter((e) => e.id !== 'click:a:3');
  const stale = staleSfxCues(sfxCuePlays(list), now, { from: 0, to: 30 }, 30);
  assert.deepEqual(stale.map((s) => s.id), ['click:a:3', 'scene:b']);
  assert.match(stale[1].problem, /moved to 5\.50 s/);
  assert.deepEqual(staleSfxCues(sfxCuePlays(list), now, { from: 4, to: 30 }, 30).map((s) => s.id), ['scene:b'], 'only cues in the checked stretch');
});

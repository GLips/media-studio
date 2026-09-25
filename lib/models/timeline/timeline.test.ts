import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindTimeline } from './bind-timeline.ts';
import { assertTimelineRetimes } from './retime.ts';
import { beatSpan, defineTimeline, fixedSpan, recordedGrid, voiceSpan } from './timeline.ts';

// 120 BPM from 0.5 s: 15 frames a beat, beat 0 on frame 15. Two four-beat scenes end on the final hit, beat 8, at 4.5 s.
const track = {
  bpm: 120, duration: 5.5, beats: Array.from({ length: 11 }, (_, i) => 0.5 + i * 0.5), fit: { downbeats: [0.5, 2.5, 4.5] },
};
const base = { grid: recordedGrid(track, { steady: true }), pictureLeadFrames: 2, soundLagSeconds: 0, fade: { from: -9, to: -5 } };
const scenes = {
  a: beatSpan(4, { cues: { hit: 2 } }),
  b: beatSpan(4, { cutIn: 0.5, cues: { late: { at: 1, frames: 3 }, stop: 'end' } }),
};
const landmarks = [{ name: 'the final hit', cue: 'b.stop', downbeat: -1 }] as const;

test('a timeline resolves to frames, each scene reaching only its own beats', () => {
  const timeline = defineTimeline({ ...base, scenes, landmarks });
  const [a, b] = timeline.scenes;
  assert.deepEqual([a.from, a.to, b.origin, b.from, b.to, timeline.end], [0, 81, 73, 81, 165, 165]);
  assert.equal(a.beat(1), 28);
  assert.equal(timeline.cue('a.hit'), 43);
  assert.equal(timeline.scene('b').cues.late, 91);
  assert.deepEqual(timeline.musicBeats, [1, 1.5]);
  assert.throws(() => b.beat(-1), /outside the scene.*through its cue/);
  assert.deepEqual(timeline.audio.map((placed) => placed.atSeconds), [0]);
});

test('a timeline that no longer ends on the music\'s final hit throws at load, naming both fixes', () => {
  const longer = { ...scenes, a: beatSpan(5, { cues: { hit: 2 } }) };
  assert.throws(() => defineTimeline({ ...base, scenes: longer, landmarks }), /re-fit it with studio music fit --bars, or change the timeline/);
  assert.throws(() => defineTimeline({ ...base, scenes, landmarks: [] }), /no landmark names the music's final hit/);
});

test('cues that wait on each other in a circle are refused', () => {
  const circular = { ...scenes, a: beatSpan(4, { cues: { x: { after: 'y' }, y: { after: 'x' } } }) };
  assert.throws(() => defineTimeline({ ...base, scenes: circular, landmarks } as never), /a\.x → a\.y → a\.x form a cycle/);
});

test('the retime runner passes a move anchored at one end and fails one pinned between two scenes', () => {
  const anchored = { ...scenes, a: beatSpan(4, { moves: { dive: { from: { at: 'end', frames: -4 }, to: { at: 'end', frames: -1 } } } }) };
  assertTimelineRetimes(defineTimeline({ ...base, scenes: anchored, landmarks }));
  // Adversarial: the showcase's old dive, from a beat of scene a to scene b's first beat. Each end is legal on its own.
  const pinned = {
    a: beatSpan(4, { moves: { dive: { from: 3, to: { cue: 'b.start' } } } }),
    b: beatSpan(4, { cutIn: 0.5, cues: { start: 0, stop: 'end' } }),
  };
  assert.throws(() => assertTimelineRetimes(defineTimeline({ ...base, scenes: pinned, landmarks })), /a a beat longer: move a\.dive runs 32 frames, not 16/);
});

// A voiced intro, the music, a fixed end card: the speech sets the intro's length and the music starts after it, so a
// longer read moves the section whole, every beat scene still on its beat.
const voice = { hello: { duration: 1.1 }, name: { duration: 0.8 } };
const mixed = {
  intro: voiceSpan(voice, ['hello', 'name'], { cues: { named: 1.95 } }),
  a: beatSpan(4, { cues: { hit: 2 } }),
  b: beatSpan(4, { cues: { stop: 'end' } }),
  card: fixedSpan(2),
};

test('a voiced intro sets its own length and carries the music with it; a scene inside the music is refused', () => {
  const timeline = defineTimeline({ ...base, scenes: mixed, landmarks: [{ name: 'the final hit', cue: 'b.stop', downbeat: -1 }] });
  // 0.5 lead, 1.1 + 0.35 + 0.8 of speech, 0.6 tail: 3.35 s, so the music plays from there.
  assert.deepEqual(timeline.audio.map((placed) => placed.atSeconds), [3.35]);
  assert.deepEqual(timeline.scenes.map((scene) => [scene.from, scene.to]), [[0, 101], [101, 174], [174, 234], [234, 294]]);
  assert.equal(timeline.cue('a.hit'), timeline.scene('a').beat(2));
  assertTimelineRetimes(timeline);
  const inside = { a: mixed.a, card: mixed.card, b: mixed.b };
  assert.throws(() => defineTimeline({ ...base, scenes: inside, landmarks: [{ name: 'the final hit', cue: 'b.stop', downbeat: -1 }] }),
    /scene card \(fixedSpan\) sits inside the musical section/);
});

test('bindTimeline hands a replaying scene the scenes it replays, mapped by the timeline\'s cues', () => {
  const timeline = defineTimeline({
    ...base, scenes, landmarks, replays: { b: { hitAgain: { from: 'a.hit', to: 'b.late' } } },
  });
  type Shown = { id: string; shows: (f: number) => string };
  const [a, b] = bindTimeline(timeline, {
    a: (clock): Shown => ({ id: clock.id, shows: (f) => `a@${f}` }),
    b: (clock, replays): Shown => ({ id: clock.id, shows: (f) => replays.hitAgain.source.shows(replays.hitAgain.sourceFrame(f)) }),
  });
  assert.equal(a.id, 'a');
  assert.equal(b.shows(timeline.cue('b.late')), `a@${timeline.cue('a.hit')}`);
  assert.throws(() => bindTimeline(timeline, { a: () => 0 } as never), /missing b/);
});

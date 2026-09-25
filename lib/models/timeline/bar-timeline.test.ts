import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineBarTimeline, type BarTimelineSpec } from './bar-timeline.ts';
import { assertBarTimelineRetimes } from './retime.ts';

// 120 BPM from 0.5 s: 15 frames a beat, beat 0 on frame 15. Two four-beat bars end on the final hit, beat 8, at 4.5 s.
const track = {
  bpm: 120, duration: 5.5, beats: Array.from({ length: 11 }, (_, i) => 0.5 + i * 0.5), fit: { downbeats: [0.5, 2.5, 4.5] },
};
const spec = {
  track, steadyGrid: true, leadFrames: 2, soundLagSeconds: 0, fade: { from: -9, to: -5 },
  bars: [{ id: 'a', beats: 4 }, { id: 'b', beats: 4, cutIn: 0.5 }],
  cues: { a: { hit: 2 }, b: { late: { beat: 1, frames: 3 } } },
  landmarks: [{ name: 'the final hit', bar: 'b', beat: 'end', downbeat: -1 }],
} satisfies BarTimelineSpec<'a' | 'b'>;

test('a bar table resolves to frames, each bar reaching only its own beats', () => {
  const timeline = defineBarTimeline(spec);
  const [a, b] = timeline.bars;
  assert.deepEqual([a.from, a.to, b.from, b.to, timeline.end], [0, 81, 81, 165, 165]);
  assert.equal(a.beat(1), 28);
  assert.equal(timeline.cue('a.hit'), 43);
  assert.equal(timeline.bar('b').cues.late, 91);
  assert.deepEqual(timeline.musicBeats, [1, 1.5]);
  assert.throws(() => b.beat(-1), /outside the bar.*through its cue/);
});

test('a table that no longer ends on the music\'s final hit throws at load, naming both fixes', () => {
  const longer = { ...spec, bars: [{ id: 'a', beats: 5 }, spec.bars[1]] };
  assert.throws(() => defineBarTimeline(longer), /re-fit it with studio music fit --bars, or change the table/);
  assert.throws(() => defineBarTimeline({ ...spec, landmarks: [] }), /no landmark names the music's final hit/);
});

test('the retime runner passes a move anchored at one end and fails one pinned between two bars', () => {
  const anchored = { ...spec, moves: { a: { dive: { from: { beat: 'end', frames: -4 }, to: { beat: 'end', frames: -1 } } } } } as const;
  assertBarTimelineRetimes(defineBarTimeline(anchored));
  // Adversarial: the old dive, from a beat of bar a to bar b's first beat. Each end is a legal moment on its own.
  const pinned = { ...spec, moves: { a: { dive: { from: 3, to: { bar: 'b', beat: 0 } } } } } as const;
  assert.throws(() => assertBarTimelineRetimes(defineBarTimeline(pinned)), /bar a a beat longer: move a\.dive runs 32 frames, not 16/);
});

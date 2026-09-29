import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timelineSceneMoments } from './scene-moments.ts';
import { beatSpan, defineTimeline, recordedGrid } from './timeline.ts';

// 120 BPM from 0.5 s: 15 frames a beat, bars on beats 0, 4 and 8. Two four-beat scenes end on the final hit, beat 8.
const track = { bpm: 120, duration: 5.5, beats: Array.from({ length: 11 }, (_, i) => 0.5 + i * 0.5), fit: { downbeats: [0.5, 2.5, 4.5] } };

test('each scene names its moments in timeline.ts\'s words, in frame order', () => {
  const timeline = defineTimeline({
    grid: recordedGrid(track, { steady: true }), pictureLeadFrames: 2,
    scenes: {
      a: beatSpan(4, { cues: { hit: 2 } }),
      b: beatSpan(4, { cutIn: 0.5, cues: { stop: 'end', late: { at: 1, frames: 3 } } }),
    },
    replays: { b: { again: { from: 'a.hit', to: 'b.late' } } },
    landmarks: [{ name: 'the final hit', cue: 'b.stop', downbeat: -1 }],
  });
  const [a, b] = timelineSceneMoments(timeline);
  assert.deepEqual(a.moments.map(({ kind, name, frame, at }) => [kind, name, frame, at]), [['cue', 'hit', 43, 'beat 2']]);
  assert.deepEqual([b.musicBeat, b.moments.map(({ kind, name, at }) => [kind, name, at])], [1.5, [
    ['cue', 'late', 'beat 1 +3f'], ['replay', 'again', 'a.hit on b.late'],
    ['cue', 'stop', 'end'], ['landmark', 'the final hit', 'b.stop on the music\'s downbeat -1'],
  ]]);
});

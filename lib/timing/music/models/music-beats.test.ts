import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectMusicBeats } from './music-beats.ts';

const RATE = 22050;

/** A noisy drum loop `seconds` long: a kick on every beat from `first` s at `bpm` and a softer hat on every off-beat. */
function drumLoop(seconds: number, bpm: number, first: number): Float32Array {
  const samples = new Float32Array(RATE * seconds);
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.05;
  for (let i = 0; i < samples.length; i++) samples[i] = noise();
  const hit = (at: number, gain: number) => {
    for (let k = 0; k < RATE * 0.08; k++) samples[Math.round(at * RATE) + k] += gain * Math.exp(-k / (RATE * 0.015)) * Math.sin(k * 0.3);
  };
  for (let t = first; t < seconds - 0.2; t += 60 / bpm) {
    hit(t, 0.9);
    hit(t + 30 / bpm, 0.3);
  }
  return samples;
}

test('finds the tempo and the beats of a noisy drum loop, not half or double time', () => {
  const bpm = 96, first = 0.37;
  const found = detectMusicBeats(drumLoop(20, bpm, first), RATE);
  assert.ok(Math.abs(found.bpm - bpm) < 1, `bpm ${found.bpm}`);
  // The noise the loop starts in is no onset: the first beat is its first kick.
  assert.ok(Math.abs(found.beats[0] - first) < 0.03, `the first beat is at ${found.beats[0]} s`);
  const expected = Array.from({ length: 30 }, (_, k) => first + k * (60 / bpm));
  for (const t of expected) assert.ok(found.beats.some((b) => Math.abs(b - t) < 0.03), `no beat near ${t.toFixed(2)}s`);
});

test('hears a kick on the first sample as the first beat: a track cut on its downbeat', () => {
  const found = detectMusicBeats(drumLoop(10, 120, 0), RATE);
  assert.ok(Math.abs(found.beats[0]) < 0.03, `the first beat is at ${found.beats[0]} s`);
  assert.ok(Math.abs(found.beats[1] - 0.5) < 0.03, `the second beat is at ${found.beats[1]} s`);
});

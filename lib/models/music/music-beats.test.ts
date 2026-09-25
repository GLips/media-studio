import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectMusicBeats } from './music-beats.ts';

test('finds the tempo and the beats of a noisy drum loop, not half or double time', () => {
  const rate = 22050, seconds = 20, bpm = 96, first = 0.37;
  const samples = new Float32Array(rate * seconds);
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.05;
  for (let i = 0; i < samples.length; i++) samples[i] = noise();
  // A kick on every beat and a softer hat on every off-beat, each a decaying burst.
  const hit = (at: number, gain: number) => {
    for (let k = 0; k < rate * 0.08; k++) samples[Math.round(at * rate) + k] += gain * Math.exp(-k / (rate * 0.015)) * Math.sin(k * 0.3);
  };
  for (let t = first; t < seconds - 0.2; t += 60 / bpm) {
    hit(t, 0.9);
    hit(t + 30 / bpm, 0.3);
  }
  const found = detectMusicBeats(samples, rate);
  assert.ok(Math.abs(found.bpm - bpm) < 1, `bpm ${found.bpm}`);
  const expected = Array.from({ length: 28 }, (_, k) => first + (k + 2) * (60 / bpm));
  for (const t of expected) assert.ok(found.beats.some((b) => Math.abs(b - t) < 0.03), `no beat near ${t.toFixed(2)}s`);
});

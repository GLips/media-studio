import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seededRandom } from './dsp.ts';
import { detectAudioAttacks } from './sound-check.ts';

test('finds each click over a noise bed within 4 ms of where it starts, and nothing in the bed', () => {
  const rate = 16000, clicks = [0.5, 1.2371, 1.9003, 2.6667];
  const random = seededRandom(1);
  const samples = Float32Array.from({ length: rate * 3 }, () => (random() * 2 - 1) * 0.01);
  // A 3 kHz click decaying over a few ms, about 30 dB over the bed.
  for (const at of clicks) {
    const start = Math.round(at * rate);
    for (let i = 0; i < rate * 0.03; i++) samples[start + i] += 0.5 * Math.sin((2 * Math.PI * 3000 * i) / rate) * Math.exp(-i / (rate * 0.005));
  }
  const found = detectAudioAttacks(samples, rate, 12).map((a) => a.t);
  assert.equal(found.length, clicks.length, `attacks at ${found.map((t) => t.toFixed(3)).join(', ')}`);
  found.forEach((t, k) => assert.ok(Math.abs(t - clicks[k]) <= 0.004, `the click at ${clicks[k]} s was found at ${t.toFixed(4)} s`));
});

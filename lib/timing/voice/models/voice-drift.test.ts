import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measureVoiceClip, voiceDrift } from './voice-drift.ts';

const RATE = 24000;
/** `syllables` bursts of a voice-like tone at `hz` (a fundamental and two overtones), each `seconds` long, 0.3 s apart. */
function bursts(hz: number, syllables: number, seconds: number) {
  const samples: number[] = [];
  for (let s = 0; s < syllables; s++) {
    samples.push(...Array.from({ length: 0.3 * RATE }, () => 0));
    for (let i = 0; i < seconds * RATE; i++) {
      const t = (2 * Math.PI * hz * i) / RATE;
      samples.push(Math.round(6000 * Math.sin(t) + 3000 * Math.sin(2 * t) + 1500 * Math.sin(3 * t)));
    }
  }
  return Int16Array.from(samples);
}
const text = 'ba ba ba ba';

test('two reads of a line are heard apart past 1.5 semitones or 15% pace, and not short of them', () => {
  const other = measureVoiceClip(text, bursts(150, 4, 0.2), RATE);
  assert.ok(Math.abs(other.pitchHz! - 150) < 1, `heard ${other.pitchHz} Hz`);
  assert.ok(Math.abs(other.syllablesPerSecond! - 5) < 0.3, `heard ${other.syllablesPerSecond} syllables a second`);

  assert.deepEqual(voiceDrift(measureVoiceClip(text, bursts(155, 4, 0.19), RATE), other), []);
  assert.deepEqual(voiceDrift(measureVoiceClip(text, bursts(170, 4, 0.15), RATE), other), ['2.2 semitones higher', '33% faster']);
});

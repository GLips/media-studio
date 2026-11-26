import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { soundEnvelopeOf, type PlacedSoundClip } from '../models/sound-clip.ts';
import { mixSoundClips, SOUND_MIX_RATE } from './sound-mix.ts';

// A 30 ms quarter-sine fade in, as a clean edge of a recorded line.
const fade = (s: number) => Math.sin((Math.PI / 2) * Math.min(1, s / 0.03));

// Constant full-scale DC, so each mixed sample reads back as the gain applied to it.
function dcWav(file: string, seconds: number) {
  const samples = new Float32Array(Math.round(seconds * SOUND_MIX_RATE)).fill(0.5);
  writeFileSync(`${file}.f32`, new Uint8Array(samples.buffer));
  runFfmpeg(['-y', '-v', 'error', '-f', 'f32le', '-ar', String(SOUND_MIX_RATE), '-ac', '1', '-i', `${file}.f32`, '-c:a', 'pcm_f32le', file]);
}

// A mono source, as voice lines are: it plays at full level in the left channel, which is read back.
test('a clip starts on its sample, between frames, and its fade rises smoothly per sample', () => withStudioTemp('sound-mix-test', async (tmp) => {
  const src = join(tmp, 'dc.wav'), out = join(tmp, 'mix.wav');
  dcWav(src, 1);
  const clip: PlacedSoundClip = { id: 'line', src, from: 0, duration: 0.5, loop: false, gain: soundEnvelopeOf(fade, 0.5, 'line'), start: 0.0105, scene: null };
  await mixSoundClips([clip], { from: 0, seconds: 1, out, fileOf: (s) => s });
  const pcm = runFfmpeg(['-v', 'error', '-i', out, '-af', 'pan=mono|c0=c0', '-f', 'f32le', '-']);
  const mixed = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4).map((x) => x / 0.5);
  const first = mixed.findIndex((x) => x > 0);
  assert.ok(Math.abs(first - 0.0105 * SOUND_MIX_RATE) <= 1, `starts at sample ${first}`);
  // Across the fade no sample-to-sample rise is bigger than the curve's own steepest (about 1/48000 / 0.03 × π/2).
  const steps = Array.from({ length: 0.03 * SOUND_MIX_RATE }, (_, i) => mixed[first + i + 1] - mixed[first + i]);
  assert.ok(Math.max(...steps) < 1.5e-3 && Math.min(...steps) >= -1e-6, `largest step ${Math.max(...steps)}`);
  assert.ok(Math.abs(mixed[first + 0.1 * SOUND_MIX_RATE] - 1) < 1e-3 && mixed[first + 0.5 * SOUND_MIX_RATE + 2] === 0);
  assert.ok(readFileSync(out).length > 0);
}));

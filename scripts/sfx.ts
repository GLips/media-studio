// sfx.ts: synthesizes the kit's sound effects into lib/studio/sfx/, so they're ours to change and carry no licence.
//
//   node scripts/sfx.ts
//
// Each is a press and a softer release, like the real thing: a burst of filtered noise for the contact, and a couple
// of decaying resonances for the body. The noise is seeded, so a rerun writes the same files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { wavFromSamples } from '../lib/wav.ts';

const RATE = 48000;
const PEAK_DB = -10;

type Transient = { at: number; gain: number; noiseTau: number; tones: readonly { hz: number; tau: number; gain: number }[] };

function synthesize(transients: readonly Transient[], seconds: number): Int16Array {
  const out = new Float64Array(Math.round(seconds * RATE));
  let seed = 0x2545f491;
  const noise = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 0xffffffff) * 2 - 1; };
  for (const { at, gain, noiseTau, tones } of transients) {
    let prev = 0;
    for (let i = Math.round(at * RATE), j = 0; i < out.length; i++, j++) {
      const t = j / RATE;
      // A first difference tilts the noise toward the highs, where a click's snap lives.
      const n = noise(), snap = (n - prev) * 0.5 * Math.exp(-t / noiseTau);
      prev = n;
      const body = tones.reduce((sum, { hz, tau, gain: g }) => sum + g * Math.sin(2 * Math.PI * hz * t) * Math.exp(-t / tau), 0);
      out[i] += gain * (snap + body);
    }
  }
  const peak = Math.max(...out.map(Math.abs));
  const scale = (10 ** (PEAK_DB / 20) / peak) * 32767;
  return Int16Array.from(out, (v) => Math.round(v * scale));
}

const mouse = (gain: number, at: number): Transient => ({
  at, gain, noiseTau: 0.0008, tones: [{ hz: 3400, tau: 0.0025, gain: 0.5 }, { hz: 1150, tau: 0.004, gain: 0.35 }],
});
const key = (gain: number, at: number): Transient => ({
  at, gain, noiseTau: 0.0018, tones: [{ hz: 1900, tau: 0.003, gain: 0.3 }, { hz: 620, tau: 0.007, gain: 0.55 }],
});

const dir = 'lib/studio/sfx';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/click.wav`, wavFromSamples(synthesize([mouse(1, 0), mouse(0.45, 0.07)], 0.12), RATE));
writeFileSync(`${dir}/key.wav`, wavFromSamples(synthesize([key(1, 0), key(0.35, 0.08)], 0.14), RATE));
console.log(`wrote ${dir}/click.wav and key.wav`);

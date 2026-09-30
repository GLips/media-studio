// sfx-loudness.ts: ITU BS.1770 loudness of synthesized samples, in-process so a recipe stays a pure function. It
// matches lib/platform/ffmpeg/engine/loudness.ts (ffmpeg's ebur128 with dualmono) on the same file.
import { SFX_RATE } from './dsp.ts';

// K-weighting at 48 kHz, the coefficients BS.1770 tabulates: a high shelf for the head, then a high-pass.
const SHELF = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] };
const HIGHPASS = { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] };

function biquad(x: Float64Array, { b, a }: { b: number[]; a: number[] }): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    y[i] = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y[i];
  }
  return y;
}

/**
 * Integrated loudness in LUFS, counting the mono sound as it plays in the stereo mix (from both speakers, +3 LU), as
 * the voice's −20 LUFS is counted. A sound shorter than one 400 ms block is measured as if padded with silence to
 * one, which is what ffmpeg reports for the file padded the same way.
 */
export function measureSfxLufs(samples: Float64Array): number {
  const block = Math.round(0.4 * SFX_RATE), hop = Math.round(0.1 * SFX_RATE);
  const padded = new Float64Array(Math.max(samples.length, block));
  padded.set(samples);
  const k = biquad(biquad(padded, SHELF), HIGHPASS);
  const powers: number[] = [];
  for (let start = 0; start + block <= k.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + block; i++) sum += k[i] * k[i];
    powers.push((2 * sum) / block);
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p);
  const mean = (ps: number[]) => ps.reduce((s, p) => s + p, 0) / ps.length;
  const absolute = powers.filter((p) => lufs(p) > -70);
  if (!absolute.length) return -Infinity;
  const relativeGate = lufs(mean(absolute)) - 10;
  return lufs(mean(absolute.filter((p) => lufs(p) > relativeGate)));
}

// music-beats.ts: finds the beat in a music track, so cuts can land on it. Pure: takes mono samples, returns times.
//
// The method is Ellis's dynamic-programming beat tracker ("Beat Tracking by Dynamic Programming", 2007): an onset
// envelope from rises in loudness, a global tempo from its autocorrelation, then the sequence of beats that best
// balances landing on onsets against keeping that tempo. It follows gentle drift, which a fixed grid can't.

const HOP_SECONDS = 0.01;
const WINDOW_HOPS = 4;

export type MusicBeats = { bpm: number; beats: number[] };

export function detectMusicBeats(samples: Float32Array, rate: number): MusicBeats {
  const onset = onsetEnvelope(samples, rate);
  const hopSeconds = Math.round(rate * HOP_SECONDS) / rate;
  const period = beatPeriod(onset);
  return {
    bpm: Math.round((60 / (period * hopSeconds)) * 10) / 10,
    beats: trackBeats(onset, period).map((i) => Math.round((i + WINDOW_HOPS) * hopSeconds * 1000) / 1000),
  };
}

/**
 * Per 10 ms hop: how sharply loudness rises, with the slow trend taken out. A hop's energy window starts at the hop,
 * so it first catches a hit WINDOW_HOPS early; beat times add that back.
 */
function onsetEnvelope(samples: Float32Array, rate: number): Float64Array {
  const hop = Math.round(rate * HOP_SECONDS), win = hop * WINDOW_HOPS;
  const frames = Math.max(0, Math.floor((samples.length - win) / hop));
  const energy = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let k = f * hop; k < f * hop + win; k++) sum += samples[k] * samples[k];
    energy[f] = Math.log(1e-10 + sum / win);
  }
  const rise = new Float64Array(frames);
  for (let f = 1; f < frames; f++) rise[f] = Math.max(0, energy[f] - energy[f - 1]);
  // Subtracting a half-second moving average leaves the peaks that stand out from their surroundings.
  const span = 25, onset = new Float64Array(frames);
  let acc = 0;
  for (let f = 0; f < frames; f++) {
    acc += rise[f] - (f - 2 * span - 1 >= 0 ? rise[f - 2 * span - 1] : 0);
    const mean = acc / Math.min(f + 1, 2 * span + 1);
    onset[f] = Math.max(0, rise[Math.max(0, f - span)] - mean);
  }
  // The average lags by `span`, so shift the envelope back into place. Unit spread, so the tracker's tempo penalty
  // weighs the same against any track's onsets.
  const shifted = onset.subarray(span);
  const mean = shifted.reduce((s, x) => s + x, 0) / shifted.length;
  const sd = Math.sqrt(shifted.reduce((s, x) => s + (x - mean) ** 2, 0) / shifted.length) || 1;
  return shifted.map((x) => x / sd);
}

/** The beat period in hops, from 60–180 BPM, favouring tempos near 120 so a half- or double-time reading loses. */
function beatPeriod(onset: Float64Array): number {
  const lo = Math.round(60 / 180 / HOP_SECONDS), hi = Math.round(60 / 60 / HOP_SECONDS);
  const correlation = (lag: number) => {
    let sum = 0;
    for (let i = lag; i < onset.length; i++) sum += onset[i] * onset[i - lag];
    return sum;
  };
  const prior = (lag: number) => Math.exp(-0.5 * (Math.log2(lag / (0.5 / HOP_SECONDS)) / 0.9) ** 2);
  let best = lo;
  for (let lag = lo; lag <= hi; lag++) if (correlation(lag) * prior(lag) > correlation(best) * prior(best)) best = lag;
  // The prior only picks the peak: a parabola through the raw correlation places it between whole hops, where the
  // prior's slope would drag it toward 120 BPM.
  const [a, b, c] = [correlation(best - 1), correlation(best), correlation(best + 1)], denom = a - 2 * b + c;
  return denom < 0 ? best + (0.5 * (a - c)) / denom : best;
}

/** Beat indices (in hops): each beat's score is its onset plus the best predecessor's, less a penalty for off-tempo gaps. */
function trackBeats(onset: Float64Array, period: number): number[] {
  const n = onset.length, tightness = 100;
  const score = new Float64Array(n), from = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let best = 0, bestAt = -1;
    for (let j = Math.max(0, Math.round(i - 2 * period)); j <= i - Math.round(period / 2); j++) {
      const s = score[j] - tightness * Math.log((i - j) / period) ** 2;
      if (bestAt < 0 || s > best) [best, bestAt] = [s, j];
    }
    score[i] = onset[i] + (bestAt >= 0 ? Math.max(0, best) : 0);
    from[i] = bestAt >= 0 && best > 0 ? bestAt : -1;
  }
  // End on the best-scoring beat in the last period, then walk back.
  let end = n - 1;
  for (let i = Math.max(0, Math.floor(n - period)); i < n; i++) if (score[i] > score[end]) end = i;
  const beats: number[] = [];
  for (let i = end; i >= 0; i = from[i]) beats.push(i);
  return beats.reverse();
}

// music-fit.ts: rebuilds a music track to an exact length, ending where the track ends. Pure: samples and beats in,
// spans of the source out. `studio music fit` runs it (lib/music-track.ts).
//
// PyMusicLooper's `extend` generalised: the track plays from its start to its own ending, jumping between downbeats
// whose surrounding bars sound alike (compared as per-beat spectra) to lose or repeat whole bars, so the meter
// carries across each seam. One loop pair only reaches lengths in steps of its loop, so the path may take several
// jumps; each seam costs, so it takes few and long ones. What's left over, under a bar, comes off the head, under
// the mix's fade-in, or goes before it as silence, so the music comes in a moment after the picture.

/**
 * A stretch of the source track, in its seconds. A fitted track plays its spans end to end. A negative `from` on the
 * first span is that much silence before the track comes in.
 */
export type MusicSpan = { from: number; to: number };

export type MusicFitPlan = {
  spans: MusicSpan[];
  /** Where each span after the first starts, in the fitted track's seconds: the seams to listen for. */
  seams: number[];
  /**
   * How different the bars either side of each seam sound, in dB per band averaged (typically 0.5–5). NaN where a
   * seam sits too near the track's start or end to compare.
   */
  seamDb: number[];
  /** Beats and downbeats in the fitted track's seconds. */
  beats: number[];
  downbeats: number[];
  /** Which of the source's beats (0–3, then every 4th) the fit took as beat 1 of a bar. A guess: confirm it by ear. */
  downbeatPhase: number;
  /** How different the bars either side of the worst seam sound, in dB per band averaged; 0 without a seam. */
  worstSeamDb: number;
};

const BEATS_PER_BAR = 4;
// Bars on each side of a seam that must sound alike: the listener hears the bar before one point run into the bar
// after the other.
const CONTEXT_BEATS = 4;
// A seam's cost on top of how unalike its sides sound (typically 0.5–5 dB), so one long loop beats many short ones.
const SEAM_COST_DB = 1.5;
// Bars played between two seams at least, so a jump never follows a jump.
const MIN_SPAN_BARS = 2;
// Seams cut this far before the downbeat, so its attack comes whole from the far side, and crossfade over XFADE.
const CUT_BEFORE_BEAT = 0.02;
export const MUSIC_SEAM_XFADE = 0.03;
const SILENCE_DB = -60;

/** Plans a fit of `samples` (mono) with `beats` (seconds, from detectMusicBeats) to exactly `targetSeconds`. */
export function planMusicFit({ samples, rate, beats, targetSeconds }: { samples: Float32Array; rate: number; beats: readonly number[]; targetSeconds: number }): MusicFitPlan {
  const { soundStart, end, beatsIn, features, phase } = analyseMusic(samples, rate, beats);
  const bar = median(beatsIn.slice(BEATS_PER_BAR).map((b, i) => b - beatsIn[i]));
  const maxHeadTrim = soundStart + bar, maxLeadIn = bar;
  const cut = (k: number) => beatsIn[k] - CUT_BEFORE_BEAT;

  // A shortest path over (downbeat, bars played so far, bars since the last seam): play a bar to the next downbeat,
  // or jump to another. Bars played only grows, and a jump needs MIN_SPAN_BARS since the last, so there's no cycle.
  const downbeats = beatsIn.map((_, k) => k).filter((k) => k % BEATS_PER_BAR === phase && k < features.length);
  const jumpable = downbeats.map((k) => k >= CONTEXT_BEATS && k + CONTEXT_BEATS <= features.length);
  const seamDb = downbeats.map((a, i) => downbeats.map((b, j) => (jumpable[i] && jumpable[j] && i !== j ? barDistance(features, a, b) : Infinity)));
  // `shift` is the seconds the jumps so far add to the track (negative when they skip).
  type Step = { cost: number; shift: number; worst: number; prev?: Step; jump?: [number, number] };
  const maxBars = Math.ceil((targetSeconds + maxHeadTrim) / (bar * 0.9)) + 1;
  const steps: (Step | undefined)[][][] = Array.from({ length: maxBars + 1 }, () => downbeats.map(() => Array(MIN_SPAN_BARS + 1)));
  const relax = (c: number, i: number, since: number, next: Step) => {
    const was = steps[c][i][since];
    if (!was || next.cost < was.cost - 1e-9) steps[c][i][since] = next;
  };
  steps[0][0][0] = { cost: 0, shift: 0, worst: 0 };
  let best: { cost: number; headTrim: number; step: Step } | undefined;
  for (let c = 0; c <= maxBars; c++) {
    for (const [i, a] of downbeats.entries()) {
      const settled = steps[c][i][MIN_SPAN_BARS];
      if (settled) {
        for (const [j, b] of downbeats.entries()) {
          if (seamDb[i][j] === Infinity) continue;
          relax(c, j, 0, {
            cost: settled.cost + seamDb[i][j] + SEAM_COST_DB, shift: settled.shift + beatsIn[a] - beatsIn[b],
            worst: Math.max(settled.worst, seamDb[i][j]), prev: settled, jump: [a, b],
          });
        }
      }
    }
    for (const [i] of downbeats.entries()) {
      for (let since = 0; since <= MIN_SPAN_BARS; since++) {
        const step = steps[c][i][since];
        if (!step) continue;
        if (i === downbeats.length - 1) {
          // At the last downbeat: the outro plays out, and the leftover is trimmed off the head or led in with silence.
          const headTrim = end + step.shift - targetSeconds;
          if (headTrim < -maxLeadIn || headTrim > maxHeadTrim) continue;
          const cost = step.cost + Math.max(-headTrim, headTrim - soundStart, 0) / bar;
          if (!best || cost < best.cost - 1e-9) best = { cost, headTrim, step };
        } else if (c < maxBars) {
          relax(c + 1, i + 1, Math.min(since + 1, MIN_SPAN_BARS), step);
        }
      }
    }
  }
  if (!best) throw new Error(`can't fit a ${end.toFixed(1)} s track to ${targetSeconds.toFixed(1)} s on its bar lines`);

  const jumps: [number, number][] = [];
  for (let step: Step | undefined = best.step; step; step = step.prev) if (step.jump) jumps.unshift(step.jump);
  const spans: MusicSpan[] = [];
  let from = best.headTrim;
  for (const [a, b] of jumps) {
    spans.push({ from, to: cut(a) });
    from = cut(b);
  }
  spans.push({ from, to: end });
  return placeMusicSpans(spans, beatsIn, phase, jumps.map(([a, b]) => seamDb[downbeats.indexOf(a)][downbeats.indexOf(b)]));
}

/**
 * Plans a track that plays the source's `bars` in the order given, for a picture that needs time in particular
 * places: `[1, 2, 3, 3, 4]` plays bar 3 twice. Bar 1 starts on the first downbeat. Consecutive bars play as one span,
 * so each place the order breaks is a seam, and the plan says how alike its two sides sound. A run from bar 1 keeps
 * the pickup before it, and the track's last bar keeps its outro, then `tailSeconds` of silence, for a picture that
 * holds past the music's ending. The track's length is the arrangement's.
 */
export function planMusicArrangement({ samples, rate, beats, bars, tailSeconds = 0 }: {
  samples: Float32Array; rate: number; beats: readonly number[]; bars: readonly number[]; tailSeconds?: number;
}): MusicFitPlan & { seconds: number } {
  const { end, beatsIn, features, phase } = analyseMusic(samples, rate, beats);
  const downbeats = beatsIn.map((_, k) => k).filter((k) => k % BEATS_PER_BAR === phase);
  const last = downbeats.length;
  for (const b of bars) if (!Number.isInteger(b) || b < 1 || b > last) throw new Error(`the track's bars are 1–${last}; there's no bar ${b}`);
  const runs: [number, number][] = [];
  for (const b of bars) {
    const run = runs.at(-1);
    if (run && b === run[1] + 1) run[1] = b;
    else runs.push([b, b]);
  }
  if (runs.slice(0, -1).some(([, b]) => b === last)) throw new Error(`bar ${last} is the track's ending, so it can only come last`);
  if (tailSeconds && runs.at(-1)![1] !== last) throw new Error(`a tail of silence follows the track's ending, bar ${last}; end the bars on it`);
  const cut = (bar: number) => beatsIn[downbeats[bar - 1]] - CUT_BEFORE_BEAT;
  const spans = runs.map(([a, b]) => ({ from: a === 1 ? 0 : cut(a), to: b === last ? end + tailSeconds : cut(b + 1) }));
  // A seam jumps from where the music would have gone on (the downbeat after the run) to the next run's first bar.
  const jumpable = (k: number) => k >= CONTEXT_BEATS && k + CONTEXT_BEATS <= features.length;
  const seamDb = runs.slice(1).map(([a], i) => {
    const from = downbeats[runs[i][1]], to = downbeats[a - 1];
    return jumpable(from) && jumpable(to) ? barDistance(features, from, to) : NaN;
  });
  const plan = placeMusicSpans(spans, beatsIn.filter((b) => b < end), phase, seamDb);
  return { ...plan, seconds: round3(spans.reduce((sum, s) => sum + s.to - s.from, 0)) };
}

/** The analysis both plans share: where the track is audible, its beats, each beat's spectrum, and the downbeats. */
function analyseMusic(samples: Float32Array, rate: number, beats: readonly number[]) {
  const { start: soundStart, end } = audibleSpan(samples, rate);
  const beatsIn = beats.filter((b) => b + 0.1 < end);
  if (beatsIn.length < 3 * BEATS_PER_BAR) throw new Error(`the track has ${beatsIn.length} beats; fitting needs at least three bars`);
  const features = beatSpectra(samples, rate, beatsIn);
  return { soundStart, end, beatsIn, features, phase: downbeatPhase(samples, rate, beatsIn, features) };
}

/** A plan that plays `spans` end to end: its seams, and the source's beats and downbeats where they land in it. */
function placeMusicSpans(spans: readonly MusicSpan[], beatsIn: readonly number[], phase: number, seamDb: readonly number[]): MusicFitPlan {
  const offsets = spans.map((_, i) => spans.slice(0, i).reduce((sum, s) => sum + s.to - s.from, 0));
  const place = (source: readonly number[]) => spans.flatMap((s, i) => source.filter((b) => b >= s.from && b < s.to).map((b) => round3(offsets[i] + b - s.from)));
  const measured = seamDb.filter((db) => !Number.isNaN(db));
  return {
    spans: spans.map((s) => ({ from: round3(s.from), to: round3(s.to) })),
    seams: offsets.slice(1).map(round3),
    seamDb: seamDb.map((db) => Math.round(db * 100) / 100),
    beats: place(beatsIn),
    downbeats: place(beatsIn.filter((_, k) => k % BEATS_PER_BAR === phase)),
    downbeatPhase: phase,
    worstSeamDb: measured.length ? Math.round(Math.max(...measured) * 100) / 100 : 0,
  };
}

/**
 * Plays `spans` of each channel end to end, crossfading each seam, to exactly `seconds`. The last span's end gives
 * way to the first's start, to the sample, so rounding never moves the ending.
 */
export function spliceMusicSpans(channels: readonly Float32Array[], rate: number, spans: readonly MusicSpan[], seconds: number): Float32Array[] {
  const length = Math.round(seconds * rate);
  const bounds = spans.map((s) => ({ from: Math.round(s.from * rate), to: Math.round(s.to * rate) }));
  const spare = bounds.reduce((sum, b) => sum + b.to - b.from, 0) - length;
  bounds[0].from += spare;
  const half = Math.round((MUSIC_SEAM_XFADE * rate) / 2);
  return channels.map((source) => {
    const out = new Float32Array(length);
    let at = 0;
    for (const [i, { from, to }] of bounds.entries()) {
      // Each span reaches `half` past its ends into the source, faded, so the two sides overlap across the seam.
      const lead = i === 0 ? 0 : half, trail = i === bounds.length - 1 ? 0 : half;
      for (let k = -lead; k < to - from + trail; k++) {
        const o = at + k;
        if (o < 0 || o >= length) continue;
        const inFade = k < lead ? (k + lead) / (2 * lead) : 1;
        const outFade = k >= to - from - trail ? (to - from + trail - k) / (2 * trail) : 1;
        // Equal power, since the two sides aren't the same waveform.
        out[o] += (source[from + k] ?? 0) * Math.sin((Math.PI / 2) * Math.min(inFade, outFade));
      }
      at += to - from;
    }
    // A short ramp at each end keeps the file from clicking: the mix fades the head in, but a fitted track's tail
    // isn't faded, and a source that stops dead would end the video on a click.
    const ramp = Math.round(0.01 * rate);
    for (let k = 0; k < ramp; k++) {
      out[k] *= k / ramp;
      out[length - 1 - k] *= k / ramp;
    }
    return out;
  });
}

/** Where the track is louder than silence: leading silence is free to trim, and trailing silence isn't its ending. */
function audibleSpan(samples: Float32Array, rate: number) {
  const win = Math.round(rate * 0.01), threshold = 10 ** (SILENCE_DB / 10);
  let start = -1, last = 0;
  for (let w = 0; (w + 1) * win <= samples.length; w++) {
    let sum = 0;
    for (let k = w * win; k < (w + 1) * win; k++) sum += samples[k] * samples[k];
    if (sum / win > threshold) {
      if (start < 0) start = w;
      last = w;
    }
  }
  if (start < 0) throw new Error('the track is silent');
  return { start: (start * win) / rate, end: Math.min(samples.length / rate, ((last + 1) * win) / rate + 0.05) };
}

// Log-spaced bands from 50 Hz to 10 kHz: coarse enough that two passes of the same bar match, fine enough to hear
// a chord change.
const BANDS = 24;
const FFT_SIZE = 2048;

/** Each beat's average spectrum, in dB per band, from its beat to the next. */
function beatSpectra(samples: Float32Array, rate: number, beats: readonly number[]): Float64Array[] {
  const edges = Array.from({ length: BANDS + 1 }, (_, i) => Math.round((50 * (10000 / 50) ** (i / BANDS) * FFT_SIZE) / rate));
  const window = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE));
  return beats.slice(0, -1).map((b, k) => {
    const from = Math.round(b * rate), to = Math.round(beats[k + 1] * rate);
    const bands = new Float64Array(BANDS);
    let frames = 0;
    for (let at = from; at + FFT_SIZE <= Math.max(to, from + FFT_SIZE) && at + FFT_SIZE <= samples.length; at += FFT_SIZE / 2) {
      const power = powerSpectrum(samples, at, window);
      for (let band = 0; band < BANDS; band++) for (let bin = edges[band]; bin < Math.max(edges[band + 1], edges[band] + 1); bin++) bands[band] += power[bin];
      frames++;
    }
    return bands.map((p) => 10 * Math.log10(1e-12 + p / Math.max(1, frames)));
  });
}

/** Mean absolute difference, in dB per band, between the bars around beat `a` and the bars around beat `b`. */
function barDistance(features: readonly Float64Array[], a: number, b: number): number {
  let sum = 0;
  for (let j = -CONTEXT_BEATS; j < CONTEXT_BEATS; j++) {
    for (let band = 0; band < BANDS; band++) sum += Math.abs(features[a + j][band] - features[b + j][band]);
  }
  return sum / (2 * CONTEXT_BEATS * BANDS);
}

/**
 * Beat 1 of each bar, as the phase (0–3) whose beats hit hardest in the bass and change the harmony most. The beat
 * tracker doesn't know which beat is the one; this guesses, and a steady four-on-the-floor can fool it.
 */
function downbeatPhase(samples: Float32Array, rate: number, beats: readonly number[], features: readonly Float64Array[]): number {
  const window = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE));
  const bassBins = [Math.round((40 * FFT_SIZE) / rate), Math.round((200 * FFT_SIZE) / rate)];
  const bass = beats.slice(0, features.length).map((b) => {
    const at = Math.min(Math.round(b * rate), samples.length - FFT_SIZE);
    const power = powerSpectrum(samples, Math.max(0, at), window);
    let sum = 0;
    for (let bin = bassBins[0]; bin <= bassBins[1]; bin++) sum += power[bin];
    return 10 * Math.log10(1e-12 + sum);
  });
  const change = features.map((f, k) => (k === 0 ? 0 : f.reduce((sum, x, band) => sum + Math.abs(x - features[k - 1][band]), 0) / BANDS));
  const bassZ = zScores(bass), changeZ = zScores(change);
  let best = 0, bestScore = -Infinity;
  for (let phase = 0; phase < BEATS_PER_BAR; phase++) {
    let sum = 0, count = 0;
    for (let k = phase; k < features.length; k += BEATS_PER_BAR) {
      sum += bassZ[k] + changeZ[k];
      count++;
    }
    if (sum / count > bestScore) [best, bestScore] = [phase, sum / count];
  }
  return best;
}

function powerSpectrum(samples: Float32Array, at: number, window: Float64Array): Float64Array {
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) re[i] = (samples[at + i] ?? 0) * window[i];
  fft(re, im);
  return Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => re[i] * re[i] + im[i] * im[i]);
}

/** In-place radix-2 FFT; the length must be a power of two. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(angle * k), wi = Math.sin(angle * k);
        const a = i + k, b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

function zScores(xs: readonly number[]): number[] {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length) || 1;
  return xs.map((x) => (x - mean) / sd);
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const round3 = (x: number) => Math.round(x * 1000) / 1000;

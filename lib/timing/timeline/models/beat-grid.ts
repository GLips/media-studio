// beat-grid.ts: a music track's beats as a video's clock, for cutting a music-led video (a teaser, a reel) on the beat.
// Scene lengths and every hit inside them come from beat numbers, so the picture stays on the music when the track or
// its fit changes.

/** Beat numbers and seconds, both ways. Beat 0 is the track's first downbeat, at `at(0)` seconds of the video. */
export type BeatGrid = {
  bpm: number;
  /** Seconds per beat, at the track's tempo. */
  spb: number;
  /** Seconds into the video that beat `n` falls (fractions for off-beats: 2.5 is the "and" after beat 2). */
  at(n: number): number;
  /** The frame beat `n` lands on at `fps`: cut here, so the cut is never a frame late. */
  frame(n: number, fps: number): number;
  /** The beat at `t` seconds, as a fraction. */
  beatOf(t: number): number;
};

/**
 * A track's grid as played: its tracked beats from its first downbeat, so drift is followed.
 *
 * `steady` fits one tempo and phase, for a grid-made track whose beats a syncopated bass pulls up to 100 ms off.
 * Across a fitted seam that holds only if the seam sat on the source's grid: check cuts after one by ear.
 */
export function beatGrid(track: { bpm: number; beats: readonly number[]; fit?: { downbeats: readonly number[] } }, { sourceStartSeconds = 0, steady = false } = {}): BeatGrid {
  const first = track.fit?.downbeats[0] ?? track.beats[0];
  const tracked = track.beats.filter((b) => b >= first - 1e-6).map((b) => b - sourceStartSeconds);
  if (!tracked.length) throw new Error('beatGrid: the track has no beats from its first downbeat on');
  const spb = 60 / track.bpm;
  if (steady) return fitSteadyBeatGrid(tracked, spb);
  const beats = tracked;
  const at = (n: number) => {
    if (n <= 0) return beats[0] + n * spb;
    const i = Math.floor(n);
    if (i + 1 < beats.length) return beats[i] + (n - i) * (beats[i + 1] - beats[i]);
    return beats[beats.length - 1] + (n - (beats.length - 1)) * spb;
  };
  const beatOf = (t: number) => {
    if (t <= beats[0]) return (t - beats[0]) / spb;
    for (let i = 0; i + 1 < beats.length; i++) if (t < beats[i + 1]) return i + (t - beats[i]) / (beats[i + 1] - beats[i]);
    return beats.length - 1 + (t - beats[beats.length - 1]) / spb;
  };
  return { bpm: track.bpm, spb, at, frame: (n, fps) => Math.round(at(n) * fps), beatOf };
}

/** A grid at a fixed tempo with beat 0 at `first` seconds: for building before the track exists. */
export function steadyBeatGrid(bpm: number, first = 0): BeatGrid {
  const spb = 60 / bpm;
  return { bpm, spb, at: (n) => first + n * spb, frame: (n, fps) => Math.round((first + n * spb) * fps), beatOf: (t) => (t - first) / spb };
}

/**
 * One tempo and phase through tracked beats, robust to the stretches a tracker got pulled off (which all lean the same
 * way, so a median of slopes leans with them). Every line through two beats a bar or more apart is a candidate; the
 * one the most beats sit within 25 ms of wins, then refined by least squares.
 */
function fitSteadyBeatGrid(beats: readonly number[], nominalSpb: number): BeatGrid {
  const n = beats.map((b) => Math.round((b - beats[0]) / nominalSpb));
  const near = (spb: number, at0: number) => beats.flatMap((b, k) => (Math.abs(b - at0 - n[k] * spb) < 0.025 ? [k] : []));
  let best = beats.map((_, k) => k);
  let most = 0;
  for (let i = 0; i < beats.length; i++) {
    for (let j = i + 1; j < beats.length; j++) {
      if (n[j] - n[i] < 4) continue;
      const spb = (beats[j] - beats[i]) / (n[j] - n[i]);
      const inliers = near(spb, beats[i] - n[i] * spb);
      if (inliers.length > most) [best, most] = [inliers, inliers.length];
    }
  }
  const mx = best.reduce((a, k) => a + n[k], 0) / best.length, my = best.reduce((a, k) => a + beats[k], 0) / best.length;
  const sxx = best.reduce((a, k) => a + (n[k] - mx) ** 2, 0);
  const spb = sxx > 0 ? best.reduce((a, k) => a + (n[k] - mx) * (beats[k] - my), 0) / sxx : nominalSpb;
  return steadyBeatGrid(60 / spb, my - mx * spb);
}

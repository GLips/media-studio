// library-quiet.ts: where a spoken track's levelled copy is quiet, from its loudness in short windows. A line's edges
// land in these spans, so its first breath and its last word's decay stay whole; an edge outside one cuts into sound.

/** The window the loudness is measured over, in seconds: fine enough to place an edge, coarse enough to skip a waveform's zero crossings. */
export const LIBRARY_QUIET_WINDOW = 0.01;
// Quiet stretches shorter than this are the gaps between syllables, not places to cut.
const QUIET_MIN_SECONDS = 0.04;
const BLIP_MAX_SECONDS = 0.03;
// Under this is quiet however the track's floor sits: a call's digital silence puts its floor at -120 dBFS, where the
// relative rule would call a faint tail of reverb sound.
const QUIET_ANYWAY_DB = -55;
// This far under speech is a pause to the ear, however far above a denoised floor it sits.
const QUIET_UNDER_SPEECH_DB = 24;

/**
 * The quiet spans, [start, end] seconds, of a track measured as `levels` (dBFS per LIBRARY_QUIET_WINDOW). Quiet is
 * under any of: QUIET_ANYWAY_DB; QUIET_UNDER_SPEECH_DB under its speech (90th percentile); a quarter of the way from
 * its floor (10th) to its speech, and at least 6 dB over the floor. So noisy and denoised floors read decays alike.
 */
export function libraryQuietSpans(levels: readonly number[]): [number, number][] {
  if (!levels.length) return [];
  const sorted = levels.toSorted((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)], speech = sorted[Math.floor(sorted.length * 0.9)];
  const threshold = Math.max(QUIET_ANYWAY_DB, speech - QUIET_UNDER_SPEECH_DB, floor + Math.max(6, (speech - floor) / 4));
  // Runs of quiet windows, joined across a blip too short to be speech (a click, a lip smack), kept if long enough.
  const runs: [number, number][] = [];
  levels.forEach((db, k) => {
    if (db >= threshold) return;
    const last = runs.at(-1);
    if (last && (k - last[1]) * LIBRARY_QUIET_WINDOW <= BLIP_MAX_SECONDS) last[1] = k + 1;
    else runs.push([k, k + 1]);
  });
  return runs.filter(([a, b]) => (b - a) * LIBRARY_QUIET_WINDOW >= QUIET_MIN_SECONDS)
    .map(([a, b]): [number, number] => [round(a * LIBRARY_QUIET_WINDOW), round(b * LIBRARY_QUIET_WINDOW)]);
}

const round = (seconds: number) => Math.round(seconds * 100) / 100;

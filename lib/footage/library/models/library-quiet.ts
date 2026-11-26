// library-quiet.ts: what a spoken track's levelled copy holds between its words, from its loudness in short windows:
// where it's quiet, which a line's edges and inner cuts land in; its soft sounds (breaths), which a line turns down;
// and its clicks (a lip smack in a pause), which a line takes out.

/** The window the loudness is measured over, in seconds: fine enough to place an edge, coarse enough to skip a waveform's zero crossings. */
export const LIBRARY_QUIET_WINDOW = 0.01;
// Quiet stretches shorter than this are the gaps between syllables, not places to cut.
const QUIET_MIN_SECONDS = 0.04;
const BLIP_MAX_SECONDS = 0.03;
// Quiet a click has on each side, in windows.
const CLICK_CLEAR_WINDOWS = 3;
// Under this is quiet however the track's floor sits: a call's digital silence puts its floor at -120 dBFS, where the
// relative rule would call a faint tail of reverb sound.
const QUIET_ANYWAY_DB = -55;
// This far under speech is a pause to the ear, however far above a denoised floor it sits.
const QUIET_UNDER_SPEECH_DB = 24;
// A sound between two quiet spans that never comes within this of speech, and lasts this long, is a breath: a word's
// quiet consonant runs on into its vowel, so it's never a sound of its own.
const SOFT_UNDER_SPEECH_DB = 15;
const SOFT_MIN_SECONDS = 0.1;

/** [start, end] seconds of a levelled copy. */
export type LibrarySpan = [number, number];

/** What a levelled copy holds between its words (librarySoundSpans). */
export type LibrarySoundSpans = { quiet: LibrarySpan[]; soft: LibrarySpan[]; clicks: LibrarySpan[] };

/**
 * The quiet, soft and click spans of a track measured as `levels` (dBFS per LIBRARY_QUIET_WINDOW). Quiet is under any
 * of: QUIET_ANYWAY_DB; QUIET_UNDER_SPEECH_DB under its speech (90th percentile); a quarter of the way from its floor
 * (10th) to its speech, and at least 6 dB over the floor. So noisy and denoised floors read decays alike.
 */
export function librarySoundSpans(levels: readonly number[]): LibrarySoundSpans {
  if (!levels.length) return { quiet: [], soft: [], clicks: [] };
  const sorted = levels.toSorted((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)], speech = sorted[Math.floor(sorted.length * 0.9)];
  const threshold = Math.max(QUIET_ANYWAY_DB, speech - QUIET_UNDER_SPEECH_DB, floor + Math.max(6, (speech - floor) / 4));
  // Runs of quiet windows, joined across a blip too short to be speech (a click, a lip smack), kept if long enough.
  const runs: { from: number; to: number; blips: [number, number][] }[] = [];
  levels.forEach((db, k) => {
    if (db >= threshold) return;
    const last = runs.at(-1);
    if (last && (k - last.to) * LIBRARY_QUIET_WINDOW <= BLIP_MAX_SECONDS) {
      if (k > last.to) last.blips.push([last.to, k]);
      last.to = k + 1;
    } else runs.push({ from: k, to: k + 1, blips: [] });
  });
  const quiet = runs.filter((r) => (r.to - r.from) * LIBRARY_QUIET_WINDOW >= QUIET_MIN_SECONDS);
  const soft = quiet.slice(1).flatMap(({ from: to }, i) => {
    const from = quiet[i].to;
    const loudest = Math.max(...levels.slice(from, to));
    return (to - from) * LIBRARY_QUIET_WINDOW >= SOFT_MIN_SECONDS && loudest < speech - SOFT_UNDER_SPEECH_DB ? [seconds([from, to])] : [];
  });
  // A click stands alone in its quiet: blips in a row are a consonant's release or a rattle, not a lip smack.
  const clicks = quiet.flatMap(({ from, to, blips }) => blips.filter(([a, b], i) =>
    a - (blips[i - 1]?.[1] ?? from) >= CLICK_CLEAR_WINDOWS && (blips[i + 1]?.[0] ?? to) - b >= CLICK_CLEAR_WINDOWS));
  return { quiet: quiet.map((r) => seconds([r.from, r.to])), soft, clicks: clicks.map(seconds) };
}

const seconds = ([a, b]: [number, number]): LibrarySpan => [round(a * LIBRARY_QUIET_WINDOW), round(b * LIBRARY_QUIET_WINDOW)];
const round = (s: number) => Math.round(s * 100) / 100;

// transcript-audio.ts: where a file's audio is quiet, read from its samples, and what that decides: the pieces whisper
// hears one at a time, the pauses a transcript keeps, and where its words' edges fall. Pure.
//
// Quiet is relative to the file's own floor, so room noise in a recording isn't read as speech.
import type { SpokenWord } from './spoken-word.ts';

/** Seconds per level frame. */
export const AUDIO_LEVEL_FRAME = 0.01;
// About −27 dBFS: above this nothing counts as quiet, however loud the file's floor.
const QUIET_CEILING = 1500;
// About −64 dBFS: below this everything is quiet, so a digitally silent or gated stretch is never read as speech.
const QUIET_FLOOR = 20;

/** RMS of each 10 ms frame, in 16-bit sample units. The last frame may be shorter. */
export function audioFrameLevels(samples: Int16Array, rate: number): number[] {
  const step = Math.round(rate * AUDIO_LEVEL_FRAME), levels: number[] = [];
  for (let at = 0; at < samples.length; at += step) {
    const end = Math.min(samples.length, at + step);
    let sum = 0;
    for (let k = at; k < end; k++) sum += samples[k] * samples[k];
    levels.push(Math.sqrt(sum / (end - at)));
  }
  return levels;
}

/**
 * The level below which a frame is quiet: twice the 10th-percentile frame, which audio with any pauses in it reaches,
 * and at least 300 (about −40 dBFS) unless its speech is quiet: a raw mic recording's 95th-percentile frame can sit
 * near 500, so that minimum drops to a sixth of it, though never below QUIET_FLOOR.
 */
export function quietAudioLevel(levels: readonly number[]): number {
  const sorted = levels.toSorted((a, b) => a - b), at = (p: number) => sorted[Math.floor(sorted.length * p)] ?? 0;
  return Math.min(QUIET_CEILING, Math.max(QUIET_FLOOR, Math.min(300, at(0.95) / 6), 2 * at(0.1)));
}

/** A run of quiet frames: its first frame and how many. */
export type QuietRun = { from: number; frames: number };

/** The runs of quiet frames in `[first, last]`, in order. */
export function quietRuns(levels: readonly number[], quiet: number, first = 0, last = levels.length - 1): QuietRun[] {
  const runs: QuietRun[] = [];
  for (let f = Math.max(0, first); f <= Math.min(last, levels.length - 1); f++) {
    if (levels[f] >= quiet) continue;
    const run = runs.at(-1);
    if (run && run.from + run.frames === f) run.frames++;
    else runs.push({ from: f, frames: 1 });
  }
  return runs;
}

/** A stretch of a file's audio, in seconds. */
export type AudioSpan = { start: number; end: number };

// Whisper hears 30 s at a time; a piece inside one window is decoded whole, so its words can't slide between windows.
const MAX_PIECE = 25;
// A pause this long ends a piece once it's MIN_PIECE long. Whisper's times slide most across long pauses, and a retake
// usually follows one, which whisper hearing in the same piece may fold into the first. Longer pieces, split only at
// pauses past 6 s, gave whisper more context but no better spelling, and words up to 3 s off.
const PIECE_PAUSE = 0.5;
const MIN_PIECE = 1;
// Whisper mistimes words beside quiet, so it hears each piece with every quiet run, its ends included, cut to this much
// at most: half kept beside the speech before it, half beside the speech after. Heard whole, the words beside quiet
// landed up to 3 s off, and whisper missed a few.
const HEARD_PAUSE = 0.3;
// A piece keeps this much quiet after its last word: with less, whisper times its last words past its end.
const HEARD_TAIL = 0.6;
// A piece with less speech than this is quiet, and not worth whisper's time.
const MIN_PIECE_SPEECH = 0.15;

/**
 * A piece of a file whisper hears on its own: the spans of the file it keeps, in order, heard back to back. What's
 * left out between them is quiet.
 */
export type TranscriptPiece = { kept: AudioSpan[] };

/**
 * Where to split a file for whisper: each piece at most MAX_PIECE long, ending at the first long pause past MIN_PIECE,
 * else the longest pause it can reach, else its quietest frame, so no word is cut. Each keeps its speech and little of
 * its quiet (heardPiece); pieces with no speech are left out.
 */
export function planTranscriptPieces(levels: readonly number[], quiet: number): TranscriptPiece[] {
  const frames = Math.round(1 / AUDIO_LEVEL_FRAME);
  const splits = [0];
  for (;;) {
    const from = splits.at(-1)!, first = from + MIN_PIECE * frames, last = Math.min(levels.length, from + MAX_PIECE * frames) - 1;
    // A quiet run reaching the file's end splits nothing off.
    const runs = quietRuns(levels, quiet, first, last).filter((run) => run.from + run.frames < levels.length);
    const long = runs.find((run) => run.frames >= PIECE_PAUSE * frames);
    if (!long && levels.length - from <= MAX_PIECE * frames) break;
    const chosen = long ?? runs.reduce<QuietRun | null>((best, run) => (!best || run.frames > best.frames ? run : best), null);
    if (chosen) {
      splits.push(chosen.from + Math.floor(chosen.frames / 2));
      continue;
    }
    let lowest = first;
    for (let f = first; f <= last; f++) if (levels[f] < levels[lowest]) lowest = f;
    splits.push(lowest);
  }
  splits.push(levels.length);
  const pieces: TranscriptPiece[] = [];
  for (let i = 1; i < splits.length; i++) {
    const piece = heardPiece(levels, quiet, splits[i - 1], splits[i]);
    if (piece) pieces.push(piece);
  }
  return pieces;
}

/** Frames `[from, to)` as whisper should hear them, or null when they hold too little speech. */
function heardPiece(levels: readonly number[], quiet: number, from: number, to: number): TranscriptPiece | null {
  const half = Math.round(HEARD_PAUSE / 2 / AUDIO_LEVEL_FRAME), tail = Math.round(HEARD_TAIL / AUDIO_LEVEL_FRAME);
  let speech = 0;
  for (let f = from; f < to; f++) if (levels[f] >= quiet) speech++;
  if (speech * AUDIO_LEVEL_FRAME < MIN_PIECE_SPEECH) return null;
  // Each quiet run longer than HEARD_PAUSE loses its middle; a run at either end keeps only what's beside speech.
  const kept: [number, number][] = [[from, to]];
  for (const run of quietRuns(levels, quiet, from, to - 1)) {
    const end = run.from + run.frames;
    const atStart = run.from === from, atEnd = end === to;
    let keepBefore = atEnd ? tail : half;
    if (atStart) keepBefore = 0;
    const keepAfter = atEnd ? 0 : half;
    if (run.frames <= keepBefore + keepAfter) continue;
    const last = kept.pop()!;
    if (run.from + keepBefore > last[0]) kept.push([last[0], run.from + keepBefore]);
    if (end - keepAfter < last[1]) kept.push([end - keepAfter, last[1]]);
  }
  return { kept: kept.map(([a, b]) => ({ start: a * AUDIO_LEVEL_FRAME, end: b * AUDIO_LEVEL_FRAME })) };
}

/** Where a moment `at` seconds into what whisper heard of `piece` falls in the file. */
export function fileTimeInPiece({ kept }: TranscriptPiece, at: number): number {
  let heard = 0;
  for (const span of kept) {
    const length = span.end - span.start;
    if (at <= heard + length) return span.start + Math.max(0, at - heard);
    heard += length;
  }
  return kept.at(-1)!.end;
}

// Shorter quiet is a stop inside a word, not a pause a cut can sit in.
const MIN_PAUSE_FRAMES = 4;

const toMs = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** Every pause in the audio at least 40 ms long, in order, in seconds. */
export function audioPauses(levels: readonly number[], quiet: number): AudioSpan[] {
  return quietRuns(levels, quiet).filter((run) => run.frames >= MIN_PAUSE_FRAMES)
    .map((run) => ({ start: toMs(run.from * AUDIO_LEVEL_FRAME), end: toMs((run.from + run.frames) * AUDIO_LEVEL_FRAME) }));
}

/** A word whisper heard, and when: a moment inside it, by whisper's DTW alignment, in seconds into the file. */
export type HeardWord = { text: string; at: number };

// Quiet this short between two words may be a stop consonant inside one, so it doesn't bound a word.
const WORD_GAP = 0.1;
// Whisper's DTW time falls late in a word (0.2 s after it starts, under 0.1 s before it ends), so two words with no
// quiet between them meet this far from one's time to the next's: within 10 ms of short pauses (median) on a TTS take
// and a raw mic recording, where halfway was 30–50 ms late.
const WORD_MEETING = 0.3;

/**
 * When each heard word starts and ends. Whisper's DTW times say where a word sits, not where it starts, so the audio
 * decides its edges: quiet whose middle lies between two words' times bounds both, and two words with no quiet between
 * them meet WORD_MEETING of the way from one time to the next.
 */
export function wordsTimedAtPauses(heard: readonly HeardWord[], pauses: readonly AudioSpan[], duration: number): SpokenWord[] {
  const gaps = pauses.filter((p) => p.end - p.start >= WORD_GAP);
  // DTW times can step back a little; a word never sits before the one heard before it.
  const at: number[] = [];
  for (const word of heard) at.push(Math.max(word.at, at.at(-1) ?? 0));
  // The span of the quiet centred between two times: a word's time can land in the quiet beside it.
  const between = (from: number, to: number) => {
    const inside = gaps.filter((p) => (p.start + p.end) / 2 >= from && (p.start + p.end) / 2 < to);
    return inside.length ? { start: inside[0].start, end: inside.at(-1)!.end } : null;
  };
  const edges = at.slice(1).map((next, i) => {
    const meeting = at[i] + WORD_MEETING * (next - at[i]);
    return between(at[i], next) ?? { start: meeting, end: meeting };
  });
  const first = between(0, at[0] ?? 0), last = between(at.at(-1) ?? duration, duration);
  return heard.map((word, i) => ({
    text: word.text,
    start: toMs(i === 0 ? (first?.end ?? 0) : edges[i - 1].end),
    end: toMs(i === heard.length - 1 ? (last?.start ?? duration) : edges[i].start),
  }));
}

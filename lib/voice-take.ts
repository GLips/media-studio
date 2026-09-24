// voice-take.ts: where to cut one continuous read of a script (a take) into its lines. Pure; scripts/tts.ts does the IO.
//
// A take reads as one performance: pace, pitch and breath carry from line to line, which separate reads never do.
// Whisper's word times over a whole take drift by up to half a second, so they only say roughly where each line is;
// the cuts go in the longest quiet stretches around the boundaries, found in the audio and chosen together, so short
// lines ("filter, / search, / and…") each keep their own speech. Each clip keeps a breath
// of quiet at either end, and the quiet trimmed off between two lines comes back as `pauseBefore`, so the timeline
// can replay the read's timing.
import { alignSpokenWords, scriptWords, type SpokenWord } from './voice-words.ts';

// What each clip keeps of the quiet around its words: a breath before, and a little longer after so it doesn't end
// clipped.
const LEAD_IN = 0.06;
const TAIL = 0.15;
// How far past whisper's words the search for a cut reaches, beyond its drift.
const CUT_REACH = 0.2;
const FRAME = 0.01;
// A second pause at least this long relative to the longest makes the cut a guess: a stop inside a word can look like
// the pause between lines.
const AMBIGUOUS_PAUSE = 0.6;
// About −27 dBFS: above this nothing counts as quiet, however loud the take's floor.
const QUIET_CEILING = 1500;
// Every clip holds at least this much speech, so two cuts can't share one pause.
const MIN_SPEECH_FRAMES = 8;

export type TakeLine = { id: string; text: string };
export type TakeClip = {
  id: string;
  /** Where the clip sits in the take, in seconds. */
  from: number;
  to: number;
  /** Seconds of the take between the previous line's clip and this one; null for the first line. */
  pauseBefore: number | null;
  /** False when the cut before this line isn't in one clear pause (none, or two alike), so it may clip a word. */
  cutIsClear: boolean;
  /** Seconds of quiet the cut before this line sits in; under about 0.08 the two lines were read as one phrase. */
  cutPause: number;
};

export function cutTakeIntoLines(lines: readonly TakeLine[], heard: readonly SpokenWord[], samples: Int16Array, rate: number): TakeClip[] {
  const duration = samples.length / rate;
  const aligned = alignSpokenWords(lines.map((line) => line.text).join(' '), heard, duration);
  let next = 0;
  const spans = lines.map((line) => {
    const count = scriptWords(line.text).length;
    const words = aligned.words.slice(next, next + count), wasHeard = aligned.heard.slice(next, next + count);
    next += count;
    const hits = words.filter((_, k) => wasHeard[k]);
    // A line with nothing heard has no anchor for its cuts; guessing would hand its words to its neighbours.
    if (!hits.length) throw new Error(`line "${line.id}" wasn't heard in the take`);
    return { first: hits[0], last: hits.at(-1)! };
  });

  const levels = frameLevels(samples, rate);
  const quiet = quietLevel(levels);
  // Between the start of one line's last word and the end of the next line's first: whichever way whisper drifted,
  // the pause between them is inside.
  const windows = spans.slice(1).map((span, i) => [spans[i].last.start, span.first.end] as const);
  const cuts = [{ at: 0, clear: true, pause: 0 }, ...chooseCuts(levels, quiet, windows, lines), { at: duration, clear: true, pause: 0 }];

  const round = (x: number) => Math.round(x * 1000) / 1000;
  const clips: TakeClip[] = [];
  lines.forEach((line, i) => {
    const { from, to } = trimToVoice(levels, quiet, cuts[i].at, cuts[i + 1].at, duration);
    const before = clips.at(-1);
    clips.push({ id: line.id, from: round(from), to: round(to), pauseBefore: before ? round(from - before.to) : null, cutIsClear: cuts[i].clear, cutPause: round(cuts[i].pause) });
  });
  return clips;
}

/** RMS of each 10 ms frame, in 16-bit sample units. The last frame may be shorter. */
function frameLevels(samples: Int16Array, rate: number) {
  const step = Math.round(rate * FRAME), levels: number[] = [];
  for (let at = 0; at < samples.length; at += step) {
    const end = Math.min(samples.length, at + step);
    let sum = 0;
    for (let k = at; k < end; k++) sum += samples[k] * samples[k];
    levels.push(Math.sqrt(sum / (end - at)));
  }
  return levels;
}

// Quiet is relative to the take's own floor, so room noise in a recording isn't read as speech. The floor is the
// 10th-percentile frame, which a take with any pauses in it reaches; 300 (about −40 dBFS) covers a digitally silent one.
function quietLevel(levels: number[]) {
  const sorted = [...levels].sort((a, b) => a - b);
  return Math.min(QUIET_CEILING, Math.max(300, 2 * (sorted[Math.floor(sorted.length * 0.1)] ?? 0)));
}

type Pause = { from: number; frames: number };

/**
 * One cut per window, in order, each in a pause (or, with none, the window's quietest frame), with speech between
 * every two. Of the orders that allow, the one with the longest pauses in total wins. A cut is clear when it took its
 * window's longest pause and no other came close.
 */
function chooseCuts(levels: number[], quiet: number, windows: readonly (readonly [number, number])[], lines: readonly TakeLine[]) {
  const speechBefore = [0];
  for (const level of levels) speechBefore.push(speechBefore.at(-1)! + (level >= quiet ? 1 : 0));
  const hasSpeech = (fromFrame: number, toFrame: number) => toFrame > fromFrame && speechBefore[toFrame] - speechBefore[fromFrame] >= MIN_SPEECH_FRAMES;
  const endOf = (p: Pause) => p.from + Math.max(1, p.frames);

  const options = windows.map(([a, b]) => {
    const first = Math.max(0, Math.floor((Math.min(a, b) - CUT_REACH) / FRAME));
    const last = Math.min(levels.length - 1, Math.ceil((Math.max(a, b) + CUT_REACH) / FRAME));
    const runs: Pause[] = [];
    for (let f = first; f <= last; f++) {
      if (levels[f] >= quiet) continue;
      const run = runs.at(-1);
      if (run && run.from + run.frames === f) run.frames++;
      else runs.push({ from: f, frames: 1 });
    }
    let lowest = first;
    for (let f = first; f <= last; f++) if (levels[f] < levels[lowest]) lowest = f;
    const longest = [...runs].sort((x, y) => y.frames - x.frames);
    const clearRun = longest[0] && (!longest[1] || longest[1].frames < AMBIGUOUS_PAUSE * longest[0].frames) ? longest[0] : null;
    return { pauses: [...runs, { from: lowest, frames: 0 }], clearRun };
  });

  // best[i][k]: the longest total pause for cuts 0..i with cut i at option k; from[i][k] is cut i−1's option.
  const best: number[][] = [], from: number[][] = [];
  options.forEach(({ pauses }, i) => {
    best.push(pauses.map(() => -Infinity));
    from.push(pauses.map(() => -1));
    pauses.forEach((p, k) => {
      if (i === 0) {
        if (hasSpeech(0, p.from)) best[0][k] = p.frames;
        return;
      }
      options[i - 1].pauses.forEach((q, j) => {
        const score = best[i - 1][j] + p.frames;
        if (score > best[i][k] && hasSpeech(endOf(q), p.from)) [best[i][k], from[i][k]] = [score, j];
      });
    });
  });
  const lastCut = options.length - 1;
  let k = -1;
  options[lastCut]?.pauses.forEach((p, j) => {
    if (best[lastCut][j] > (k < 0 ? -Infinity : best[lastCut][k]) && hasSpeech(endOf(p), levels.length)) k = j;
  });
  if (options.length && k < 0) throw new Error(`the take's pauses can't be cut into its ${lines.length} lines: listen for a skipped line`);

  const picked: { at: number; clear: boolean; pause: number }[] = [];
  for (let i = lastCut; i >= 0; i--) {
    const p = options[i].pauses[k];
    picked.unshift({ at: (p.from + Math.max(1, p.frames) / 2) * FRAME, clear: p === options[i].clearRun, pause: p.frames * FRAME });
    k = from[i][k];
  }
  return picked;
}

function trimToVoice(levels: number[], quiet: number, from: number, to: number, duration: number) {
  let first = -1, last = -1;
  for (let f = Math.floor(from / FRAME); f < Math.min(levels.length, Math.ceil(to / FRAME)); f++) {
    if (levels[f] < quiet) continue;
    if (first < 0) first = f;
    last = f;
  }
  if (first < 0) return { from, to };
  return { from: Math.max(from, first * FRAME - LEAD_IN), to: Math.min(to, duration, (last + 1) * FRAME + TAIL) };
}

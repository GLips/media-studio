// caption-pages.ts: a caption track cut into pages, the text on screen at once, and what's showing at an instant.
// A style pages with its own rule; the .srt and .vtt page the same track with the video's sidecar rule, through the
// same code, so the burned-in captions and the sidecar never disagree about a word's time.
//
// A page never runs across a paragraph or a pause, and never holds one word alone: a lone word joins its neighbours
// rather than flash on and off. Short pauses between pages are held over, so a line split for pacing ("filter, /
// search, / and…") reads as one caption changing, not one blinking.

import type { CaptionTrack, CaptionWord } from './caption-track.ts';

/** How a style pages a track. Seconds are video seconds. */
export type CaptionPagingRule = {
  /** Characters on a line, a keycap counting two more than its key; used where no measure is given. */
  maxChars: number;
  maxLines: number;
  /** The longest a page may run, from its first word's start to its last's end. */
  maxSeconds: number;
  /** A silence at least this long between two words ends a page. */
  pauseBreak: number;
  /** A gap this short or shorter between two pages is held: the first stays up until the next. */
  holdGap: number;
  /** How early a page shows before its first word, and how long it stays after its last. */
  leadIn: number;
  hang: number;
};

/** Subtitles anyone can read: the house pill's rule and the default for a sidecar. */
export const READABLE_CAPTION_RULE: CaptionPagingRule = { maxChars: 48, maxLines: 2, maxSeconds: 6, pauseBreak: 0.5, holdGap: 1, leadIn: 0.05, hang: 0.15 };

/** How wide a line of words sets in the style's own type, against the widest it may be (same units). */
export type CaptionMeasure = { lineWidth(words: readonly CaptionWord[]): number; maxWidth: number };

/** Text on screen at once, from `start` to `end`, in lines. */
export type CaptionPage = { start: number; end: number; lines: readonly (readonly CaptionWord[])[] };

const charsOf = (words: readonly CaptionWord[]) => words.reduce((n, w) => n + w.text.length + w.trail.length + (w.key ? 2 : 0), 0) + words.length - 1;

export function pageCaptions(track: CaptionTrack, rule: CaptionPagingRule, measure?: CaptionMeasure): CaptionPage[] {
  const fitsLine = (words: readonly CaptionWord[]) => (measure ? measure.lineWidth(words) <= measure.maxWidth : charsOf(words) <= rule.maxChars);
  const linesOf = (words: readonly CaptionWord[]) => {
    const lines: CaptionWord[][] = [];
    for (const word of words) {
      const line = lines.at(-1);
      if (line && fitsLine([...line, word])) line.push(word);
      else lines.push([word]);
    }
    return lines;
  };
  const fitsPage = (words: readonly CaptionWord[]) => linesOf(words).length <= rule.maxLines && words.at(-1)!.end - words[0].start <= rule.maxSeconds;

  // Runs: the words between paragraphs and pauses, which no page crosses. A pause that would leave a word alone is
  // no break.
  const runs: CaptionWord[][] = [];
  for (const phrase of track) {
    phrase.words.forEach((word, k) => {
      const run = runs.at(-1), last = run?.at(-1);
      const hard = k === 0 && phrase.paragraph;
      const pause = !!last && word.start - last.end >= rule.pauseBreak && run!.length > 1;
      if (!run || hard || pause) runs.push([word]);
      else run.push(word);
    });
  }
  for (let k = runs.length - 1; k > 0; k--) {
    const [run, before] = [runs[k], runs[k - 1]];
    if (run.length === 1 && !track.some((p) => p.paragraph && p.words[0] === run[0])) runs.splice(k - 1, 2, [...before, ...run]);
  }

  const pages = runs.flatMap((run) => {
    const out: CaptionWord[][] = [];
    let page: CaptionWord[] = [];
    for (const word of run) {
      if (!page.length || fitsPage([...page, word])) {
        page.push(word);
        continue;
      }
      // End the page after its last sentence or clause, if that's in its second half, so a page reads as a thought.
      const stop = page.findLastIndex((w, j) => j < page.length - 1 && j >= page.length / 2 - 1 && /[.,;:?!…—]$/.test(w.text + w.trail));
      const carried = stop >= 0 ? page.slice(stop + 1) : [];
      if (carried.length && fitsPage([...carried, word])) {
        out.push(page.slice(0, stop + 1));
        page = [...carried, word];
      } else {
        out.push(page);
        page = [word];
      }
    }
    out.push(page);
    // A lone last word takes one from the page before, or joins it, where the rule allows; a word that can't do
    // either (too long to share a line) stands alone.
    const [lone, before] = [out.at(-1)!, out.at(-2)];
    if (lone.length === 1 && before) {
      if (before.length >= 3 && fitsPage([before.at(-1)!, ...lone])) lone.unshift(before.pop()!);
      else if (fitsPage([...before, ...lone])) out.splice(-2, 2, [...before, ...lone]);
    }
    return out;
  });

  const shown = pages.map((words) => ({ start: Math.max(0, words[0].start - rule.leadIn), end: words.at(-1)!.end + rule.hang, lines: linesOf(words) }));
  shown.forEach((page, k) => {
    const next = shown[k + 1];
    if (next && next.start - page.end <= rule.holdGap) page.end = next.start;
  });
  return shown;
}

/**
 * What a caption shows at `t`: its page, and which word of it is being spoken (counted through its lines; −1 before
 * the first). `held` says whether the pages before and after meet it end to end, so a style swaps them without a fade.
 */
export type CaptionState = { page: CaptionPage; word: number; held: { before: boolean; after: boolean } };

export function captionStateAt(pages: readonly CaptionPage[], t: number): CaptionState | null {
  const k = pages.findIndex((p) => t >= p.start && t < p.end);
  if (k < 0) return null;
  const page = pages[k];
  const word = page.lines.flat().findLastIndex((w) => w.start <= t);
  return { page, word, held: { before: pages[k - 1]?.end === page.start, after: pages[k + 1]?.start === page.end } };
}

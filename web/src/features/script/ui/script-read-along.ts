// script-read-along.ts: the script on the take's clock. The read-along plays the take through the review's playback
// store, which counts frames, so each line and word is turned into frames once here; the store's rAF then drives the
// highlight with no per-frame React work.
import type { ReviewTiming } from '#lib/output/review/models/review-moment.ts';
import { reviewTimingOf } from '#lib/output/review/models/review-moment.ts';
import { reviewScriptLineWords, type ReviewScriptLine } from '#lib/output/review/models/review-script.ts';
import { REVIEW_THREAD_TONES, reviewThreadTone, type ReviewAnchor, type ReviewThread, type ReviewThreadTone } from '#lib/output/review/models/review-threads.ts';

/**
 * The take's clock rate. A take has no frames of its own; 60 a second keeps the word sweep smooth on a short word
 * and the dock's frame numbers ordinary.
 */
export const SCRIPT_READ_ALONG_FPS = 60;

/** A voiced line on the clock: its span and each word's, `to` exclusive. */
export type ScriptTimedLine = { from: number; to: number; words: readonly { from: number; to: number }[] };

const frameOf = (seconds: number) => Math.floor(seconds * SCRIPT_READ_ALONG_FPS);

/** Each line's frames, null for a line the take doesn't voice. */
export function scriptTimedLinesOf(lines: readonly ReviewScriptLine[]): (ScriptTimedLine | null)[] {
  return lines.map(({ start, end, words }) => (start === undefined || end === undefined || !words
    ? null
    : { from: frameOf(start), to: frameOf(end), words: words.map((w) => ({ from: frameOf(w.start), to: Math.max(frameOf(w.end), frameOf(w.start) + 1) })) }));
}

/** The line being read at `frame`, or the last one read in the pause after it; -1 before the first. */
export function scriptLineIndexAt(timed: readonly (ScriptTimedLine | null)[], frame: number): number {
  return timed.findLastIndex((line) => line !== null && line.from <= frame);
}

/** The script as the dock's voice lane reads a render's lines: no scenes, the lines on the take. */
export function scriptTimingOf(lines: readonly ReviewScriptLine[]): ReviewTiming {
  const voiced = lines.flatMap(({ id, start, end, words }) => (start === undefined || end === undefined || !words ? [] : [{ id, start, end, words }]));
  return reviewTimingOf({ fps: SCRIPT_READ_ALONG_FPS, startsAt: 0, scenes: [], lines: voiced, clock: null });
}

/** A run of a line's words, both ends inclusive, as a script note anchors them. */
export type ScriptWordRun = { line: string; word: number; wordEnd: number };

/**
 * The words the reader has selected, when the selection lies within one line of `root`; null for none, or one that
 * spans lines (`N` then notes the line in focus).
 */
export function scriptSelectionIn(root: HTMLElement): ScriptWordRun | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return null;
  const a = wordAt(selection.anchorNode), b = wordAt(selection.focusNode);
  if (!a || !b || !root.contains(a)) return null;
  const line = a.closest<HTMLElement>('[data-line]')?.dataset.line;
  if (line === undefined || b.closest<HTMLElement>('[data-line]')?.dataset.line !== line) return null;
  const [x, y] = [Number(a.dataset.word), Number(b.dataset.word)];
  return { line, word: Math.min(x, y), wordEnd: Math.max(x, y) };
}

const wordAt = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[data-word]');

/** A new script note's anchor: on a run of words, or on the whole line when `run` has none. */
export function scriptNoteAnchorOf(line: ReviewScriptLine, run: ScriptWordRun | null, scriptHash: string, take: string): Extract<ReviewAnchor, { on: 'script' }> {
  const base = { on: 'script' as const, scriptHash, line: line.id, take };
  if (!run) return base;
  const text = reviewScriptLineWords(line).slice(run.word, run.wordEnd + 1).map((w) => w.text).join(' ');
  return { ...base, word: run.word, ...(run.wordEnd > run.word && { wordEnd: run.wordEnd }), text };
}

/**
 * Where a script note is, as the reader counts: `5`, or `5 · ‘Snap the menu’` for one on words. The line's number,
 * not its voiceover.json id, which the page never shows.
 */
export function scriptNotePlaceOf(lines: readonly ReviewScriptLine[], anchor: Extract<ReviewAnchor, { on: 'script' }>): string {
  const index = lines.findIndex((l) => l.id === anchor.line);
  const line = index < 0 ? anchor.line : String(index + 1);
  return anchor.text ? `${line} · ‘${anchor.text}’` : line;
}

/** How a thread's state reads beside its line: its glyph, and the colour role it takes. */
export type ScriptThreadMark = { glyph: string; tone: 'accent' | 'pass' | 'caution' | 'dim' };

const SCRIPT_THREAD_COLOURS: Readonly<Record<ReviewThreadTone, ScriptThreadMark['tone']>> = {
  open: 'accent', addressed: 'pass', asks: 'caution', keep: 'dim', resolved: 'dim',
};

export function scriptThreadMarkOf(thread: Pick<ReviewThread, 'kind' | 'state' | 'entries'>): ScriptThreadMark {
  const tone = reviewThreadTone(thread);
  return { glyph: REVIEW_THREAD_TONES[tone].glyph, tone: SCRIPT_THREAD_COLOURS[tone] };
}

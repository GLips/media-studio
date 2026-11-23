// footage-transcript.ts: a file's transcript, and where to cut it between two words. Pure, so a cut is found from the
// transcript alone, with the footage's media offline.
//
// The transcript keeps every utterance in the order spoken, retakes included: "each agent has a definition" said
// twice is two runs of its words.
import { Schema } from 'effect';
import { AudioSpan } from './transcript-audio.ts';
import { SpokenWord } from './spoken-word.ts';

/**
 * What's said in a file and when: its `duration` and its `words` in seconds from its start, and its `pauses`, every
 * quiet stretch of at least 40 ms, so a cut can be placed without the audio.
 */
export const FootageTranscript = Schema.Struct({ duration: Schema.Number, words: Schema.Array(SpokenWord), pauses: Schema.Array(AudioSpan) });
// A type alias for the reason SpokenWord is one.
export type FootageTranscript = typeof FootageTranscript.Type;

// How far a word's edge may be off from its sound: at 85% of pauses a transcript's edges land within 0.1 s of them.
const WORD_TIME_SLACK = 0.1;

/**
 * The quiet before `wordIndex`'s word, to cut anywhere in: the longest pause between it and the word before (with
 * `wordIndex` = words.length, after the last word). Zero length, midway between the two, when they run together.
 */
export function transcriptCutBefore({ duration, words, pauses }: FootageTranscript, wordIndex: number): AudioSpan {
  const before = words[wordIndex - 1], after = words[wordIndex];
  const from = before ? before.end - WORD_TIME_SLACK : 0, to = after ? after.start + WORD_TIME_SLACK : duration;
  const pause = pauses.filter((p) => p.end > from && p.start < to)
    .reduce<AudioSpan | null>((best, p) => (!best || p.end - p.start > best.end - best.start ? p : best), null);
  if (pause) return pause;
  const at = ((before?.end ?? 0) + (after?.start ?? duration)) / 2;
  return { start: at, end: at };
}

// Quiet this long between two words ends a line of the transcript as read.
const LINE_PAUSE = 0.5;

/** A line of a transcript as read: its span, its words' text, and which of the transcript's words it holds. */
export type TranscriptLine = { start: number; end: number; text: string; firstWord: number; wordCount: number };

/** The transcript as lines to read: its words run together until a pause of LINE_PAUSE, each line with its span. */
export function transcriptLines({ words }: Pick<FootageTranscript, 'words'>): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  words.forEach((word, i) => {
    const line = lines.at(-1);
    if (line && word.start - line.end < LINE_PAUSE) Object.assign(line, { end: word.end, text: `${line.text} ${word.text}`, wordCount: line.wordCount + 1 });
    else lines.push({ start: word.start, end: word.end, text: word.text, firstWord: i, wordCount: 1 });
  });
  return lines;
}

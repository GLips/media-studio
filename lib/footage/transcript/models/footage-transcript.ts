// footage-transcript.ts: a file's transcript, and its lines as read. Pure, so a cut is found from the transcript
// alone, with the footage's media offline (libraryFootage's speech places a line's edges in its pauses).
//
// The transcript keeps every utterance in the order spoken, retakes included: "each agent has a definition" said
// twice is two runs of its words.
import { Schema } from 'effect';
import { AudioSpan } from './transcript-audio.ts';
import { SpokenWord } from './spoken-word.ts';

/**
 * What's said in a file and when, in seconds from its start: its `words`; its `pauses`, every quiet stretch of at
 * least 40 ms, so a cut is placed without the audio; its `unheard` speech (unheardSpeech), which a cut keeps clear of.
 */
export const FootageTranscript = Schema.Struct({
  duration: Schema.Number, words: Schema.Array(SpokenWord), pauses: Schema.Array(AudioSpan), unheard: Schema.Array(AudioSpan),
});
// A type alias for the reason SpokenWord is one.
export type FootageTranscript = typeof FootageTranscript.Type;

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

// whisper-heard-words.ts: what whisper.cpp's full JSON (-ojf) says it heard, and the words that makes in the whole
// file. Pure.
import { Schema } from 'effect';
import { fileTimeInPiece, type HeardWord, type TranscriptPiece } from './transcript-audio.ts';

/** One whisper token: a word piece, and its DTW time in 10 ms units, −1 where DTW found none. */
export const WhisperToken = Schema.Struct({ text: Schema.String, t_dtw: Schema.Number });
export interface WhisperToken extends Schema.Schema.Type<typeof WhisperToken> {}

/** The part of whisper.cpp's -ojf output a transcript reads: every segment's tokens. Other keys are ignored. */
export const WhisperFullJson = Schema.Struct({
  transcription: Schema.Array(Schema.Struct({ tokens: Schema.Array(WhisperToken) })),
});

/**
 * A piece's tokens as words placed in the whole file, each at the middle of its tokens' DTW times. Tokens are word
 * pieces: one starting with a space begins a word, the rest continue it. Bracketed tokens like [_BEG_] are markers,
 * not speech.
 */
export function whisperWordsInFile(tokens: readonly WhisperToken[], piece: TranscriptPiece): HeardWord[] {
  const words: { text: string; times: number[] }[] = [];
  for (const token of tokens) {
    if (token.text.startsWith('[_') || !token.text.trim()) continue;
    // Punctuation joins the word before it, and whisper times it where it writes it, often in the quiet after.
    const spoken = /[\p{L}\p{N}]/u.test(token.text), last = words.at(-1);
    const joins = last !== undefined && (!spoken || !/^\s/.test(token.text));
    const word = joins ? last : { text: token.text.trim(), times: [] };
    if (joins) last.text += token.text;
    else words.push(word);
    if (spoken && token.t_dtw >= 0) word.times.push(token.t_dtw / 100);
  }
  let at = 0;
  // Whisper writes what it hears that isn't speech as a tag: [BLANK_AUDIO], (music), [laughs].
  return words.flatMap(({ text, times }) => {
    const first = times.at(0), last = times.at(-1);
    if (first !== undefined && last !== undefined) at = (first + last) / 2;
    return /^[[(].*[\])]$/.test(text) ? [] : [{ text, at: fileTimeInPiece(piece, at) }];
  });
}

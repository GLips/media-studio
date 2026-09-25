// speech-cues.ts: a voice-led video's named moments, each a word or phrase of a voiced line, declared in its
// timeline.ts. A move meant to land on a word anchors to the word, so rewording or re-reading the line moves it, where
// an offset (`landAt + 3.2`) would stay put. Each resolves at load: a phrase the line doesn't say throws, naming the cue.

import { findSpokenPhrase, type SpokenWord } from '../../voice-words.ts';

/** A cue on line `line`: where `phrase` is spoken (its `nth` occurrence, from 1). */
export type SpeechCue<Line extends string = string> = { line: Line; phrase: string; nth?: number };

/** A resolved cue: its line, and when the phrase starts and ends in seconds from the line's start. */
export type SpokenCue<Line extends string = string> = { line: Line; start: number; end: number };

export function defineSpeechCues<const Line extends string, const Cues extends Readonly<Record<string, SpeechCue<Line>>>>(
  voice: Readonly<Record<Line, { words: readonly SpokenWord[] }>>,
  cues: Cues,
): { readonly [K in keyof Cues]: SpokenCue<Cues[K]['line']> } {
  return Object.fromEntries(Object.entries(cues).map(([name, cue]) => {
    const { line, phrase, nth } = cue as SpeechCue<Line>;
    const spoken = voice[line];
    if (!spoken) throw new Error(`speech cue ${name}: no voiced line ${line}`);
    try {
      return [name, { line, ...findSpokenPhrase(spoken.words, phrase, nth) }];
    } catch (error) {
      throw new Error(`speech cue ${name} on line ${line}: ${error instanceof Error ? error.message : String(error)}`);
    }
  })) as never;
}

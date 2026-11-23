// spoken-word.ts: the unit every transcript is made of. Pure.
import { Schema } from 'effect';

/** A word and when it's spoken, in seconds from the start of its audio. */
export const SpokenWord = Schema.Struct({ text: Schema.String, start: Schema.Number, end: Schema.Number });
// A type alias, not the usual same-name interface: oxlint's no-misused-spread takes an interface extending a schema's
// type for a class instance, and every reader of a transcript spreads its words and the transcript itself.
export type SpokenWord = typeof SpokenWord.Type;

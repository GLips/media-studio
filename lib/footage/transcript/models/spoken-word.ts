// spoken-word.ts: the unit every transcript is made of. Pure.

/** A word and when it's spoken, in seconds from the start of its audio. */
export type SpokenWord = { text: string; start: number; end: number };

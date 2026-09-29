// voice-manifest.ts: a project's recorded lines, as `studio voice` writes them to its audio/manifest.ts. The timeline
// places a line from its take alone; the video plays it and captions it from the rest.

import type { SpokenWord } from './voice-words.ts';

/** A recorded line's timing: its length, its words from its start, and the pause the read left before it. */
export type VoiceTake = {
  duration: number;
  /** Every script word, timed by whisper, or spread by length over an estimated line. */
  words: readonly SpokenWord[];
  /** The pause the take left before this line, after the one before it in the script; null for the first or an estimate. */
  pauseBefore: number | null;
};

export type VoiceLine = VoiceTake & {
  /** An imported WAV, or null for a line timed by `studio voice --read=estimate` that has no audio yet. */
  src: string | null;
  text: string;
  /** Integrated loudness as it plays in the mix; null for an estimated line. */
  lufs: number | null;
};

/** A project's recorded lines by id, in script order: its manifest's `voice`. */
export type Voice = Readonly<Record<string, VoiceLine>>;

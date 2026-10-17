// voice-manifest.ts: a project's lines, as `studio voice` records them to its audio/manifest.ts (RecordedVoice), and
// as a storyboard times them (Voice): a recorded line's clip while it still says the line, else an estimate. The
// timeline places a line from its take alone; the video plays it and captions it from the rest.
//
// Negative space: the manifest holds real reads only. An estimate is worked out by resolveStoryboard each time it
// resolves, and never stored.

import type { SpokenWord } from './voice-words.ts';

/** A line's timing: its length, its words from its start, and the pause the read left before it. */
export type VoiceTake = {
  duration: number;
  /** Every script word, timed by whisper, or spread by length over an estimated line. */
  words: readonly SpokenWord[];
  /** The pause the take left before this line, after the one before it in the script; null for the first or an estimate. */
  pauseBefore: number | null;
};

type VoiceLineText = {
  /** What's said, as spokenText gives it. */
  text: string;
  /** How it's captioned, as captionMarkup gives it: `*emphasis*` and `` `keycaps` ``, a word for each of `words`. */
  caption: string;
  /** The storyboard line's `paragraph: true`: it starts a new paragraph of the read, so no caption page runs into it. */
  paragraph: boolean;
};

/** A line cut from a real read: its WAV and its loudness as it plays in the mix. */
export type RecordedVoiceLine = VoiceTake & VoiceLineText & { src: string; lufs: number };

/** A line timed from its word count, with no audio yet. */
export type EstimatedVoiceLine = VoiceTake & VoiceLineText & { src: null; lufs: null; pauseBefore: null };

export type VoiceLine = RecordedVoiceLine | EstimatedVoiceLine;

/** audio/manifest.ts's `voice`: the recorded lines by id, in script order. */
export type RecordedVoice = Readonly<Record<string, RecordedVoiceLine>>;

/** Every line a video places by id, in plan order, recorded or estimated: resolveStoryboard's `voice`. */
export type Voice = Readonly<Record<string, VoiceLine>>;

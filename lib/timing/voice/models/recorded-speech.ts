// recorded-speech.ts: a line spoken in a recording rather than read by a voice, as a storyboard names it (`speech` on a
// line) and a video plays it. The library makes one from an item and a range (libraryFootage's `speech`); timing,
// captions, cues and the mix take it as they take a voice's clip.
//
// A stretch keeps its source in and out: nothing is copied, so a picture laid against it stays in sync. Inside it,
// the line plays its pieces back to back, leaving out what its cleanup took (fillers, stutters), each listed for
// review to restore, and playing long pauses faster, so a face filmed with it never jumps.

import type { SpokenPauseKind } from '#lib/footage/transcript/models/spoken-pauses.ts';
import type { SpokenWord } from '#lib/footage/transcript/models/spoken-word.ts';

/** A stretch of a library item a line plays, in item seconds, at `speed` item seconds a line second (1 unless given). */
export type SpokenPiece = { from: number; to: number; speed?: number };

/** How long a piece plays, in line seconds. */
export const spokenPieceSeconds = (p: SpokenPiece) => (p.to - p.from) / (p.speed ?? 1);

/**
 * A pause between two of a line's words: what it's for, its silence in item seconds (`from`–`to`), the line second it
 * starts at and how long it `plays` there, and the fastest `speed` it reaches (1 when left as recorded). A line's
 * `keep` naming `keepAt` plays it as recorded (`kept`).
 */
export type SpokenPause = { kind: SpokenPauseKind; from: number; to: number; at: number; plays: number; speed: number; keepAt: number; kept?: true };

/**
 * Something a line's cleanup took out: its `kind` (`filler`, `pause`, `cut`, a rule's), what was said, where in the
 * item, and the line second `at` the line jumps over it. A line's `keep` names `keepAt` to restore it; `flag` asks
 * review to listen twice. `left`: kept, or no quiet to cut in. `cut`: the line's own.
 */
export type SpokenRemoval = { kind: string; text: string; from: number; to: number; at: number; keepAt: number; flag?: string; left?: 'kept' | 'no quiet'; cut?: true };

/** Speech whisper wrote no word for, left in the line (item seconds, and the line second it plays at) for review to hear. */
export type SpokenUnheard = { from: number; to: number; at: number };

/** A stretch of a line turned down to `gain`, in line seconds: a breath (about −8 dB), a click (0). */
export type SpokenDip = { start: number; end: number; gain: number };

/** The overlap centred on a cut, and any extra taper over the outgoing clip's tail, both in seconds. */
export type SpokenJoin = { crossfade: number; fadeOut: number };

/**
 * Where a line's sound is in a library item's media: `file`, each piece from its `start` (media seconds) for its
 * `duration` (line seconds) at its `speed`, at line second `at`. Each inner cut joins as `joins` says; the line fades
 * over `fade`, longer at an edge cut into sound, and dips where `dips` say.
 */
export type LibraryVoiceSound = {
  item: string;
  file: string;
  pieces: readonly { start: number; at: number; duration: number; speed: number }[];
  joins: readonly SpokenJoin[];
  fade: { in: number; out: number };
  dips: readonly SpokenDip[];
};

/** A line edge in the quiet beside its words (`clean`), or cutting into sound because no quiet came before the next word (`rough`). */
export type SpokenEdge = 'clean' | 'rough';

/**
 * Where in a library item a line is spoken: its id, the stretch's edges in item seconds, the pieces it plays inside
 * them, what it took out, and the unheard speech it left in.
 */
export type SpokenStretch = { item: string; from: number; to: number; pieces: readonly SpokenPiece[]; removals: readonly SpokenRemoval[]; unheard: readonly SpokenUnheard[] };

/** How long a stretch plays: its pieces back to back. */
export const spokenStretchSeconds = ({ pieces }: Pick<SpokenStretch, 'pieces'>) => pieces.reduce((sum, p) => sum + spokenPieceSeconds(p), 0);

/** The item second a stretch plays `t` line seconds in, running on from its last piece past its end. */
export function spokenItemTimeAt({ pieces, to }: Pick<SpokenStretch, 'pieces' | 'to'>, t: number): number {
  let left = t;
  for (const p of pieces) {
    const seconds = spokenPieceSeconds(p);
    if (left <= seconds) return p.from + left * (p.speed ?? 1);
    left -= seconds;
  }
  return to + left;
}

/**
 * A stretch of a library recording a line is spoken in: its edges and whether each lands in quiet, what the
 * transcript heard in it (on line time, removed words left out), and its sound: the spoken track levelled for the
 * mix, with its loudness, or null until the item is levelled (`studio library finish`).
 */
export type RecordedSpeech = SpokenStretch & {
  heard: readonly SpokenWord[];
  pauses: readonly SpokenPause[];
  edges: { in: SpokenEdge; out: SpokenEdge };
  sound: (LibraryVoiceSound & { lufs: number }) | null;
};

// review-speech.ts: what review shows of a recorded line's cleanup, on the render's own clock: each removal at the
// frame the line jumps over it (or, left in, the frame it plays from), and each stretch of speech the transcript
// wrote no word for. Restoring one is a storyboard edit through its `keepAt`, never a change to the render.
import type { TimelineReport } from '#lib/picture/video/models/timeline-report.ts';
import type { SpokenRemoval } from '#lib/timing/voice/models/recorded-speech.ts';

/** A removal on a line of the render, at `frame`; `from`, `to` and `keepAt` stay in item seconds, as the line's edits name them. */
export type ReviewSpeechRemoval = Omit<SpokenRemoval, 'at'> & { scene: string; line: string; frame: number };

/** Speech left in a line that the transcript has no words for, from frame `from` to `to`. */
export type ReviewUnheardSpeech = { line: string; from: number; to: number };

export type ReviewSpeechCleanup = { removals: ReviewSpeechRemoval[]; unheard: ReviewUnheardSpeech[] };

/** The cleanup of each recorded line in `cues` whose moment falls in the render's frames, `from` its first. */
export function reviewSpeechCleanupOf(cues: TimelineReport['cues'], fps: number, frames: { from: number; end: number }): ReviewSpeechCleanup {
  const frameOf = (seconds: number) => Math.round(seconds * fps) - frames.from;
  const holds = (frame: number) => frame >= 0 && frame < frames.end - frames.from;
  const removals = cues.flatMap(({ id, speech }) => (speech?.removals ?? []).map(({ at, ...removal }) =>
    Object.assign(removal, { scene: speech!.scene, line: id, frame: frameOf(at) })));
  const unheard = cues.flatMap(({ id, speech }) => (speech?.unheard ?? []).map((u) => ({ line: id, from: frameOf(u.start), to: frameOf(u.end) })));
  return { removals: removals.filter((r) => holds(r.frame)), unheard: unheard.filter((u) => holds(u.from) || holds(u.to - 1)) };
}

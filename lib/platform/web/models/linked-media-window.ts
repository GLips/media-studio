// linked-media-window.ts: the pure rules of a media follower (web/src/shared/ui/linked-media-clock.ts), a video
// kept on a leader's frame over a span of it: where the leader's frame stands against that span, and when the
// follower's landed picture is close enough to show. Here in lib rather than beside it so the rules run under the
// studio's Node tests; the web app has no test runner of its own.

/** Leader frames `[from, end)` a follower shows over. */
export type LinkedMediaSpan = { from: number; end: number };

/**
 * `away`: hidden and paused. `preroll`: hidden, parked on its picture for `from` so entering shows it at once.
 * `inside`: kept on the leader's frame, shown once its picture lands.
 */
export type LinkedMediaPhase = 'away' | 'preroll' | 'inside';

/** How many frames before `from` a follower seeks to its first picture: enough for a decoder to land a seek. */
export const LINKED_MEDIA_PREROLL_FRAMES = 10;

/** How far, in frames, a playing follower may trail or lead before it's seeked back into step, and still be shown. */
export const LINKED_MEDIA_DRIFT_FRAMES = 3;

/** Where `frame` stands against `span`; a null span is the leader's whole length. */
export function linkedMediaPhaseAt(span: LinkedMediaSpan | null, frame: number): LinkedMediaPhase {
  if (!span || (frame >= span.from && frame < span.end)) return 'inside';
  return frame < span.from && frame >= span.from - LINKED_MEDIA_PREROLL_FRAMES ? 'preroll' : 'away';
}

/**
 * The frame a media time falls in. The epsilon keeps a time at a frame's start on that frame: Chrome reports a
 * presented frame's `mediaTime` rounded to the microsecond, so frame 250 at 30 fps arrives as 8.333333 s.
 */
export const linkedMediaFrameAt = (seconds: number, fps: number) => Math.floor(seconds * fps + 1e-3);

/** Where to seek for `frame`: its middle, so the decoder can't settle on the neighbour. */
export const linkedMediaTimeOf = (frame: number, fps: number) => (frame + 0.5) / fps;

/**
 * Whether a follower's presented picture (`landed`, null before any) stands for `target`: exactly when settled,
 * within the drift allowance while playing, as a playing follower never presents the leader's very frame.
 */
export function linkedMediaLanded(landed: number | null, target: number, playing: boolean): boolean {
  return landed !== null && Math.abs(landed - target) <= (playing ? LINKED_MEDIA_DRIFT_FRAMES : 0);
}

// linked-media-window.ts: the pure rules of a media follower (web/src/shared/ui/linked-media-clock.ts), a video
// kept on a leader's frame over a span of it: where the leader's frame stands against that span, and what a
// follower does each pass given the frame it last presented. Here in lib rather than beside it so the rules run
// under the studio's Node tests; the web app has no test runner of its own.

/** Leader frames `[from, end)` a follower shows over. */
export type LinkedMediaSpan = { from: number; end: number };

/**
 * `away`: hidden and paused. `preroll`: hidden, parked on its picture for `from` so entering shows it at once.
 * `inside`: kept on the leader's frame, shown once its picture lands.
 */
export type LinkedMediaPhase = 'away' | 'preroll' | 'inside';

/** How many frames before `from` a follower seeks to its first picture: enough for a decoder to land a seek. */
export const LINKED_MEDIA_PREROLL_FRAMES = 10;

/** How far a playing follower's presented frame may stand from the leader's and still show. Paused, it's 0. */
export const LINKED_MEDIA_PLAYING_TOLERANCE_FRAMES = 1;

/** Past the tolerance and within this, a playing follower is hidden and caught up by its rate, not seeked. */
export const LINKED_MEDIA_CATCH_UP_FRAMES = 8;

/** A playing follower seeks this far ahead of the leader, which moves on while the decoder lands it. */
export const LINKED_MEDIA_PLAYING_SEEK_LEAD_FRAMES = 4;

/** How far past a playing follower's pending seek the leader may run before a fresher seek replaces it. */
const LINKED_MEDIA_SEEK_PATIENCE_FRAMES = 30;

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
 * A follower's picture as its frame callbacks report it. `requested` is the frame its latest seek asked for (null
 * after a change of source); `presented` the frame last presented since; `ready` once that seek has landed.
 */
export type LinkedMediaFollowerState = { requested: number | null; presented: number | null; ready: boolean };

/**
 * Whether a presented frame is the requested one landing. Paused, only that frame. Playing, the follower moves on
 * before a callback may report it, while a frame from before the seek can still be presented meanwhile.
 */
export function linkedMediaSeekLanded(requested: number, presented: number, playing: boolean): boolean {
  if (!playing) return presented === requested;
  return presented >= requested && presented - requested <= LINKED_MEDIA_SEEK_PATIENCE_FRAMES;
}

/** One pass's verdict: a seek to make (null for none), the rate as a share of the leader's, and whether to show. */
export type LinkedMediaFollowerMove = { seekTo: number | null; rate: number; shown: boolean };

/**
 * What a follower does for the leader's frame `target` (counted in the follower's frames). It shows only on that
 * frame exactly when paused, within the tolerance while playing; small playing drift is caught up by rate.
 */
export function linkedMediaFollowerMove(state: LinkedMediaFollowerState, target: number, playing: boolean): LinkedMediaFollowerMove {
  const seekTo = playing ? target + LINKED_MEDIA_PLAYING_SEEK_LEAD_FRAMES : target;
  const { requested, presented, ready } = state;
  if (!ready || presented === null) {
    // A seek on its way is waited out unless the leader has left it: moved while paused, run past it while playing.
    const waiting = requested !== null && (playing
      ? target >= requested - LINKED_MEDIA_PLAYING_SEEK_LEAD_FRAMES - LINKED_MEDIA_PLAYING_TOLERANCE_FRAMES
        && target <= requested + LINKED_MEDIA_SEEK_PATIENCE_FRAMES
      : target === requested);
    return { seekTo: waiting ? null : seekTo, rate: 1, shown: false };
  }
  const off = presented - target;
  if (!playing) return off === 0 ? { seekTo: null, rate: 1, shown: true } : { seekTo, rate: 1, shown: false };
  if (Math.abs(off) <= LINKED_MEDIA_PLAYING_TOLERANCE_FRAMES) return { seekTo: null, rate: 1, shown: true };
  if (Math.abs(off) <= LINKED_MEDIA_CATCH_UP_FRAMES) return { seekTo: null, rate: off < 0 ? 1.25 : 0.8, shown: false };
  return { seekTo, rate: 1, shown: false };
}

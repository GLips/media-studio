// linked-media-clock.ts: one clock for a page's media. A leader element (the one heard) sets the frame; followers
// (muted videos: a compared render, a slice laid into the cut) are kept on it over their own spans; `onTick` hears
// every frame shown, played or settled. One rAF loop drives all of it, so nothing else on the page runs its own.
import { useEffect, useEffectEvent } from 'react';
import {
  linkedMediaFollowerMove, linkedMediaFrameAt, linkedMediaPhaseAt, linkedMediaSeekLanded, linkedMediaTimeOf,
  type LinkedMediaFollowerState, type LinkedMediaSpan,
} from '#lib/platform/web/models/linked-media-window.ts';

export type LinkedMediaFollower = {
  element: HTMLVideoElement;
  /** The follower's own fps, which its frames are counted in. */
  fps: number;
  /** The follower's frame for a leader frame. A slice laid in at `from` is `(f) => f - from`. */
  frameOf: (leaderFrame: number) => number;
  /** Leader frames it shows over; null for all of them. */
  span: LinkedMediaSpan | null;
};

export type LinkedMediaClock = {
  /** The element that sets the frame and is heard. Followers play when it plays, at its rate. */
  attachLeader: (element: HTMLMediaElement | null) => void;
  /** Keeps `follower` on the leader from now on, muted; hidden (opacity) whenever its picture isn't the leader's. Returns the detach. */
  addFollower: (follower: LinkedMediaFollower) => () => void;
  /** Hears each frame shown: every animation frame while running, and each `sync`. */
  onTick: (listener: (frame: number) => void) => () => void;
  /** Runs the loop until `stop`, for play and shuttle alike. */
  start: () => void;
  stop: () => void;
  /** One pass at the frame now, for a settled change (a seek, a pause): followers re-aim, listeners hear it. */
  sync: () => void;
  dispose: () => void;
};

type LinkedMediaClockOptions = {
  /** The leader's frame this instant, clamped and with its fallback before metadata: the owner's to say. */
  frameNow: () => number;
  /**
   * Called first in each animation frame with the seconds since the last, to move the leader where its own playing
   * can't (reverse, a loop's wrap). It may call `stop`.
   */
  steer?: (elapsed: number) => void;
};

/**
 * `generation` counts seeks and changes of source; a frame callback asked for under an older one is dropped, since
 * it may report a picture from before the seek.
 */
type LinkedFollowerRecord = LinkedMediaFollowerState & {
  follower: LinkedMediaFollower; shown: boolean; generation: number; frameCallback: number;
};

function showLinkedFollower(record: LinkedFollowerRecord, shown: boolean) {
  if (record.shown === shown) return;
  record.shown = shown;
  // Cleared rather than set to 1, so the follower's own styles (a flip layer's resting opacity) still hold.
  record.follower.element.style.opacity = shown ? '' : '0';
}

export function createLinkedMediaClock({ frameNow, steer }: LinkedMediaClockOptions): LinkedMediaClock {
  let leader: HTMLMediaElement | null = null;
  const followers = new Set<LinkedFollowerRecord>();
  const listeners = new Set<(frame: number) => void>();
  let raf = 0;
  let running = false;
  let lastTick = 0;

  /** Forgets the follower's picture and hears its frames afresh: after a seek or a change of source. */
  const restartLinkedFollower = (record: LinkedFollowerRecord, requested: number | null) => {
    const { element, fps } = record.follower;
    record.generation += 1;
    record.requested = requested;
    record.presented = null;
    record.ready = false;
    showLinkedFollower(record, false);
    element.cancelVideoFrameCallback(record.frameCallback);
    const generation = record.generation;
    const hear = () => {
      record.frameCallback = element.requestVideoFrameCallback((_now, metadata) => {
        if (record.generation !== generation) return;
        record.presented = linkedMediaFrameAt(metadata.mediaTime, fps);
        if (!record.ready && record.requested !== null) {
          record.ready = linkedMediaSeekLanded(record.requested, record.presented, !element.paused);
        }
        aim(record, frameNow());
        hear();
      });
    };
    hear();
  };

  const aim = (record: LinkedFollowerRecord, frame: number) => {
    const { element, fps, frameOf, span } = record.follower;
    const phase = linkedMediaPhaseAt(span, frame);
    // A leader landing its own seek stands still, so the follower waits paused on that frame. Played on, it would run
    // frames ahead of the stalled leader and stay hidden for most of a second while the slow rate caught it up.
    const forward = phase === 'inside' && leader !== null && !leader.paused && !leader.seeking;
    if (!forward && !element.paused) element.pause();
    // Not seeked before metadata: Chrome applies such a seek as the file loads without a frame callback, so it
    // would never be heard landing. `loadedmetadata` aims it again.
    if (phase === 'away' || element.readyState < HTMLMediaElement.HAVE_METADATA) return showLinkedFollower(record, false);
    // Pre-rolled to its first picture, so the entering frame is already decoded when the leader reaches `from`.
    const target = Math.max(0, frameOf(phase === 'preroll' && span ? span.from : frame));
    const move = linkedMediaFollowerMove(record, target, forward);
    if (move.seekTo !== null) {
      restartLinkedFollower(record, move.seekTo);
      element.currentTime = linkedMediaTimeOf(move.seekTo, fps);
    }
    showLinkedFollower(record, phase === 'inside' && move.shown);
    if (forward && leader) {
      const rate = leader.playbackRate * move.rate;
      if (element.playbackRate !== rate) element.playbackRate = rate;
      if (element.paused) element.play().catch(() => undefined);
    }
  };

  const pass = () => {
    const frame = frameNow();
    for (const record of followers) aim(record, frame);
    for (const listener of listeners) listener(frame);
  };

  const tick = (now: number) => {
    const elapsed = lastTick ? (now - lastTick) / 1000 : 0;
    lastTick = now;
    steer?.(elapsed);
    if (!running) return;
    pass();
    raf = requestAnimationFrame(tick);
  };

  return {
    attachLeader(element) {
      leader = element;
    },
    addFollower(follower) {
      const { element } = follower;
      element.muted = true;
      const record: LinkedFollowerRecord = {
        follower, requested: null, presented: null, ready: false, shown: true, generation: 0, frameCallback: 0,
      };
      restartLinkedFollower(record, null);
      // `emptied` is a change of source: whatever it presented belongs to the old file.
      const onEmptied = () => restartLinkedFollower(record, null);
      const onMetadata = () => aim(record, frameNow());
      element.addEventListener('emptied', onEmptied);
      element.addEventListener('loadedmetadata', onMetadata);
      followers.add(record);
      aim(record, frameNow());
      return () => {
        followers.delete(record);
        element.cancelVideoFrameCallback(record.frameCallback);
        element.removeEventListener('emptied', onEmptied);
        element.removeEventListener('loadedmetadata', onMetadata);
        element.pause();
        element.style.opacity = '';
      };
    },
    onTick(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      cancelAnimationFrame(raf);
      running = true;
      lastTick = 0;
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    sync: pass,
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      listeners.clear();
    },
  };
}

/** `listener` on every tick of `clock` while mounted; it may change each render. */
export function useLinkedMediaTick(clock: Pick<LinkedMediaClock, 'onTick'>, listener: (frame: number) => void, enabled = true): void {
  const heard = useEffectEvent(listener);
  useEffect(() => (enabled ? clock.onTick((frame) => heard(frame)) : undefined), [clock, enabled]);
}

/**
 * Mounts `element` (from a ref callback held in state) as a follower of `clock` over `span`. `frameOf` may change
 * each render; a new span or fps re-mounts it.
 */
export function useLinkedMediaFollower(
  clock: Pick<LinkedMediaClock, 'addFollower'>,
  element: HTMLVideoElement | null,
  { fps, span, frameOf }: Omit<LinkedMediaFollower, 'element'>,
): void {
  const mapped = useEffectEvent(frameOf);
  const from = span?.from;
  const end = span?.end;
  useEffect(() => {
    if (!element) return undefined;
    const followed = from === undefined || end === undefined ? null : { from, end };
    return clock.addFollower({ element, fps, span: followed, frameOf: (frame) => mapped(frame) });
  }, [clock, element, fps, from, end]);
}

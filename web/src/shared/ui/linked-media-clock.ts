// linked-media-clock.ts: one clock for a page's media. A leader element (the one heard) sets the frame; followers
// (muted videos: a compared render, a slice laid into the cut) are kept on it over their own spans; `onTick` hears
// every frame shown, played or settled. One rAF loop drives all of it, so nothing else on the page runs its own.
import { useEffect, useEffectEvent } from 'react';
import {
  LINKED_MEDIA_DRIFT_FRAMES, linkedMediaFrameAt, linkedMediaLanded, linkedMediaPhaseAt, linkedMediaTimeOf, type LinkedMediaSpan,
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
  /** Keeps `follower` on the leader from now on, muted; hidden (opacity) until its picture lands. Returns the detach. */
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

type LinkedFollowerRecord = { follower: LinkedMediaFollower; landed: number | null; shown: boolean; frameCallback: number };

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

  const aim = (record: LinkedFollowerRecord, frame: number) => {
    const { element, fps, frameOf, span } = record.follower;
    const phase = linkedMediaPhaseAt(span, frame);
    const forward = phase === 'inside' && leader !== null && !leader.paused;
    if (!forward && !element.paused) element.pause();
    if (phase === 'away') return showLinkedFollower(record, false);
    // Pre-rolled to its first picture, so the entering frame is already decoded when the leader reaches `from`.
    const target = Math.max(0, frameOf(phase === 'preroll' && span ? span.from : frame));
    const at = linkedMediaFrameAt(element.currentTime, fps);
    if (Math.abs(at - target) > (forward ? LINKED_MEDIA_DRIFT_FRAMES : 0)) element.currentTime = linkedMediaTimeOf(target, fps);
    if (phase === 'preroll') return showLinkedFollower(record, false);
    // Hidden only on entering: once shown, a seek inside the span keeps the last picture up rather than flicker.
    if (!record.shown) showLinkedFollower(record, linkedMediaLanded(record.landed, target, forward));
    if (forward && leader) {
      element.playbackRate = leader.playbackRate;
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
      const record: LinkedFollowerRecord = { follower, landed: null, shown: true, frameCallback: 0 };
      showLinkedFollower(record, false);
      const watchLanded = () => {
        record.frameCallback = element.requestVideoFrameCallback((_now, metadata) => {
          record.landed = linkedMediaFrameAt(metadata.mediaTime, follower.fps);
          aim(record, frameNow());
          watchLanded();
        });
      };
      watchLanded();
      // A seek set before metadata is applied as the file loads, and Chrome presents that first picture without a frame
      // callback: seeking again where it stands brings one, so the follower can land and show.
      const onMetadata = () => {
        const { currentTime } = element;
        element.currentTime = currentTime;
        aim(record, frameNow());
      };
      element.addEventListener('loadedmetadata', onMetadata);
      followers.add(record);
      aim(record, frameNow());
      return () => {
        followers.delete(record);
        element.cancelVideoFrameCallback(record.frameCallback);
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

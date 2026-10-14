// review-playback-store.ts: the review's clock, outside React, on a linked media clock whose leader is the stage's
// media. Each tick writes the frame to the `--review-frame` CSS variable on the screen's root, which the playhead and
// every lane read; React hears only settled changes (a pause, a seek, a loop or rate change), so playing re-renders
// nothing. Anything that must move with each played frame hears `onTick`; a compared render or a slice is a follower.
import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import { linkedMediaFrameAt, linkedMediaTimeOf } from '#lib/platform/web/models/linked-media-window.ts';
import { createLinkedMediaClock, type LinkedMediaClock } from '#web/shared/ui/linked-media-clock.ts';
import { playMedia } from '#web/shared/ui/play-media.ts';

/** The CSS custom property the playing frame is written to, a bare number of frames on the render's clock. */
export const REVIEW_FRAME_VAR = '--review-frame';

/** A marked span of the render, both ends inclusive, as I and O mark it. */
export type ReviewLoopRange = { from: number; to: number };

/** The rates a loop plays at, cycled by `Alt+/`: slow enough to read a cut, back to real time. */
const REVIEW_LOOP_RATES = [1, 0.5, 0.25] as const;
export type ReviewLoopRate = (typeof REVIEW_LOOP_RATES)[number];

/** The fastest a J or L shuttle doubles to. */
const REVIEW_SHUTTLE_MAX_RATE = 8;

export type ReviewPlaybackState = {
  /** The frame the clock last settled on: where it paused or seeked. Stale while playing; read frameNow() then. */
  frame: number;
  playing: boolean;
  /** The shuttle's signed rate: 1 plays, 2 and 4 are L pressed again, negatives are J. 0 when stopped. */
  rate: number;
  loop: ReviewLoopRange | null;
  loopRate: ReviewLoopRate;
  muted: boolean;
  /** 0–1. */
  volume: number;
  /** The snapshot's length, or the file's once its metadata loads; 1 until then. */
  durationInFrames: number;
};

export type ReviewPlayback = {
  /** A ref callback for the `<video>` or `<audio>` the stage mounts. */
  attachMedia: (media: HTMLMediaElement | null) => (() => void) | undefined;
  /** A ref callback for the screen's root, which carries `--review-frame`. */
  attachRoot: (root: HTMLElement | null) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Moves the playhead without stopping it: a seek while playing keeps playing. */
  seek: (frame: number) => void;
  /** Pauses, then moves by `frames` from where it is. */
  stepBy: (frames: number) => void;
  /** J (-1) and L (1): plays that way, doubling the rate on each repeat, reversing from the other way's rate. */
  shuttle: (direction: -1 | 1) => void;
  stop: () => void;
  setLoop: (range: ReviewLoopRange | null) => void;
  cycleLoopRate: () => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  subscribe: (listener: () => void) => () => void;
  getState: () => ReviewPlaybackState;
  /** The frame on screen this instant, playing or not. */
  frameNow: () => number;
} & Pick<LinkedMediaClock, 'addFollower' | 'onTick'>;

/**
 * `durationInFrames` null is learnt from the media once it loads; `durationGuess` (the script's last word) stands in
 * until then, so the dock has a length before the audio does.
 */
type ReviewPlaybackOptions = { fps: number; durationInFrames: number | null; durationGuess?: number; startFrame: number };

export function createReviewPlayback({ fps, durationInFrames, durationGuess, startFrame }: ReviewPlaybackOptions): ReviewPlayback {
  let media: HTMLMediaElement | null = null;
  let root: HTMLElement | null = null;
  let state: ReviewPlaybackState = {
    frame: startFrame, playing: false, rate: 0, loop: null, loopRate: 1, muted: false, volume: 1, durationInFrames: durationInFrames ?? durationGuess ?? 1,
  };
  const listeners = new Set<() => void>();

  const publish = (patch: Partial<ReviewPlaybackState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const clamp = (frame: number) => Math.max(0, Math.min(state.durationInFrames - 1, Math.round(frame)));
  const writeFrame = (frame: number) => root?.style.setProperty(REVIEW_FRAME_VAR, String(frame));
  // Before its metadata a media element's time is 0, not where the clock is.
  const frameNow = () => (media && media.readyState >= HTMLMediaElement.HAVE_METADATA ? clamp(linkedMediaFrameAt(media.currentTime, fps)) : state.frame);
  const setMediaFrame = (frame: number) => {
    if (media) media.currentTime = linkedMediaTimeOf(frame, fps);
  };

  // Reverse play is stepped here: a media element can't play backwards.
  const steer = (elapsed: number) => {
    if (!media) return halt();
    if (state.rate < 0) media.currentTime = Math.max(0, media.currentTime + elapsed * state.rate);
    const frame = frameNow();
    if (state.loop && (frame > state.loop.to || frame < state.loop.from)) setMediaFrame(state.loop.from);
    if (state.rate < 0 && media.currentTime <= 0) halt();
  };
  const clock = createLinkedMediaClock({ frameNow, steer });
  clock.onTick(writeFrame);

  const halt = () => {
    clock.stop();
    media?.pause();
    const frame = frameNow();
    // A paused element shows the last frame it presented, which trails its currentTime by a frame or so: seeking to
    // the frame the readout names makes the picture that frame.
    if (media && media.readyState >= HTMLMediaElement.HAVE_METADATA) setMediaFrame(frame);
    publish({ playing: false, rate: 0, frame });
    clock.sync();
  };

  const run = (rate: number) => {
    if (!media || rate === 0) return halt();
    if (rate > 0) {
      media.playbackRate = state.loop ? rate * state.loopRate : rate;
      playMedia(media);
    } else {
      media.pause();
    }
    publish({ playing: true, rate });
    clock.start();
  };

  const seek = (frame: number) => {
    const clamped = clamp(frame);
    setMediaFrame(clamped);
    // Published first: before the media's metadata, the frame the clock reads is the settled one.
    publish({ frame: clamped });
    clock.sync();
  };

  return {
    attachMedia(element) {
      media = element;
      clock.attachLeader(element);
      if (!element) return undefined;
      element.muted = state.muted;
      element.volume = state.volume;
      const onMetadata = () => {
        if (durationInFrames === null && Number.isFinite(element.duration)) publish({ durationInFrames: Math.max(1, Math.round(element.duration * fps)) });
        seek(state.frame);
      };
      // The element pausing on its own (the end, a stall) settles the clock as K would.
      const onPause = () => state.rate > 0 && halt();
      const onSeeked = () => !state.playing && publish({ frame: frameNow() });
      element.addEventListener('loadedmetadata', onMetadata);
      element.addEventListener('pause', onPause);
      element.addEventListener('seeked', onSeeked);
      if (element.readyState >= HTMLMediaElement.HAVE_METADATA) onMetadata();
      return () => {
        element.removeEventListener('loadedmetadata', onMetadata);
        element.removeEventListener('pause', onPause);
        element.removeEventListener('seeked', onSeeked);
        if (state.playing) halt();
        media = null;
        clock.attachLeader(null);
      };
    },
    attachRoot(element) {
      root = element;
      writeFrame(state.frame);
    },
    play: () => run(1),
    pause: halt,
    stop: halt,
    toggle: () => (state.playing ? halt() : run(1)),
    seek,
    stepBy(frames) {
      const from = frameNow();
      halt();
      seek(from + frames);
    },
    shuttle(direction) {
      const same = Math.sign(state.rate) === direction;
      run(same ? direction * Math.min(REVIEW_SHUTTLE_MAX_RATE, Math.abs(state.rate) * 2) : direction);
    },
    setLoop(range) {
      publish({ loop: range });
      if (state.rate > 0) run(state.rate);
    },
    cycleLoopRate() {
      const next = REVIEW_LOOP_RATES[(REVIEW_LOOP_RATES.indexOf(state.loopRate) + 1) % REVIEW_LOOP_RATES.length];
      publish({ loopRate: next });
      if (state.rate > 0) run(state.rate);
    },
    setMuted(muted) {
      if (media) media.muted = muted;
      publish({ muted });
    },
    setVolume(volume) {
      const clamped = Math.max(0, Math.min(1, volume));
      if (media) media.volume = clamped;
      publish({ volume: clamped });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    frameNow,
    addFollower: clock.addFollower,
    onTick: clock.onTick,
  };
}

/**
 * The screen's one clock for its lifetime, and `onSettle` with each new frame it settles on (a pause, a seek), which
 * is when the URL's `f` is written: never per played frame.
 */
export function useReviewPlaybackClock(options: ReviewPlaybackOptions, onSettle: (frame: number) => void): ReviewPlayback {
  const [playback] = useState(() => createReviewPlayback(options));
  const settle = useEffectEvent(onSettle);
  // The cleanup only unsubscribes: the clock outlives this effect, which StrictMode and a hot update re-run on the
  // same clock. Its loop stops when the stage's media detaches (`attachMedia`'s cleanup halts it).
  useEffect(() => {
    let settled = playback.getState().frame;
    return playback.subscribe(() => {
      const { frame } = playback.getState();
      if (frame === settled) return;
      settled = frame;
      settle(frame);
    });
  }, [playback]);
  return playback;
}

/**
 * A settled slice of the clock, re-rendering only when that slice changes. `select` must return a primitive or a
 * value held in the state (the loop range), never a new object.
 */
export function useReviewPlaybackState<T>(playback: ReviewPlayback, select: (state: ReviewPlaybackState) => T): T {
  return useSyncExternalStore(playback.subscribe, () => select(playback.getState()));
}

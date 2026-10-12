// decision-playback.ts: one clock for every candidate on the decisions screen. The focused candidate is the one heard;
// switching focus carries the time over, so B is heard from where A was. The clock's time is its own, not the heard
// element's: a short candidate clamps its element at its end, and the others keep the time. While playing, a rAF loop
// writes the time to `--decision-time` on the screen's root, which every playhead reads; React hears only a pause, a
// seek or a swap.
import { useSyncExternalStore } from 'react';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import { playMedia } from '#web/shared/ui/play-media.ts';

/** The CSS custom property the playing time is written to, in seconds. */
export const DECISION_TIME_VAR = '--decision-time';

/** How far a linked candidate may drift from the heard one before it's pulled back, in seconds. */
const DECISION_DRIFT_SECONDS = 0.12;

/** How near its end a candidate counts as played out, so Space starts it over rather than playing a few samples. */
const DECISION_END_SECONDS = 0.05;

/** Whether `seconds` is at or past the end of `media`: there, playing it starts it from 0. */
const isPastEnd = (media: HTMLMediaElement, seconds: number) => media.duration > 0 && seconds >= media.duration - DECISION_END_SECONDS;

/** The longest candidate's length: the one time axis every lane and the scrubber share, so a moment sits at one x. */
export const decisionTimeAxisOf = (state: DecisionPlaybackState): number | undefined => {
  const lengths = Object.values(state.durations).filter((d) => Number.isFinite(d) && d > 0);
  return lengths.length ? Math.max(...lengths) : undefined;
};

export type DecisionPlaybackState = {
  /**
   * Seconds, where it last paused, seeked or swapped; may lie past the heard candidate's end, which then plays from
   * its start. Stale while playing: read timeNow() then.
   */
  time: number;
  playing: boolean;
  /** The candidate heard, by key. */
  active: string | null;
  /** Each attached candidate's length in seconds, once its metadata loads. */
  durations: Readonly<Record<string, number>>;
};

export type DecisionPlayback = {
  /** A ref callback per candidate's `<video>` or `<audio>`. */
  attachMedia: (key: string) => (media: HTMLMediaElement | null) => (() => void) | undefined;
  /** A ref callback for the screen's root, which carries `--decision-time`. */
  attachRoot: (root: HTMLElement | null) => void;
  /** A ref callback for the timecode, written straight while playing. */
  attachClock: (clock: HTMLElement | null) => void;
  /** Hears `key` from the time now. */
  setActive: (key: string) => void;
  /** The candidates that play along with the heard one, muted: the two-up's pair. The rest hold the time. */
  setLinked: (keys: readonly string[]) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  subscribe: (listener: () => void) => () => void;
  getState: () => DecisionPlaybackState;
  timeNow: () => number;
};

export function createDecisionPlayback(): DecisionPlayback {
  const media = new Map<string, HTMLMediaElement>();
  let linked: readonly string[] = [];
  let root: HTMLElement | null = null;
  let clock: HTMLElement | null = null;
  let state: DecisionPlaybackState = { time: 0, playing: false, active: null, durations: {} };
  const listeners = new Set<() => void>();
  let raf = 0;
  let resumeOnAttach = false;

  const publish = (patch: Partial<DecisionPlaybackState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const heard = () => (state.active === null ? undefined : media.get(state.active));
  const timeNow = () => (state.playing ? heard()?.currentTime ?? state.time : state.time);
  const paint = (seconds: number) => {
    root?.style.setProperty(DECISION_TIME_VAR, String(seconds));
    // The text node React rendered, not textContent: replacing the node would leave React updating a detached one.
    if (clock?.firstChild) clock.firstChild.nodeValue = formatReviewClock(seconds);
  };
  const followers = () => [...media].filter(([key]) => key !== state.active && linked.includes(key)).map(([, m]) => m);
  /** Every other candidate shows the same moment: the linked ones play there, the rest hold it. */
  const align = (seconds: number) => {
    for (const [key, m] of media) {
      if (key === state.active) continue;
      if (Math.abs(m.currentTime - seconds) > DECISION_DRIFT_SECONDS) m.currentTime = Math.min(seconds, m.duration || seconds);
    }
  };
  const tick = () => {
    const seconds = timeNow();
    paint(seconds);
    for (const m of followers()) if (Math.abs(m.currentTime - seconds) > DECISION_DRIFT_SECONDS) m.currentTime = seconds;
    raf = requestAnimationFrame(tick);
  };

  /** Stops every candidate with the clock at `time`, which may lie past the heard one's end. */
  const halt = (time: number) => {
    resumeOnAttach = false;
    cancelAnimationFrame(raf);
    for (const m of media.values()) m.pause();
    paint(time);
    align(time);
    publish({ playing: false, time });
  };
  const pause = () => halt(timeNow());
  const play = () => {
    const m = heard();
    if (!m) return;
    const from = isPastEnd(m, state.time) ? 0 : state.time;
    m.currentTime = from;
    align(from);
    paint(from);
    state = { ...state, time: from };
    playMedia(m);
    for (const f of followers()) playMedia(f);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    publish({ playing: true });
  };
  const seek = (seconds: number) => {
    const time = Math.max(0, seconds);
    const m = heard();
    // Past the end of the one playing: it can't play there, so the clock stops at the time sought. Left playing, the
    // heard element would clamp, end, and its end would pull every candidate back to it.
    if (state.playing && m && isPastEnd(m, time)) halt(time);
    if (m) m.currentTime = Math.min(time, m.duration || time);
    align(time);
    paint(time);
    publish({ time });
  };
  const setActive = (key: string) => {
    if (key === state.active) return;
    const time = timeNow(), playing = state.playing, beforeKey = state.active, before = heard();
    if (before) before.muted = true;
    publish({ active: key });
    const now = heard();
    if (now) {
      now.muted = false;
      now.currentTime = Math.min(time, now.duration || time);
    }
    // A swap keeps playing on the new candidate; the old one keeps going only when it's linked.
    if (before && beforeKey !== null && !linked.includes(beforeKey)) before.pause();
    // Swapped to a candidate the two-up is only now mounting: it picks up where this left off once it loads.
    if (playing && !now) {
      pause();
      resumeOnAttach = true;
    }
    publish({ time });
    // Playing on into one shorter than the time: it starts over, and the clock with it.
    if (playing && now) {
      if (isPastEnd(now, time)) play();
      else playMedia(now);
    }
  };

  const attachMediaFor = (key: string) => (m: HTMLMediaElement | null) => {
    if (!m) return undefined;
    m.muted = key !== state.active;
    media.set(key, m);
    const loaded = () => {
      if (state.durations[key] !== m.duration) publish({ durations: { ...state.durations, [key]: m.duration } });
      if (key !== state.active) m.currentTime = Math.min(timeNow(), m.duration);
      else if (resumeOnAttach) {
        resumeOnAttach = false;
        play();
      }
    };
    const ended = () => { if (key === state.active && state.playing) pause(); };
    m.addEventListener('loadedmetadata', loaded);
    m.addEventListener('ended', ended);
    if (m.readyState >= HTMLMediaElement.HAVE_METADATA) loaded();
    return () => {
      m.removeEventListener('loadedmetadata', loaded);
      m.removeEventListener('ended', ended);
      if (media.get(key) === m) media.delete(key);
    };
  };
  // One callback per key for the store's life: a new one each render would detach and re-attach the element.
  const attachers = new Map<string, ReturnType<typeof attachMediaFor>>();

  return {
    attachMedia: (key) => {
      const attach = attachers.get(key) ?? attachMediaFor(key);
      attachers.set(key, attach);
      return attach;
    },
    attachRoot: (r) => {
      root = r;
      paint(timeNow());
    },
    attachClock: (c) => {
      clock = c;
      paint(timeNow());
    },
    setActive,
    setLinked: (keys) => {
      linked = keys;
      if (!state.playing) return;
      for (const [key, m] of media) {
        if (key === state.active) continue;
        if (keys.includes(key)) playMedia(m);
        else m.pause();
      }
    },
    play,
    pause,
    toggle: () => (state.playing ? pause() : play()),
    seek,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    timeNow,
  };
}

/** A slice of the clock's settled state, re-rendering only when that slice changes. */
export function useDecisionPlaybackState<T>(playback: DecisionPlayback, select: (state: DecisionPlaybackState) => T): T {
  return useSyncExternalStore(playback.subscribe, () => select(playback.getState()), () => select(playback.getState()));
}

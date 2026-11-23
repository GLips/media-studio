// decision-playback.ts: every candidate on the decisions screen on one linked media clock. The focused candidate's
// sound is the clock's leader; switching focus carries the time over, so B is heard from where A was. The clock's
// time is its own, not the heard element's: a short candidate holds its last picture, and the others keep the time.
// Candidates playing along (the two-up's pair) are the clock's followers; the rest hold the time, aligned as it
// settles. Each tick writes the time to `--decision-time` on the screen's root, which every playhead reads; React
// hears only a pause, a seek or a swap.
import { useSyncExternalStore } from 'react';
import { linkedMediaFrameAt, linkedMediaTimeOf } from '#lib/platform/web/models/linked-media-window.ts';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import { createLinkedMediaClock, type LinkedMediaClock, type LinkedMediaFollower } from '#web/shared/ui/linked-media-clock.ts';
import { playMedia } from '#web/shared/ui/play-media.ts';

/** The CSS custom property the playing time is written to, in seconds. */
export const DECISION_TIME_VAR = '--decision-time';

/** The clock's frames a second: finer than any candidate's, so each one's own frame is found. */
export const DECISION_CLOCK_FPS = 120;

/** How near its end a candidate counts as played out, so Space starts it over rather than playing a few samples. */
const DECISION_END_SECONDS = 0.05;

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

/**
 * Where a candidate's sound sits in its element: a stretch of a longer file (a library range) starts `mediaStart`
 * seconds in and lasts `length`. Without one, the whole file from 0.
 */
export type DecisionSoundPlacement = { mediaStart: number; length: number };

type DecisionFollowerClock = Pick<LinkedMediaClock, 'addFollower'>;

export type DecisionPlayback = {
  /** A ref callback for a candidate's sound: its `<video>`, which is also its picture, or its `<audio>`. */
  attachMedia: (key: string, placement?: DecisionSoundPlacement) => (media: HTMLMediaElement | null) => (() => void) | undefined;
  /** Where a candidate's other pictures (a library range's screen and camera) join the clock, in its frames. */
  followerClock: (key: string) => DecisionFollowerClock;
  /** A ref callback for the screen's root, which carries `--decision-time`. */
  attachRoot: (root: HTMLElement | null) => void;
  /** A ref callback for the timecode, written straight while playing. */
  attachClock: (clock: HTMLElement | null) => void;
  /** Hears `key` from the time now. */
  setActive: (key: string) => void;
  /** The candidates that play along with the heard one: the two-up's pair. The rest hold the time. */
  setLinked: (keys: readonly string[]) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  subscribe: (listener: () => void) => () => void;
  getState: () => DecisionPlaybackState;
  timeNow: () => number;
};

type DecisionSound = { element: HTMLMediaElement; placement?: DecisionSoundPlacement };

/** A candidate's picture: on the clock while its candidate plays along (`detach` set), else held at the time. */
type DecisionPicture = { key: string; follower: LinkedMediaFollower; sound: boolean; detach: (() => void) | null };

/** A candidate's length: its range's, or its file's once loaded. */
const decisionSoundLength = ({ element, placement }: DecisionSound) => placement?.length ?? element.duration;
const decisionSoundLoaded = (sound: DecisionSound) => sound.element.readyState >= HTMLMediaElement.HAVE_METADATA;

/**
 * The grid a candidate's own video is judged on as a follower. Its real rate is unknown; a video's usual one keeps the
 * clock's frame tolerances at a video frame, not the 120th of a second that would hide it at every hair of drift.
 */
const DECISION_FOLLOWER_FPS = 30;

/**
 * A candidate's own video as a follower, its sound's placement applied: a range of a longer file holds its last
 * picture past the range's end, a whole file once it's played out.
 */
function decisionVideoFollower(element: HTMLVideoElement, placement: DecisionSoundPlacement | undefined): LinkedMediaFollower {
  const fps = DECISION_FOLLOWER_FPS, start = placement?.mediaStart ?? 0;
  return {
    element, fps, offGrid: true,
    span: placement ? { from: 0, end: Math.round(placement.length * DECISION_CLOCK_FPS), holdAfter: true } : null,
    frameOf: (frame) => {
      const at = linkedMediaFrameAt(start + frame / DECISION_CLOCK_FPS, fps);
      return element.duration > 0 ? Math.min(at, Math.ceil(element.duration * fps) - 1) : at;
    },
  };
}

export function createDecisionPlayback(): DecisionPlayback {
  const sounds = new Map<string, DecisionSound>();
  const pictures = new Set<DecisionPicture>();
  let leader: DecisionSound | null = null;
  let linked: readonly string[] = [];
  let root: HTMLElement | null = null;
  let timecode: HTMLElement | null = null;
  let state: DecisionPlaybackState = { time: 0, playing: false, active: null, durations: {} };
  const listeners = new Set<() => void>();
  let resumeOnAttach = false;

  const publish = (patch: Partial<DecisionPlaybackState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const isPastEnd = (sound: DecisionSound, seconds: number) => decisionSoundLength(sound) > 0 && seconds >= decisionSoundLength(sound) - DECISION_END_SECONDS;
  const timeNow = () => (state.playing && leader && decisionSoundLoaded(leader) ? leader.element.currentTime - (leader.placement?.mediaStart ?? 0) : state.time);
  /** Puts a sound at `seconds` of its candidate, or its end when that's shorter. */
  const placeSound = (sound: DecisionSound, seconds: number) => {
    if (!decisionSoundLoaded(sound)) return;
    const length = decisionSoundLength(sound);
    sound.element.currentTime = (sound.placement?.mediaStart ?? 0) + Math.min(seconds, length || seconds);
  };

  const clock = createLinkedMediaClock({
    frameNow: () => Math.round(timeNow() * DECISION_CLOCK_FPS),
    // A library range plays on in its file past the range's end: the clock stops it there.
    steer: () => {
      if (state.playing && leader?.placement && timeNow() >= leader.placement.length) halt(leader.placement.length);
    },
  });
  const paint = (seconds: number) => {
    root?.style.setProperty(DECISION_TIME_VAR, String(seconds));
    // The text node React rendered, not textContent: replacing the node would leave React updating a detached one.
    if (timecode?.firstChild) timecode.firstChild.nodeValue = formatReviewClock(seconds);
  };
  clock.onTick((frame) => paint(frame / DECISION_CLOCK_FPS));

  /** A picture not on the clock shows the moment it's at, paused, kept within its span as the clock keeps it. */
  const hold = ({ follower: { element, fps, frameOf, span } }: DecisionPicture) => {
    if (element.readyState < HTMLMediaElement.HAVE_METADATA) return;
    element.pause();
    element.muted = true;
    const now = Math.round(timeNow() * DECISION_CLOCK_FPS);
    const frame = Math.max(0, frameOf(span ? Math.min(Math.max(now, span.from), span.end - 1) : now));
    if (linkedMediaFrameAt(element.currentTime, fps) !== frame) element.currentTime = linkedMediaTimeOf(frame, fps);
  };
  /**
   * Puts each picture on the clock or holds it: on while its candidate is heard or plays along, except the heard
   * video, which is the leader itself.
   */
  const arrange = () => {
    for (const picture of pictures) {
      const isLeader = picture.sound && picture.key === state.active;
      const along = !isLeader && (picture.key === state.active || linked.includes(picture.key));
      if (along && !picture.detach) picture.detach = clock.addFollower(picture.follower);
      if (!along && picture.detach) {
        picture.detach();
        picture.detach = null;
      }
      if (!along && !isLeader) hold(picture);
    }
  };
  const addPicture = (picture: DecisionPicture) => {
    pictures.add(picture);
    const onMetadata = () => !picture.detach && !(picture.sound && picture.key === state.active) && hold(picture);
    picture.follower.element.addEventListener('loadedmetadata', onMetadata);
    arrange();
    return () => {
      picture.follower.element.removeEventListener('loadedmetadata', onMetadata);
      picture.detach?.();
      pictures.delete(picture);
    };
  };

  /** Stops every candidate with the clock at `time`, which may lie past the heard one's end. */
  const halt = (time: number) => {
    resumeOnAttach = false;
    clock.stop();
    leader?.element.pause();
    publish({ playing: false, time });
    paint(time);
    arrange();
    clock.sync();
  };
  const pause = () => halt(timeNow());
  const play = () => {
    if (!leader || !decisionSoundLoaded(leader)) return;
    const from = isPastEnd(leader, state.time) ? 0 : state.time;
    placeSound(leader, from);
    publish({ time: from, playing: true });
    paint(from);
    arrange();
    playMedia(leader.element);
    clock.start();
  };
  const seek = (seconds: number) => {
    const time = Math.max(0, seconds);
    // Past the end of the one playing: it can't play there, so the clock stops at the time sought.
    if (state.playing && leader && isPastEnd(leader, time)) halt(time);
    if (leader) placeSound(leader, time);
    publish({ time });
    paint(time);
    arrange();
    clock.sync();
  };
  const lead = (key: string | null) => {
    const before = leader;
    leader = key === null ? null : sounds.get(key) ?? null;
    clock.attachLeader(leader?.element ?? null);
    if (before && before !== leader) {
      before.element.muted = true;
      before.element.pause();
    }
    if (leader) leader.element.muted = false;
  };
  const setActive = (key: string) => {
    if (key === state.active) return;
    const time = timeNow(), playing = state.playing;
    clock.stop();
    publish({ active: key, time });
    lead(key);
    arrange();
    if (leader) placeSound(leader, time);
    // Swapped to a candidate the two-up is only now mounting: it picks up where this left off once it loads.
    if (playing && (!leader || !decisionSoundLoaded(leader))) {
      halt(time);
      resumeOnAttach = true;
      return;
    }
    if (!playing || !leader) return clock.sync();
    // Playing on into one shorter than the time: it starts over, and the clock with it.
    if (isPastEnd(leader, time)) return play();
    playMedia(leader.element);
    clock.start();
  };

  const attachMediaFor = (key: string, placement: DecisionSoundPlacement | undefined) => (element: HTMLMediaElement | null) => {
    if (!element) return undefined;
    const sound: DecisionSound = { element, ...(placement && { placement }) };
    sounds.set(key, sound);
    element.muted = true;
    if (key === state.active) lead(key);
    const removePicture = element instanceof HTMLVideoElement
      ? addPicture({ key, follower: decisionVideoFollower(element, placement), sound: true, detach: null })
      : undefined;
    if (placement) publish({ durations: { ...state.durations, [key]: placement.length } });
    const onMetadata = () => {
      if (!placement && state.durations[key] !== element.duration) publish({ durations: { ...state.durations, [key]: element.duration } });
      if (sound !== leader) return;
      placeSound(sound, state.time);
      if (resumeOnAttach) {
        resumeOnAttach = false;
        play();
      } else clock.sync();
    };
    // Played to its end, or stopped by the browser: settles as a pause does. A pause the clock made on its way to
    // playing again has been undone by the time this is heard, so `paused` tells them apart.
    const onPause = () => {
      if (sound === leader && state.playing && element.paused) pause();
    };
    element.addEventListener('loadedmetadata', onMetadata);
    element.addEventListener('pause', onPause);
    if (decisionSoundLoaded(sound)) onMetadata();
    return () => {
      element.removeEventListener('loadedmetadata', onMetadata);
      element.removeEventListener('pause', onPause);
      removePicture?.();
      if (sounds.get(key) === sound) sounds.delete(key);
      if (sound === leader) {
        if (state.playing) halt(timeNow());
        lead(null);
      }
    };
  };
  // One callback per candidate and placement for the store's life: a new one each render would detach and re-attach.
  const attachers = new Map<string, ReturnType<typeof attachMediaFor>>();
  const followerClocks = new Map<string, DecisionFollowerClock>();

  return {
    attachMedia: (key, placement) => {
      const id = placement ? `${key}@${placement.mediaStart}+${placement.length}` : key;
      const attach = attachers.get(id) ?? attachMediaFor(key, placement);
      attachers.set(id, attach);
      return attach;
    },
    followerClock: (key) => {
      const made = followerClocks.get(key) ?? { addFollower: (follower) => addPicture({ key, follower, sound: false, detach: null }) };
      followerClocks.set(key, made);
      return made;
    },
    attachRoot: (r) => {
      root = r;
      paint(timeNow());
    },
    attachClock: (c) => {
      timecode = c;
      paint(timeNow());
    },
    setActive,
    setLinked: (keys) => {
      linked = keys;
      arrange();
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

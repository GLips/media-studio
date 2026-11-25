// library-item-playback.ts: a library item played on a linked media clock, in item time. The leader is the track heard
// (its speech track, else the first with sound, else the first picture); every picture is a follower, lined up by its
// sync corrections. Each tick writes item seconds to `--library-time` on the screen's root, which the playhead, the
// flags and the lit word read; React hears only settled changes (a play, a pause, a seek, a loop, a rate or the sound).
//
// Negative space: item time outside the heard track's span can't be reached. A recording's mic runs the whole take,
// so nothing worth watching lies there.
import { useSyncExternalStore } from 'react';
import { libraryItemTimeOf, libraryMediaTimeOf, type LibraryItem, type LibraryTrack } from '#lib/footage/library/models/library-item.ts';
import { createLinkedMediaClock, type LinkedMediaClock } from '#web/shared/ui/linked-media-clock.ts';
import { playMedia } from '#web/shared/ui/play-media.ts';

/** The CSS custom property the playing time is written to, in item seconds. */
export const LIBRARY_TIME_VAR = '--library-time';

/** The clock's frames, in item time: finer than any track's, so a follower's own frame is always found. */
export const LIBRARY_CLOCK_FPS = 120;

/** The speeds the transport's rate button steps through, back to real time. */
export const LIBRARY_PLAYBACK_RATES = [1, 1.5, 2, 0.5] as const;
export type LibraryPlaybackRate = (typeof LIBRARY_PLAYBACK_RATES)[number];

/** How far Alt+↑ and Alt+↓ move the volume, as the render review's keys do. */
export const LIBRARY_VOLUME_STEP = 0.1;

/** A range of the item played over and over: a flag being checked, or a range being marked. */
export type LibraryLoop = { start: number; end: number };

export type LibraryPlaybackState = {
  /** Item seconds, where it last paused or seeked. Stale while playing: read timeNow() then. */
  time: number;
  playing: boolean;
  loop: LibraryLoop | null;
  rate: LibraryPlaybackRate;
  muted: boolean;
  /** 0 to 1. */
  volume: number;
};

export type LibraryItemPlayback = {
  /** The track heard, by name, which a `<video>` or `<audio>` of its file mounts as attachLeader. */
  heard: string;
  /** The item seconds the heard track spans: where the clock can go. */
  reach: { start: number; end: number };
  attachLeader: (media: HTMLMediaElement | null) => (() => void) | undefined;
  attachRoot: (root: HTMLElement | null) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  setLoop: (loop: LibraryLoop | null) => void;
  /** The next of LIBRARY_PLAYBACK_RATES; the pictures follow the heard track's rate. */
  cycleRate: () => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  subscribe: (listener: () => void) => () => void;
  getState: () => LibraryPlaybackState;
  timeNow: () => number;
} & Pick<LinkedMediaClock, 'addFollower' | 'onTick'>;

/**
 * The track a page hears an item through: `asked` when it has sound (a URL's `hear`), else its speech track, else the
 * first with sound, else the first picture.
 */
export function libraryHeardTrackOf(item: LibraryItem, asked?: string): string {
  if (asked !== undefined && item.tracks[asked]?.audio) return asked;
  const tracks = Object.entries(item.tracks);
  const heard = item.speech ?? tracks.find(([, t]) => t.audio)?.[0] ?? tracks[0]?.[0];
  if (heard === undefined) throw new Error(`${item.id} has no tracks to play`);
  return heard;
}

/** What a playback carries over to the next when the page switches the track it hears. */
export type LibraryPlaybackCarried = Pick<LibraryPlaybackState, 'playing' | 'loop' | 'rate' | 'muted' | 'volume'>;

/** The item seconds a track's media spans. */
export const libraryTrackReach = (track: LibraryTrack) => ({ start: libraryItemTimeOf(track, 0), end: libraryItemTimeOf(track, track.mediaSeconds) });

/**
 * `item` played from `startSeconds`, heard through `asked` (see libraryHeardTrackOf). With `carried`, it takes over
 * from the playback before it: its speed, sound and loop, and it plays once its leader has loaded if that one was.
 */
export function createLibraryItemPlayback(item: LibraryItem, startSeconds: number, asked?: string, carried?: LibraryPlaybackCarried): LibraryItemPlayback {
  const heard = libraryHeardTrackOf(item, asked), track = item.tracks[heard];
  const reach = libraryTrackReach(track);
  const clamp = (seconds: number) => Math.max(reach.start, Math.min(reach.end, seconds));
  let media: HTMLMediaElement | null = null;
  let root: HTMLElement | null = null;
  let state: LibraryPlaybackState = { loop: null, rate: 1, muted: false, volume: 1, ...carried, time: clamp(startSeconds), playing: false };
  // Played as soon as the leader can: `play` needs its element loaded.
  let playWhenLoaded = carried?.playing ?? false;
  const listeners = new Set<() => void>();

  const publish = (patch: Partial<LibraryPlaybackState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const loaded = () => media !== null && media.readyState >= HTMLMediaElement.HAVE_METADATA;
  const timeNow = () => (loaded() && media ? clamp(libraryItemTimeOf(track, media.currentTime)) : state.time);
  const setMediaTime = (seconds: number) => {
    if (media && loaded()) media.currentTime = Math.max(0, libraryMediaTimeOf(track, seconds));
  };

  const steer = () => {
    const { loop } = state;
    if (loop && timeNow() >= loop.end) setMediaTime(loop.start);
  };
  const clock = createLinkedMediaClock({ frameNow: () => Math.round(timeNow() * LIBRARY_CLOCK_FPS), steer });
  const paint = (seconds: number) => root?.style.setProperty(LIBRARY_TIME_VAR, String(seconds));
  clock.onTick((frame) => paint(frame / LIBRARY_CLOCK_FPS));

  const halt = () => {
    clock.stop();
    media?.pause();
    publish({ playing: false, time: timeNow() });
    clock.sync();
  };
  const play = () => {
    if (!media) return;
    const { loop } = state;
    // From the start of the loop, or of the item once played to its end.
    if (loop && (state.time < loop.start || state.time >= loop.end)) setMediaTime(loop.start);
    else if (state.time >= reach.end - 0.05) setMediaTime(reach.start);
    playMedia(media);
    publish({ playing: true });
    clock.start();
  };
  const seek = (seconds: number) => {
    const time = clamp(seconds);
    setMediaTime(time);
    publish({ time });
    paint(time);
    clock.sync();
  };

  return {
    heard,
    reach,
    attachLeader(element) {
      media = element;
      clock.attachLeader(element);
      if (!element) return undefined;
      // The default too: a load resets the rate to it.
      element.defaultPlaybackRate = state.rate;
      element.playbackRate = state.rate;
      element.muted = state.muted;
      element.volume = state.volume;
      const onMetadata = () => {
        seek(state.time);
        if (!playWhenLoaded) return;
        playWhenLoaded = false;
        play();
      };
      // Played to its end, or stalled: settles as a pause does.
      const onPause = () => state.playing && halt();
      element.addEventListener('loadedmetadata', onMetadata);
      element.addEventListener('pause', onPause);
      if (loaded()) onMetadata();
      return () => {
        element.removeEventListener('loadedmetadata', onMetadata);
        element.removeEventListener('pause', onPause);
        if (state.playing) halt();
        media = null;
        clock.attachLeader(null);
      };
    },
    attachRoot(element) {
      root = element;
      paint(timeNow());
    },
    play,
    pause: halt,
    toggle: () => (state.playing ? halt() : play()),
    seek,
    setLoop(loop) {
      publish({ loop });
    },
    cycleRate() {
      const rate = LIBRARY_PLAYBACK_RATES[(LIBRARY_PLAYBACK_RATES.indexOf(state.rate) + 1) % LIBRARY_PLAYBACK_RATES.length];
      if (media) media.defaultPlaybackRate = media.playbackRate = rate;
      publish({ rate });
    },
    setMuted(muted) {
      if (media) media.muted = muted;
      publish({ muted });
    },
    setVolume(volume) {
      const clamped = Math.max(0, Math.min(1, volume));
      if (media) media.volume = clamped;
      // Turning it up is wanting to hear it.
      publish({ volume: clamped, ...(clamped > state.volume && { muted: false }) });
      if (media) media.muted = state.muted;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    timeNow,
    addFollower: clock.addFollower,
    onTick: clock.onTick,
  };
}

/** A settled slice of the playback, re-rendering only when it changes; `select` returns a primitive or a held value. */
export function useLibraryPlaybackState<T>(playback: LibraryItemPlayback, select: (state: LibraryPlaybackState) => T): T {
  return useSyncExternalStore(playback.subscribe, () => select(playback.getState()));
}

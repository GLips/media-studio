// plan-playback.ts: the plan played on its resolved clock before anything renders. The clock is the page's own
// (performance.now()), not any one recording's, since an estimated line has no audio: each recorded clip and the
// grid's music are started, kept in step and stopped as the clock crosses them, and an estimated line plays silent.
//
// Each tick writes the frame into a CSS variable on the page's root, so the playhead and the word being read move with
// no React render; subscribers hear only a play, a pause or a seek.
import { playMedia } from '#web/shared/ui/play-media.ts';
import type { PlanAudio } from './plan-timing.ts';

/** The CSS variable each tick writes the frame into, which the playhead and the lit word read. */
export const PLAN_FRAME_VAR = '--plan-frame';

/** A clip further than this off the clock is put back on it. */
const PLAN_AUDIO_DRIFT_SECONDS = 0.12;

export type PlanPlaybackState = { playing: boolean; frame: number };

export type PlanPlayback = {
  getState: () => PlanPlaybackState;
  subscribe: (listener: () => void) => () => void;
  /** Hears every frame shown while playing, and each seek. */
  onTick: (listener: (frame: number) => void) => () => void;
  frameNow: () => number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (frame: number) => void;
  /** The element the frame variable is written on: the page's root. */
  attachRoot: (element: HTMLElement | null) => void;
  /** What plays and how long the plan runs, re-set whenever it re-times. */
  setProgramme: (programme: { fps: number; end: number; audio: readonly PlanAudio[] }) => void;
  dispose: () => void;
};

type PlanClip = PlanAudio & { element: HTMLAudioElement };

export function createPlanPlayback(): PlanPlayback {
  let state: PlanPlaybackState = { playing: false, frame: 0 };
  let fps = 30, end = 1;
  let clips: PlanClip[] = [];
  let root: HTMLElement | null = null;
  let startedAt = 0, startFrame = 0, raf = 0;
  const listeners = new Set<() => void>();
  const tickers = new Set<(frame: number) => void>();

  const frameNow = () => (state.playing ? Math.min(end, startFrame + ((performance.now() - startedAt) / 1000) * fps) : state.frame);
  const set = (next: PlanPlaybackState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const show = (frame: number) => {
    root?.style.setProperty(PLAN_FRAME_VAR, String(frame));
    for (const ticker of tickers) ticker(frame);
  };

  /** Each clip playing where the clock is over it, at its place in it; the rest paused. */
  const steer = (frame: number, playing: boolean) => {
    const seconds = frame / fps;
    for (const clip of clips) {
      const into = seconds - clip.atSeconds;
      const over = playing && into >= 0 && into < clip.duration;
      if (!over) {
        if (!clip.element.paused) clip.element.pause();
        continue;
      }
      if (Math.abs(clip.element.currentTime - into) > PLAN_AUDIO_DRIFT_SECONDS) clip.element.currentTime = into;
      if (clip.element.paused) playMedia(clip.element);
    }
  };

  const tick = () => {
    const frame = frameNow();
    if (frame >= end) {
      pause();
      return;
    }
    steer(frame, true);
    show(frame);
    raf = requestAnimationFrame(tick);
  };

  function pause() {
    if (!state.playing) return;
    cancelAnimationFrame(raf);
    const frame = Math.floor(frameNow());
    steer(frame, false);
    set({ playing: false, frame });
    show(frame);
  }

  const play = () => {
    if (state.playing) return;
    // From the start again once it has played to its end.
    startFrame = state.frame >= end - 1 ? 0 : state.frame;
    startedAt = performance.now();
    set({ playing: true, frame: startFrame });
    raf = requestAnimationFrame(tick);
  };

  const seek = (frame: number) => {
    const to = Math.max(0, Math.min(end - 1, Math.round(frame)));
    if (state.playing) {
      startFrame = to;
      startedAt = performance.now();
      steer(to, true);
    }
    set({ ...state, frame: to });
    show(to);
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onTick: (ticker) => {
      tickers.add(ticker);
      return () => tickers.delete(ticker);
    },
    frameNow,
    play,
    pause,
    toggle: () => (state.playing ? pause() : play()),
    seek,
    attachRoot: (element) => {
      root = element;
      show(frameNow());
    },
    setProgramme: (programme) => {
      fps = programme.fps;
      end = Math.max(1, programme.end);
      const kept = new Map(clips.map((c) => [`${c.src}@${c.atSeconds}`, c]));
      clips = programme.audio.map((audio) => {
        const same = kept.get(`${audio.src}@${audio.atSeconds}`);
        kept.delete(`${audio.src}@${audio.atSeconds}`);
        return same ? { ...audio, element: same.element } : { ...audio, element: Object.assign(new Audio(audio.src), { preload: 'auto' }) };
      });
      for (const gone of kept.values()) gone.element.pause();
      if (state.frame > end - 1) seek(end - 1);
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      for (const clip of clips) clip.element.pause();
    },
  };
}

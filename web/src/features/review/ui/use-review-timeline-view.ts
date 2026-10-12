// use-review-timeline-view.ts: the dock's zoom and scroll, kept per clock rather than in the dock, so the transport's
// stage-edge playhead reads the same view the lanes are drawn in.
import { useHotkeys } from '@tanstack/react-hotkeys';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  reviewTimelineFit, reviewTimelineRelengthed, reviewTimelineResized, reviewTimelineScrolledBy, reviewTimelineShowing,
  reviewTimelineXOf, reviewTimelineZoomedAt, type ReviewTimelineView,
} from '#lib/output/review/models/review-timeline-geometry.ts';
import { useLinkedMediaTick } from '#web/shared/ui/linked-media-clock.ts';
import { useReviewDockHover, type ReviewDockHover } from './review-hover-preview.tsx';
import { useReviewPlaybackState, type ReviewPlayback } from './review-playback-store.ts';

type ReviewTimelineViewStore = {
  get: () => ReviewTimelineView;
  set: (change: (view: ReviewTimelineView) => ReviewTimelineView) => void;
  subscribe: (listener: () => void) => () => void;
};

/** One view per screen's clock: a WeakMap, so it goes when the screen does. */
const reviewTimelineViews = new WeakMap<ReviewPlayback, ReviewTimelineViewStore>();

function reviewTimelineViewStoreOf(playback: ReviewPlayback): ReviewTimelineViewStore {
  const known = reviewTimelineViews.get(playback);
  if (known) return known;
  let view = reviewTimelineFit(playback.getState().durationInFrames, 1);
  const listeners = new Set<() => void>();
  const store: ReviewTimelineViewStore = {
    get: () => view,
    set(change) {
      const next = change(view);
      if (next === view) return;
      view = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  reviewTimelineViews.set(playback, store);
  return store;
}

/** The view the dock's lanes are drawn in, re-rendering on a zoom, a scroll or a resize. */
export function useReviewTimelineView(playback: ReviewPlayback): ReviewTimelineView {
  const store = reviewTimelineViewStoreOf(playback);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** How much a Mod+wheel's pixel of travel zooms, as a power: a trackpad pinch and a mouse notch both feel even. */
const REVIEW_TIMELINE_WHEEL_ZOOM = 0.004;
/** How far one press of `=` or `-` zooms. */
const REVIEW_TIMELINE_ZOOM_STEP = 2;

export type ReviewTimelineViewport = {
  view: ReviewTimelineView;
  /** A ref callback for the lanes' box: its width is the view's, and Mod+wheel over it zooms. */
  attachLanes: (lanes: HTMLElement | null) => void;
  /** The lanes' box, for turning a pointer into an x. */
  lanes: HTMLElement | null;
  setView: (change: (view: ReviewTimelineView) => ReviewTimelineView) => void;
  /** Where the pointer rests over the lanes. */
  hover: ReviewDockHover;
};

/**
 * Drives the view: its width follows the lanes' box, its length the clock's, Mod+wheel zooms at the pointer and a
 * plain wheel scrolls, `=` `-` `0` zoom at the playhead, and while playing it turns the page whenever the playhead
 * runs off the lanes. It tracks where the pointer rests over the lanes, for the ghost and the ruler.
 */
export function useReviewTimelineViewport(playback: ReviewPlayback): ReviewTimelineViewport {
  const store = reviewTimelineViewStoreOf(playback);
  const view = useReviewTimelineView(playback);
  const [lanes, attachLanes] = useState<HTMLElement | null>(null);
  const durationInFrames = useReviewPlaybackState(playback, (s) => s.durationInFrames);
  const playing = useReviewPlaybackState(playback, (s) => s.playing);

  useEffect(() => store.set((v) => reviewTimelineRelengthed(v, durationInFrames)), [store, durationInFrames]);

  useEffect(() => {
    if (!lanes) return undefined;
    const observer = new ResizeObserver(([entry]) => store.set((v) => reviewTimelineResized(v, entry.contentRect.width)));
    observer.observe(lanes);
    // Not passive: Mod+wheel must not zoom the page as well.
    const onWheel = (event: WheelEvent) => {
      const x = event.clientX - lanes.getBoundingClientRect().left;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        store.set((v) => reviewTimelineZoomedAt(v, v.zoom * Math.exp(-event.deltaY * REVIEW_TIMELINE_WHEEL_ZOOM), x));
        return;
      }
      const across = event.shiftKey ? event.deltaY : event.deltaX;
      if (store.get().zoom === 1 || !across) return;
      event.preventDefault();
      store.set((v) => reviewTimelineScrolledBy(v, across));
    };
    lanes.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      observer.disconnect();
      lanes.removeEventListener('wheel', onWheel);
    };
  }, [lanes, store]);

  useLinkedMediaTick(playback, (frame) => {
    if (store.get().zoom > 1) store.set((v) => reviewTimelineShowing(v, frame));
  }, playing);

  // At the playhead when it's in view, else at the middle.
  const zoomBy = useCallback((factor: number) => store.set((v) => {
    const frame = playback.frameNow();
    const at = reviewTimelineShowing(v, frame) === v ? reviewTimelineXOf(v, frame + 0.5) : v.width / 2;
    return reviewTimelineZoomedAt(v, v.zoom * factor, at);
  }), [playback, store]);
  const fit = useCallback(() => store.set((v) => reviewTimelineFit(v.durationInFrames, v.width)), [store]);
  useHotkeys([
    { hotkey: '=', callback: () => zoomBy(REVIEW_TIMELINE_ZOOM_STEP), options: { meta: { group: 'timeline', name: 'Zoom in' } } },
    { hotkey: '-', callback: () => zoomBy(1 / REVIEW_TIMELINE_ZOOM_STEP), options: { meta: { group: 'timeline', name: 'Zoom out' } } },
    { hotkey: '0', callback: fit, options: { meta: { group: 'timeline', name: 'Fit timeline' } } },
  ]);
  const hover = useReviewDockHover(lanes);

  return { view, attachLanes, lanes, setView: store.set, hover };
}

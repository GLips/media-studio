// screen-rect.ts: where a live DOM element sits in the frame, so overlays can point at components a scene lays out
// itself, the way they point at a capture's rects through a view.

import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { useCurrentFrame, useDelayRender } from 'remotion';
import type { Rect } from '#models/camera/camera.ts';
import { areStudioFontsLoaded, whenStudioFontsLoaded } from './fonts.ts';
import { W } from '#models/frame/frame.ts';

const laidOut = (el: Element) => areStudioFontsLoaded() && document.fonts.status === 'loaded' && el.getBoundingClientRect().width > 0;

/**
 * Resolves once fonts are loaded and `el` has a size. Remotion first renders a composition into a detached node and
 * attaches it after the first commit, so layout effects on a tab's first frame measure a 0×0 frame; nothing re-renders
 * when it's attached, so whatever measures must wait for this.
 */
export function whenLaidOut(el: Element): Promise<void> {
  return Promise.all([whenStudioFontsLoaded(), document.fonts.ready]).then(() => new Promise<void>((resolve) => {
    if (laidOut(el)) return resolve();
    const observer = new ResizeObserver(() => {
      if (el.getBoundingClientRect().width === 0) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(el);
  }));
}

const sceneLayerOf = (el: Element) => {
  const layer = el.closest('[data-scene]');
  if (!layer) throw new Error('useScreenRect measures elements inside a scene');
  return layer;
};

/** An element's bounding box in composition pixels, against the scene layer it's drawn in; null before layout. */
function compositionRectOf(el: Element): Rect | null {
  // The scene layer is the full frame, so its on-screen box carries both the Studio preview's scale and its origin.
  const box = sceneLayerOf(el).getBoundingClientRect(), r = el.getBoundingClientRect();
  if (box.width === 0) return null;
  const scale = box.width / W;
  return { x: (r.left - box.left) / scale, y: (r.top - box.top) / scale, w: r.width / scale, h: r.height / scale };
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01);

/**
 * Where `target` is on screen this frame, in composition pixels (1920×1080) whatever the preview's zoom, with every
 * ancestor transform applied: the rect a Highlight, Spotlight or cursor takes. Null while the element isn't in the
 * DOM. Draw what uses it in the scene's own coordinates, outside any transformed wrapper.
 *
 * With `selector`, it's the first element matching it inside `target`: for one a component renders itself, which
 * hands out no ref, e.g. `useScreenRect(laneRef, '[aria-label="Retry webhooks"]')`.
 *
 * Measured after every commit; state set in a layout effect re-renders before paint, so the rect always belongs to
 * the frame on screen however frames are visited. Before layout is final (see whenLaidOut) the frame is held and
 * re-measured. Layout that shifts later without a re-render (an unsized image loading) isn't seen.
 */
export function useScreenRect(target: RefObject<Element | null>, selector?: string): Rect | null {
  // Re-render, and so re-measure, on every frame, even if nothing the caller passes down changes.
  useCurrentFrame();
  const [rect, setRect] = useState<Rect | null>(null);
  const { delayRender, continueRender } = useDelayRender();
  const measure = useCallback(() => {
    const el = selector ? target.current?.querySelector(selector) : target.current;
    const next = el ? compositionRectOf(el) : null;
    setRect((prev) => (sameRect(prev, next) ? prev : next));
  }, [target, selector]);

  useLayoutEffect(() => {
    measure();
    const layer = target.current && sceneLayerOf(target.current);
    if (!layer || laidOut(layer)) return;
    const handle = delayRender('measuring a screen rect once layout is final');
    let open = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    whenLaidOut(layer).then(() => {
      // Committed synchronously, so the framing probe (which waits a task past whenLaidOut) sees the new rect.
      if (open) flushSync(measure);
      release();
    });
    return release;
  });

  return rect;
}

// stamp-painting.tsx: a stamp painting in a scene. It holds the frame until every image the painting uses is on the
// GPU, then draws the painting as it stands at the scene's time (stamp-paint-renderer.ts, WebGPU), and destroys its GPU
// device when it unmounts. A frame is held until WebGPU has checked its draw for errors, never for the drawing itself:
// the screenshot waits for the GPU.
//
// Compile the recipe once, where the scene is defined, not while it renders: a painting that is a new object each
// frame is loaded afresh each frame.

import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDelayRender } from 'remotion';
import { fullFrameRect } from '#lib/picture/frame/models/frame.ts';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';
import { unmeasuredAttrs } from '#lib/picture/measurement/studio/motion-tag.ts';
import { useFrameProfile } from '#lib/picture/profiling/studio/frame-profile.ts';
import type { CompiledStampPaint } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import { createStampPaintRenderer, type StampPaintRenderer } from '#lib/picture/stamp-paint/studio/stamp-paint-renderer.ts';
import type { ResolvedStampPaintStyle } from '../models/style.ts';
import { stampPaintAssetUrl } from './stamp-paint-styles.ts';

/**
 * Draws `painting` in `style` (on its paper, its paint mixed as it mixes) as it stands `t` seconds in (a scene's `s.t`: its deposits' `appliedAt` and `drawnOver`
 * count on it), `width` by `height` of its own pixels (the frame's size unless given), stretched over `box` (the whole
 * frame unless given).
 */
export function StampPainting({ painting, style: { paper, mixing }, t, width, height, box: given }: {
  painting: CompiledStampPaint;
  style: Pick<ResolvedStampPaintStyle, 'paper' | 'mixing'>;
  t: number;
  width?: number;
  height?: number;
  box?: { x: number; y: number; w: number; h: number };
}) {
  const format = useVideoFormat();
  const box = given ?? fullFrameRect(format);
  const w = Math.round(width ?? box.w), h = Math.round(height ?? box.h);
  const holder = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState<StampPaintRenderer | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const profile = useFrameProfile();

  // Each renderer gets a canvas of its own, made here and removed with it, so a renderer still loading when its
  // painting changes never shares a canvas with the next.
  useLayoutEffect(() => {
    const handle = delayRender('loading the stamp painting\'s images onto the GPU');
    let open = true, live = true, made: StampPaintRenderer | null = null;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    holder.current!.append(canvas);
    const loaded = profile?.('stamp paint load');
    createStampPaintRenderer(canvas, painting, paper, mixing, w, h, stampPaintAssetUrl).then((ready) => {
      loaded?.();
      made = ready;
      if (!live) return ready.dispose();
      flushSync(() => setRenderer(ready));
      return release();
    }, cancelRender);
    return () => {
      live = false;
      made?.dispose();
      canvas.remove();
      setRenderer(null);
      release();
    };
  }, [painting, paper, mixing, w, h, profile, delayRender, continueRender, cancelRender]);

  useLayoutEffect(() => {
    if (!renderer) return;
    const handle = delayRender('checking the stamp painting drew without a GPU error');
    const drawn = profile?.('stamp paint');
    const checked = renderer.draw(t);
    // Profiling also holds the frame until the GPU is done, to time the drawing rather than its queueing.
    (drawn ? checked.then(() => renderer.finish()).then(drawn) : checked).then(() => continueRender(handle), cancelRender);
  }, [renderer, t, profile, delayRender, continueRender, cancelRender]);

  return <div ref={holder} {...unmeasuredAttrs('stamp painting')} style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }} />;
}

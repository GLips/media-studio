// stamp-painting.tsx: a stamp painting in a scene. It holds the frame until the painting is on the GPU, then draws it
// as it stands at the scene's time (stamp-paint-renderer.ts, WebGPU). Its surface (stamp-paint-surface.ts: the device,
// images, pipelines, targets) lasts while it's mounted at one size. A frame is held until WebGPU has checked its draw
// for errors, never for the drawing itself: the screenshot waits for the GPU.
//
// A new painting object loads anew, with no checkpoints: a group that moves, boils, recolours, bends or is drawn live
// does so within one painting, through `frame` (its frame state), which reloads nothing. A style is held by its
// content, so one resolved anew each render loads nothing again.

import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDelayRender } from 'remotion';
import { fullFrameRect } from '#lib/picture/frame/models/frame.ts';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';
import { unmeasuredAttrs } from '#lib/picture/measurement/studio/motion-tag.ts';
import { useFrameProfile } from '#lib/picture/profiling/studio/frame-profile.ts';
import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { createStampPaintRenderer, type StampPaintRenderer } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { createStampPaintSurface, type StampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import type { ResolvedStampPaintStyle } from '../models/style.ts';
import { stampPaintAssetUrl } from './stamp-paint-styles.ts';

/**
 * Draws `painting` in `style` (its paper and mixing) as it stands `t` seconds in (a scene's `s.t`), each group in
 * `frame`'s state, `width` by `height` of its own pixels (the frame's size unless given), stretched over `box` (the
 * whole frame unless given). `margin`: even px of stage past each side (stamp-stage.ts), as far as lays bring in.
 */
export function StampPainting({ painting, style, t, frame, width, height, margin = 0, box: given }: {
  painting: CompiledStampPaint;
  style: Pick<ResolvedStampPaintStyle, 'paper' | 'mixing'>;
  t: number;
  frame?: StampPaintFrameState;
  width?: number;
  height?: number;
  margin?: number;
  box?: { x: number; y: number; w: number; h: number };
}) {
  const paper = useStampStyleContent(style.paper), mixing = useStampStyleContent(style.mixing);
  const format = useVideoFormat();
  const box = given ?? fullFrameRect(format);
  const w = Math.round(width ?? box.w), h = Math.round(height ?? box.h);
  const holder = useRef<HTMLDivElement>(null);
  const [surface, setSurface] = useState<StampPaintSurface | null>(null);
  const [renderer, setRenderer] = useState<StampPaintRenderer | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const profile = useFrameProfile();

  // Each surface gets a canvas of its own, made here and removed with it, so a surface still loading when the size
  // changes never shares a canvas with the next.
  useLayoutEffect(() => {
    const handle = delayRender('making the stamp painting\'s GPU surface');
    let open = true, live = true, made: StampPaintSurface | null = null;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    holder.current!.append(canvas);
    const loaded = profile?.('stamp paint surface load');
    createStampPaintSurface({ canvas, width: w, height: h }, stampPaintAssetUrl).then((ready) => {
      loaded?.();
      made = ready;
      if (!live) return ready.dispose();
      // Set within the hold, so the painting's load holds the frame before this one lets it go.
      flushSync(() => setSurface(ready));
      return release();
    }, cancelRender);
    return () => {
      live = false;
      made?.dispose();
      canvas.remove();
      setSurface(null);
      release();
    };
  }, [w, h, profile, delayRender, continueRender, cancelRender]);

  useLayoutEffect(() => {
    if (!surface) return undefined;
    const handle = delayRender('loading the stamp painting onto the GPU');
    let open = true, live = true, made: StampPaintRenderer | null = null;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    const loaded = profile?.('stamp paint load');
    // A load given up as its surface goes may fail for want of the device; only a live one's failure is the frame's.
    createStampPaintRenderer(surface, painting, paper, mixing, { profile, margin }).then((ready) => {
      loaded?.();
      made = ready;
      if (!live) return ready.dispose();
      flushSync(() => setRenderer(ready));
      return release();
    }, (error: Error) => {
      if (live) cancelRender(error);
    });
    return () => {
      live = false;
      made?.dispose();
      setRenderer(null);
      release();
    };
  }, [surface, painting, paper, mixing, margin, profile, delayRender, continueRender, cancelRender]);

  useLayoutEffect(() => {
    if (!renderer) return;
    const handle = delayRender('checking the stamp painting drew without a GPU error');
    const drawn = profile?.('stamp paint');
    const checked = renderer.draw(t, frame);
    // Profiling also holds the frame until the GPU is done, to time the drawing rather than its queueing.
    (drawn ? checked.then(() => renderer.finish()).then(drawn) : checked).then(() => continueRender(handle), cancelRender);
  }, [renderer, t, frame, profile, delayRender, continueRender, cancelRender]);

  return <div ref={holder} {...unmeasuredAttrs('stamp painting')} style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }} />;
}

/**
 * `value`, or the first equal one this painting was given: a reload throws away the renderer's checkpoints, so a
 * new-but-equal paper or mixing mustn't cause one. Equal by their JSON, as a style's paper and mixing are plain data.
 */
export function useStampStyleContent<T>(value: T): T {
  const content = JSON.stringify(value);
  const [kept, setKept] = useState({ content, value });
  if (kept.content === content) return kept.value;
  setKept({ content, value });
  return value;
}

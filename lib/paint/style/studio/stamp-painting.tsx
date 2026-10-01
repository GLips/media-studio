// stamp-painting.tsx: a stamp painting in a scene, its planes seen through a camera and three.js among them. It holds
// the frame until the painting is on the GPU, then draws it at the scene's time (stamp-paint-renderer.ts). Its device's
// owner (stamp-paint-gpu-owner.ts) and canvas last while it's mounted at one size. A frame is held until WebGPU has
// checked its draw for errors, never for the drawing itself: the screenshot waits for the GPU.
//
// A new painting, camera or three object loads anew, nothing kept: a group that moves, boils, recolours, bends or is
// drawn live does so within one painting, through `frame`, which reloads nothing.
// The painting carries its paper and mixing, as its recipe was written against them.

import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDelayRender } from 'remotion';
import { fullFrameRect } from '#lib/picture/frame/models/frame.ts';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';
import { unmeasuredAttrs } from '#lib/picture/measurement/studio/motion-tag.ts';
import { useFrameProfile } from '#lib/picture/profiling/studio/frame-profile.ts';
import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { paintCameraLensAt, type PaintCamera } from '#lib/paint/animation/models/paint-camera.ts';
import { createStampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintRenderer, type StampPaintRenderer } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { createStampPaintSurface, type StampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { loadPaintedThree, type PaintedThree, type PaintedThreeLoaded } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import { stampPaintAssetUrl } from './stamp-paint-styles.ts';

/**
 * Draws `painting` at `t` seconds (a scene's `s.t`), each group in `frame`'s state, `width` by `height` pixels (the
 * frame's size unless given), over `box` (the whole frame unless given). `camera` (buildPaintCamera): its planes on a
 * stage whose frame is those pixels; without one, one plane at rest. `three`: a source per three plane. Memoise both.
 */
export function StampPainting({ painting, t, frame, camera, three, width, height, box: given }: {
  painting: CompiledStampPaint;
  t: number;
  frame?: StampPaintFrameState;
  camera?: PaintCamera;
  three?: PaintedThree;
  width?: number;
  height?: number;
  box?: { x: number; y: number; w: number; h: number };
}) {
  const format = useVideoFormat();
  const box = given ?? fullFrameRect(format);
  const w = Math.round(width ?? box.w), h = Math.round(height ?? box.h);
  if (camera && (camera.stage.frame.width !== w || camera.stage.frame.height !== h)) {
    throw new Error(`stamp painting: its camera's frame is ${camera.stage.frame.width} × ${camera.stage.frame.height}, and its pixels ${w} × ${h}`);
  }
  if (three && !camera) throw new Error('stamp painting: three.js sources are planes of a camera, and it has none');
  const holder = useRef<HTMLDivElement>(null);
  const [surface, setSurface] = useState<StampPaintSurface | null>(null);
  const [loaded, setLoaded] = useState<{ renderer: StampPaintRenderer; three: PaintedThreeLoaded | null } | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const profile = useFrameProfile();

  // Each surface gets a device owner and a canvas of its own, made here and let go of with it, so a surface still
  // loading when the size changes never shares a canvas with the next.
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
    const timedSurface = profile?.('stamp paint surface load');
    const owning = createStampPaintGpuOwner(stampPaintAssetUrl);
    owning.then((owner) => createStampPaintSurface(owner, { canvas, width: w, height: h })).then((ready) => {
      timedSurface?.();
      made = ready;
      if (!live) return disposeSurface(ready);
      // Set within the hold, so the painting's load holds the frame before this one lets it go.
      flushSync(() => setSurface(ready));
      return release();
    }, cancelRender);
    return () => {
      live = false;
      if (made) disposeSurface(made);
      // An owner whose surface never came is let go of once it does.
      else void owning.then((owner) => owner.dispose(), () => {});
      canvas.remove();
      setSurface(null);
      release();
    };
  }, [w, h, profile, delayRender, continueRender, cancelRender]);

  useLayoutEffect(() => {
    if (!surface) return undefined;
    const handle = delayRender('loading the stamp painting onto the GPU');
    let open = true, live = true, madeThree: PaintedThreeLoaded | null = null, made: StampPaintRenderer | null = null;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    const letGo = () => {
      made?.dispose();
      madeThree?.dispose();
    };
    const timedLoad = profile?.('stamp paint load');
    // A load given up as its surface goes may fail for want of the device; only a live one's failure is the frame's.
    (async () => {
      madeThree = three ? await loadPaintedThree(surface.owner, camera!, three, profile) : null;
      const stage = camera?.stage ?? stampStage({ width: surface.width, height: surface.height });
      made = await createStampPaintRenderer(surface, painting, { profile, stage, planes: camera?.planes, three: madeThree?.textures });
    })().then(() => {
      timedLoad?.();
      if (!live) return letGo();
      flushSync(() => setLoaded({ renderer: made!, three: madeThree }));
      return release();
    }, (error: Error) => {
      if (live) cancelRender(error);
    });
    return () => {
      live = false;
      letGo();
      setLoaded(null);
      release();
    };
  }, [surface, painting, camera, three, profile, delayRender, continueRender, cancelRender]);

  useLayoutEffect(() => {
    if (!loaded) return;
    const { renderer, three: threeLoaded } = loaded;
    const handle = delayRender('checking the stamp painting drew without a GPU error');
    const drawn = profile?.('stamp paint');
    const lens = camera && paintCameraLensAt(camera, t);
    const checked = (threeLoaded ? threeLoaded.render(t) : Promise.resolve()).then(() => renderer.draw({ t, state: frame, lens }));
    // Profiling also holds the frame until the GPU is done, to time the drawing rather than its queueing.
    (drawn ? checked.then(() => renderer.finish()).then(drawn) : checked).then(() => continueRender(handle), cancelRender);
  }, [loaded, camera, t, frame, profile, delayRender, continueRender, cancelRender]);

  return <div ref={holder} {...unmeasuredAttrs('stamp painting')} style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }} />;
}

/** Lets go of `surface`'s canvas, then its owner. */
function disposeSurface(surface: StampPaintSurface) {
  surface.dispose();
  surface.owner.dispose();
}

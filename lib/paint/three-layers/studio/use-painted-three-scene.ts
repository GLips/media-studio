import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDelayRender } from 'remotion';
import { useFrameProfile } from '#lib/picture/profiling/studio/frame-profile.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { loadPaintedThreeScene, type PaintedThreeFrame, type PaintedThreeScene, type PaintedThreeSpec } from './painted-three-gpu.ts';

/**
 * Loads `spec` into a canvas in the returned holder, the frame held through the load (three's compileAsync among it),
 * then draws `frame` into it, each frame held until it's drawn and checked. Any new part of `spec` loads it anew, so
 * a scene memoises its layers and textures.
 */
export function usePaintedThreeScene(spec: PaintedThreeSpec, { t, frame, camera }: PaintedThreeFrame) {
  const holder = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<PaintedThreeScene | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const profile = useFrameProfile();
  const { painting, style, stage, fov, threeLayers, paintedTextures } = spec;
  const { frame: { width, height }, margin } = stage;

  useLayoutEffect(() => {
    const handle = delayRender('loading the painted three.js scene: one device, its paintings and three.js');
    let open = true, live = true, ready: PaintedThreeScene | null = null;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    holder.current!.append(canvas);
    const timedLoad = profile?.('painted three load');
    loadPaintedThreeScene(canvas, { painting, style, stage: stampStage({ width, height }, margin), fov, threeLayers, paintedTextures }, profile).then((scene) => {
      timedLoad?.();
      ready = scene;
      if (!live) return scene.dispose();
      // Set within the hold, so the first frame's draw holds the frame before this lets it go.
      flushSync(() => setLoaded(scene));
      return release();
    }, (error: Error) => {
      if (live) cancelRender(error);
    });
    return () => {
      live = false;
      ready?.dispose().catch(cancelRender);
      canvas.remove();
      setLoaded(null);
      release();
    };
  }, [painting, style, width, height, margin, fov, threeLayers, paintedTextures, profile, delayRender, continueRender, cancelRender]);

  useLayoutEffect(() => {
    if (!loaded) return;
    const handle = delayRender('drawing the painted three.js scene and checking it for GPU errors');
    loaded.draw({ t, frame, camera }).then(() => continueRender(handle), cancelRender);
  }, [loaded, t, frame, camera, delayRender, continueRender, cancelRender]);

  return holder;
}

// stamp-painting.tsx: a stamp painting in a scene, its planes seen through a camera and three.js among them. It holds
// the frame until the painting is on the GPU, then until WebGPU has checked each draw for errors (never for the
// drawing itself: the screenshot waits for the GPU).
//
// Each StampPainting owns its own device (stamp-paint-gpu-owner.ts) and canvas while mounted at one size: two
// paintings on screen hold two devices and two GPU cache budgets. A new painting, camera or three object loads anew;
// what changes within one painting goes through `frameAt`. In the reference lens mode (lens-mode.ts) a painting with a
// camera draws each frame as exposures over its shutter and aperture.

import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDelayRender } from 'remotion';
import { fullFrameRect } from '#lib/picture/frame/models/frame.ts';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';
import { unmeasuredAttrs } from '#lib/picture/measurement/studio/motion-tag.ts';
import { useFrameProfile, type FrameProfileStart } from '#lib/picture/profiling/studio/frame-profile.ts';
import { paintMoment, type StampPaintFrameAt } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { lensExposures } from '#lib/picture/lens/models/lens-exposures.ts';
import { LENS_REFERENCE_EXPOSURES, type LensMode } from '#lib/picture/lens/models/lens-mode.ts';
import { shutterMomentAt, shutterOpensAt } from '#lib/picture/lens/models/lens-shutter.ts';
import { useLensMode } from '#lib/picture/lens/studio/lens-mode-context.ts';
import { paintCameraLensAt, type PaintCamera } from '#lib/paint/animation/models/paint-camera.ts';
import type { StampPaintingCamera } from '#lib/paint/animation/models/paint-camera-build.ts';
import { createStampPaintGpuOwner, type StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintRenderer, type StampPaintFrame, type StampPaintRenderer } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { createStampPaintSurface, type StampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { loadPaintedThree, type PaintedThree, type PaintedThreeLoaded } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import { stampPaintAssetUrl } from './stamp-paint-styles.ts';

/**
 * Draws `painting` at `t` seconds (a scene's `s.t`), each group in `frameAt(t)`'s state (other moments too, in the
 * reference lens mode), `width` by `height` px (the frame's unless given), over `box` (the whole frame unless given).
 * `camera` (buildPaintingCamera): its planes on a stage of those px; without one, one plane at rest. `three`: a
 * source per three plane. Memoise both.
 */
export function StampPainting({ painting, t, frameAt, camera: painted, three, width, height, box: given }: {
  painting: CompiledStampPaint;
  t: number;
  frameAt?: StampPaintFrameAt;
  camera?: StampPaintingCamera;
  three?: PaintedThree;
  width?: number;
  height?: number;
  box?: { x: number; y: number; w: number; h: number };
}) {
  const format = useVideoFormat();
  const box = given ?? fullFrameRect(format);
  const w = Math.round(width ?? box.w), h = Math.round(height ?? box.h), camera = painted?.camera;
  if (camera && (camera.stage.frame.width !== w || camera.stage.frame.height !== h)) {
    throw new Error(`stamp painting: its camera's frame is ${camera.stage.frame.width} × ${camera.stage.frame.height}, and its pixels ${w} × ${h}`);
  }
  if (three && !camera) throw new Error('stamp painting: three.js sources are planes of a camera, and it has none');
  const holder = useRef<HTMLDivElement>(null);
  const [gpu, setGpu] = useState<StampPaintingGpu | null>(null);
  const [scene, setScene] = useState<StampPaintingScene | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const profile = useFrameProfile();
  const lensMode = useLensMode();

  // Each size gets a device and a canvas of its own, made here and let go of with it, so a device still loading when
  // the size changes never shares a canvas with the next.
  useLayoutEffect(() => {
    const handle = delayRender('making the stamp painting\'s GPU surface');
    let open = true, live = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    holder.current!.append(canvas);
    const timedSurface = profile?.('stamp paint surface load');
    const making = createStampPaintingGpu(canvas, w, h);
    making.then((ready) => {
      timedSurface?.();
      if (!live) return undefined;
      // Set within the hold, so the painting's load holds the frame before this one lets it go.
      flushSync(() => setGpu(ready));
      return release();
    }, (error: Error) => {
      if (live) cancelRender(error);
    });
    return () => {
      live = false;
      void making.then((made) => made.dispose(), () => {});
      canvas.remove();
      setGpu(null);
      release();
    };
  }, [w, h, profile, delayRender, continueRender, cancelRender]);

  useLayoutEffect(() => {
    if (!gpu) return undefined;
    const handle = delayRender('loading the stamp painting onto the GPU');
    let open = true, live = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    const timedLoad = profile?.('stamp paint load');
    const loading = gpu.loadScene({ painting, camera: painted, three, profile });
    // A load given up as its device goes may fail for want of the device; only a live one's failure is the frame's.
    loading.ready.then(() => {
      timedLoad?.();
      if (!live) return undefined;
      flushSync(() => setScene(loading));
      return release();
    }, (error: Error) => {
      if (live) cancelRender(error);
    });
    return () => {
      live = false;
      void loading.dispose();
      setScene(null);
      release();
    };
  }, [gpu, painting, painted, three, profile, delayRender, continueRender, cancelRender]);

  useLayoutEffect(() => {
    if (!scene) return undefined;
    const handle = delayRender('checking the stamp painting drew without a GPU error');
    let open = true, live = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    const drawn = profile?.('stamp paint');
    // Profiling also holds the frame until the GPU is done, to time the drawing rather than its queueing.
    scene.draw(stampPaintingFrames(t, frameAt, camera, lensMode), { untilGpuDone: Boolean(drawn) }).then(() => {
      drawn?.();
      return release();
    }, (error: Error) => {
      // A frame overtaken by new props or an unmount may fail as its scene goes; only a live frame's failure counts.
      if (live) cancelRender(error);
    });
    return () => {
      live = false;
      release();
    };
  }, [scene, camera, t, frameAt, lensMode, profile, delayRender, continueRender, cancelRender]);

  return <div ref={holder} {...unmeasuredAttrs('stamp painting')} style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }} />;
}

/**
 * The draws of the frame at `t`: through `camera`'s lens once, its groups posed as its shutter opens and closes too,
 * or in the reference mode, its exposures over the shutter (centred on `t`) and aperture. A painting with no camera
 * has no lens to expose through, and draws once as painted either way.
 */
function stampPaintingFrames(t: number, frameAt: StampPaintFrameAt | undefined, camera: PaintCamera | undefined, mode: LensMode): readonly StampPaintFrame[] {
  const state = frameAt?.(paintMoment(t));
  if (!camera) return [{ kind: 'once', t, state }];
  const { shutter } = camera.lens;
  if (mode === 'fast') {
    const posedAt = (at: number) => ({ at, state: frameAt?.(paintMoment(at, t)) }), open = shutterOpensAt(t, shutter);
    return [{ kind: 'fast', t, state, lens: paintCameraLensAt(camera, t), shutter: shutter > 0 ? { open: posedAt(open), close: posedAt(open + shutter) } : null }];
  }
  return lensExposures(LENS_REFERENCE_EXPOSURES).map(({ index, count, shutter: share, aperture }) => {
    const at = shutterMomentAt(t, shutter, share);
    return { kind: 'exposure', t, state, lens: paintCameraLensAt(camera, t, { at, aperture }), exposure: { index, count, at, aperture, state: frameAt?.(paintMoment(at, t)) } };
  });
}

/**
 * A StampPainting's device and canvas, and every scene loaded on them. Its dispose disposes its scenes first, then
 * the canvas, then the device, as the owner's contract asks, whichever of the component's effects lets go first.
 */
type StampPaintingGpu = {
  loadScene: (load: StampPaintingSceneLoad) => StampPaintingScene;
  dispose: () => Promise<void>;
};

type StampPaintingSceneLoad = { painting: CompiledStampPaint; camera?: StampPaintingCamera; three?: PaintedThree; profile: FrameProfileStart | null };

/** A painting and its three.js loaded on a StampPaintingGpu, drawn a frame at a time. */
type StampPaintingScene = {
  /** Resolves once loaded, or rejects with the load's error. */
  ready: Promise<void>;
  /**
   * Draws a frame's `frames` (its exposures, or itself once), one after another, as one task after every earlier one;
   * with `untilGpuDone`, also waits for the GPU to finish. A no-op once disposed.
   */
  draw: (frames: readonly StampPaintFrame[], options: { untilGpuDone: boolean }) => Promise<void>;
  /** Takes no more draws, waits out the load and the draws queued, then lets go of the renderer and three.js. */
  dispose: () => Promise<void>;
};

/** A device of its own and `canvas`, `width` × `height`, configured on it. */
async function createStampPaintingGpu(canvas: HTMLCanvasElement, width: number, height: number): Promise<StampPaintingGpu> {
  const owner = await createStampPaintGpuOwner(stampPaintAssetUrl);
  let surface: StampPaintSurface;
  try {
    surface = await createStampPaintSurface(owner, { canvas, width, height });
  } catch (error) {
    owner.dispose();
    throw error;
  }
  const scenes = new Set<StampPaintingScene>();
  let disposing: Promise<void> | null = null;
  return {
    loadScene: (load) => {
      if (disposing) throw new Error('stamp painting: a scene loaded on a disposed GPU');
      const scene = loadStampPaintingScene(owner, surface, load);
      scenes.add(scene);
      // Kept until its drain is done, so a dispose here meanwhile still waits for it.
      return { ...scene, dispose: () => scene.dispose().then(() => void scenes.delete(scene)) };
    },
    dispose: () => {
      disposing ??= Promise.all([...scenes].map((scene) => scene.dispose())).then(() => {
        surface.dispose();
        return owner.dispose();
      });
      return disposing;
    },
  };
}

/**
 * Loads `painting` and `three` on `owner`'s device, drawing to `surface`. Its tasks, the load first, run one at a time:
 * three's source textures and the painted ones are shared by every frame, so two frames at once would overwrite each
 * other's before the earlier composite read them.
 */
function loadStampPaintingScene(owner: StampPaintGpuOwner, surface: StampPaintSurface, { painting, camera, three, profile }: StampPaintingSceneLoad): StampPaintingScene {
  let madeThree: PaintedThreeLoaded | null = null, made: StampPaintRenderer | null = null, disposed = false;
  const ready = (async () => {
    madeThree = three ? await loadPaintedThree(owner, camera!.camera, three, profile) : null;
    const stage = camera?.camera.stage ?? stampStage({ width: surface.width, height: surface.height });
    made = await createStampPaintRenderer(surface, painting, { profile, stage, planes: camera?.planes, sources: madeThree?.sources });
  })();
  // The tasks queued so far, settled either way: one's failure is its caller's, not the next task's.
  let queue: Promise<unknown> = ready.catch(() => {});
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const run = queue.then(() => (disposed ? undefined : task()));
    queue = run.catch(() => {});
    return run;
  };
  let disposing: Promise<void> | null = null;
  return {
    ready,
    draw: (frames, { untilGpuDone }) => enqueue(async () => {
      await ready;
      // One after another: each exposure's sources render into the textures the one before it read.
      await frames.reduce(async (before, frame) => {
        await before;
        await made!.draw(frame);
      }, Promise.resolve());
      if (untilGpuDone) await made!.finish();
    }),
    dispose: () => {
      disposed = true;
      disposing ??= queue.then(() => {
        made?.dispose();
        return madeThree?.dispose();
      });
      return disposing;
    },
  };
}

// painted-shot.tsx: a PaintedShot in a scene (ENGINE 6.3): an element the camera's frame, one CSS px a frame px,
// scaled to fill its box, its HTML children laid out in frame px among PaintedShotCanvases. One device owner draws
// every canvas; a shot with no PaintedShotCanvas draws in one of its own, under its children. It holds the frame
// until its paint is solved and WebGPU has checked each draw (the screenshot waits for the GPU).
//
// The shot loads when its props' identity changes, or its canvases do, once its page is laid out
// (shot-dom-points.ts); within one, `t` draws the frame, its page read as it's drawn.

import { createContext, useContext, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useDelayRender } from 'remotion';
import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { BrushRef } from '#lib/paint/document/models/painting-document.ts';
import type { PaintingBrushOf } from '#lib/paint/document/models/painting-deposit-compile.ts';
import { paintingProblemsError } from '#lib/paint/document/models/painting-problem.ts';
import { createStampPaintGpuOwner, type StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintSurface, type StampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import type { ResolvedStampPaintStyle } from '#lib/paint/style/models/style.ts';
import { stampPaintAssetUrl, stampPaintStyle } from '#lib/paint/style/studio/stamp-paint-styles.ts';
import { fullFrameRect } from '#lib/picture/frame/models/frame.ts';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';
import type { LensMode } from '#lib/picture/lens/models/lens-mode.ts';
import { useLensMode } from '#lib/picture/lens/studio/lens-mode-context.ts';
import { unmeasuredAttrs } from '#lib/picture/measurement/studio/motion-tag.ts';
import { whenLaidOut } from '#lib/picture/measurement/studio/screen-rect.ts';
import { compilePaintedShot, shotCanvasAlphaMode } from '../models/shot-compile.ts';
import type { PaintedShotProps } from '../models/shot-props.ts';
import { createShotPageWatch, SHOT_CANVAS_STYLE, shotCanvasFillProblems, shotHtmlBehind, type ShotPageWatch } from './shot-dom-points.ts';
import { createPaintedShotRenderer, type PaintedShotRenderer } from './shot-renderer.ts';

const resolvedStyles = new Map<string, ResolvedStampPaintStyle>();

/**
 * A brush by the style that names it, from the project's styles, each style resolved once. One function for every
 * shot, so a compiled selection is shared across them (the compile memo keys by it).
 */
export const paintedShotBrushOf: PaintingBrushOf = ({ style, brush }: BrushRef): StampBrush => {
  let resolved = resolvedStyles.get(style);
  if (!resolved) resolvedStyles.set(style, (resolved = stampPaintStyle(style)));
  // SAFETY: a style's brushes are StampBrushes by name; `brush` is a document's ref, so a missing one is checked below.
  const found = (resolved.brushes as Readonly<Record<string, StampBrush>>)[brush];
  if (!found) throw new Error(`painted shot: the style ${style} has no brush ${brush}`);
  return found;
};

/** The canvases a PaintedShot's children hold, as they mount: each its name and element. */
type ShotCanvasRegistry = { readonly add: (name: string, canvas: HTMLCanvasElement) => () => void };

const ShotCanvases = createContext<ShotCanvasRegistry | null>(null);

/** A canvas of a PaintedShot among HTML, the whole frame: planes naming it draw here. Clear where nothing is painted; takes no pointer events. */
export function PaintedShotCanvas({ name }: { readonly name: string }) {
  const registry = useContext(ShotCanvases), canvas = useRef<HTMLCanvasElement>(null);
  if (!registry) throw new Error(`PaintedShotCanvas ${name} lies outside a PaintedShot`);
  useLayoutEffect(() => registry.add(name, canvas.current!), [registry, name]);
  return <canvas ref={canvas} style={SHOT_CANVAS_STYLE} />;
}

/**
 * Draws `shot` at scene second `t`, holding the frame until its paint is solved. Its element is the camera's frame,
 * scaled to fill `box` (composition px; all of it when left out); `children`, HTML and PaintedShotCanvases, stack in
 * DOM order. Keep `shot` a module constant or memoised: a new one loads anew.
 */
export function PaintedShot({ shot, t, box: given, children }: { readonly shot: PaintedShotProps; readonly t: number; readonly box?: { x: number; y: number; w: number; h: number }; readonly children?: ReactNode }) {
  const format = useVideoFormat(), box = given ?? fullFrameRect(format), { frame } = shot.camera.stage;
  const holder = useRef<HTMLDivElement>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const lensMode = useLensMode();
  // Canvases register into one map as they mount, before this element's own effects run. One added or gone once it's
  // mounted gives the map a new holder, so the shot loads anew; before then, the first load reads them all.
  const [canvases, setCanvases] = useState(() => ({ named: new Map<HTMLCanvasElement, string>() })), mounted = useRef(false);
  const [registry] = useState<ShotCanvasRegistry>(() => ({
    add: (name, canvas) => {
      canvases.named.set(canvas, name);
      if (mounted.current) setCanvases(({ named }) => ({ named }));
      return () => {
        canvases.named.delete(canvas);
        if (mounted.current) setCanvases(({ named }) => ({ named }));
      };
    },
  }));
  const [scene, setScene] = useState<PaintedShotScene | null>(null);
  // How many times a pinned element has resized away from where its frame drew it.
  const [layoutEpoch, layoutMoved] = useReducer((epoch: number) => epoch + 1, 0);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const handle = delayRender('loading the painted shot onto the GPU');
    let open = true, live = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    const named = [...canvases.named].toSorted(([a], [b]) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    // With no PaintedShotCanvas, the shot's own canvas lies first, under its children.
    const own = named.length ? null : Object.assign(document.createElement('canvas'), { width: frame.width, height: frame.height });
    if (own) {
      Object.assign(own.style, SHOT_CANVAS_STYLE);
      holder.current!.prepend(own);
    }
    const elements = own ? [own] : named.map(([canvas]) => canvas);
    for (const canvas of elements) Object.assign(canvas, { width: frame.width, height: frame.height });
    const loading = loadPaintedShotScene(shot, holder.current!, elements, named.map(([, name]) => name), layoutMoved);
    loading.ready.then(() => {
      if (!live) return undefined;
      flushSync(() => setScene(loading));
      return release();
    }, (error: Error) => {
      if (live) cancelRender(error);
    });
    return () => {
      live = false;
      void loading.dispose();
      own?.remove();
      setScene(null);
      release();
    };
  }, [shot, frame.width, frame.height, canvases, delayRender, continueRender, cancelRender]);

  useLayoutEffect(() => {
    if (!scene) return undefined;
    // A pinned element resized moves layoutEpoch on, so the frame draws again over the page as it now lies.
    const handle = delayRender(`drawing the painted shot over its page's layout ${layoutEpoch}`);
    let open = true, live = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    scene.draw(t, lensMode).then(release, (error: Error) => {
      // A frame overtaken by new props or an unmount may fail as its scene goes; only a live frame's failure counts.
      if (live) cancelRender(error);
    });
    return () => {
      live = false;
      release();
    };
  }, [scene, t, lensMode, layoutEpoch, delayRender, continueRender, cancelRender]);

  return (
    <div
      ref={holder}
      {...unmeasuredAttrs('painted shot')}
      style={{
        position: 'absolute', left: box.x, top: box.y, width: frame.width, height: frame.height, overflow: 'hidden',
        transform: `scale(${box.w / frame.width}, ${box.h / frame.height})`, transformOrigin: '0 0',
      }}
    >
      <ShotCanvases.Provider value={registry}>{children}</ShotCanvases.Provider>
    </div>
  );
}

/** A shot loaded on a device of its own over its canvases, drawn a frame at a time, one after another. */
type PaintedShotScene = {
  /** Resolves once loaded, or rejects with the load's error. */
  readonly ready: Promise<void>;
  /**
   * Draws the frame at `t` as one task after every earlier one, its page read as it's called: refused when its
   * canvases, a clear back's HTML or its pinned elements are amiss there. A no-op once disposed.
   */
  readonly draw: (t: number, mode: LensMode) => Promise<void>;
  /** Takes no more draws, waits out the load and the draws queued, then lets go of the renderer, surfaces and device. */
  readonly dispose: () => Promise<void>;
};

/**
 * `props` checked against `names` (its PaintedShotCanvases' names; none when it draws in its own) and the page in
 * `holder`, its element, once laid out; loaded on a device owner of its own over `canvases`, each handing the browser
 * its alpha as shotCanvasAlphaMode says. `pinsMoved` hears a pinned element resized. Refuses every problem at once.
 */
function loadPaintedShotScene(props: PaintedShotProps, holder: HTMLElement, canvases: readonly HTMLCanvasElement[], names: readonly string[], pinsMoved: () => void): PaintedShotScene {
  let owner: StampPaintGpuOwner | null = null, renderer: PaintedShotRenderer | null = null, page: ShotPageWatch | null = null, disposed = false;
  const surfaces: StampPaintSurface[] = [];
  const ready = (async () => {
    await whenLaidOut(holder);
    const fill = shotCanvasFillProblems(holder, canvases, names);
    const { shot, problems } = compilePaintedShot(props, names, { htmlBehind: shotHtmlBehind(holder, canvases[0]) });
    if (!shot || fill.length) throw paintingProblemsError('shot', [...fill, ...problems]);
    if (!disposed) page = createShotPageWatch(holder, canvases, names, shot, pinsMoved);
    const made = await createStampPaintGpuOwner(stampPaintAssetUrl);
    owner = made;
    // One after another: each configures its canvas under the owner's error check.
    await canvases.reduce(async (before, canvas, index) => {
      await before;
      surfaces.push(await createStampPaintSurface(made, { canvas, width: canvas.width, height: canvas.height, alphaMode: shotCanvasAlphaMode(shot, index) }));
    }, Promise.resolve());
    renderer = await createPaintedShotRenderer(made, surfaces, shot, { brushOf: paintedShotBrushOf });
  })();
  // The tasks queued so far, settled either way: one's failure is its caller's, not the next task's.
  let queue: Promise<unknown> = ready.catch(() => {});
  let disposing: Promise<void> | null = null;
  return {
    ready,
    draw: (t, mode) => {
      // Read now, after the frame's layout: by its turn in the queue a later frame may be laid out.
      const read = page?.read();
      if (read?.problems.length) return Promise.reject(paintingProblemsError(`shot's page at ${t} s`, read.problems));
      const run = queue.then(() => (disposed ? undefined : ready.then(() => renderer!.draw(t, mode, read?.pins))));
      queue = run.catch(() => {});
      return run;
    },
    dispose: () => {
      disposed = true;
      page?.dispose();
      disposing ??= queue.then(() => {
        renderer?.dispose();
        for (const surface of surfaces.splice(0)) surface.dispose();
        return owner?.dispose();
      });
      return disposing;
    },
  };
}

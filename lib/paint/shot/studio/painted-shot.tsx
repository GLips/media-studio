// painted-shot.tsx: a PaintedShot in a scene (ENGINE 6.3): an element the camera's frame, one CSS px a frame px,
// scaled to fill its box, its HTML children laid out in frame px among PaintedShotCanvases. One device owner draws
// every canvas; a shot with no PaintedShotCanvas draws in one of its own, under its children. It holds the frame
// until its paint is solved and WebGPU has checked each draw.
//
// The shot loads when its props' identity changes, or its canvases do, once its page is laid out
// (shot-dom-points.ts), then solves its `warm` span; within one, `t` draws the frame, its page read as it's drawn. A
// profiling render gets each frame's costs and the warm's (shot-cost-report.ts).

import { createContext, useContext, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useDelayRender } from 'remotion';
import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { BrushRef } from '#lib/paint/document/models/painting-document.ts';
import type { PaintingBrushOf } from '#lib/paint/document/models/painting-deposit-compile.ts';
import { paintingProblemsError } from '#lib/paint/document/models/painting-problem.ts';
import { createStampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { createStampPaintGpuOwner, type StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import type { ResolvedStampPaintStyle } from '#lib/paint/style/models/style.ts';
import { stampPaintAssetUrl, stampPaintStyle } from '#lib/paint/style/studio/stamp-paint-styles.ts';
import { fullFrameRect } from '#lib/picture/frame/models/frame.ts';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';
import type { LensMode } from '#lib/picture/lens/models/lens-mode.ts';
import { useLensMode } from '#lib/picture/lens/studio/lens-mode-context.ts';
import { unmeasuredAttrs } from '#lib/picture/measurement/studio/motion-tag.ts';
import { whenLaidOut } from '#lib/picture/measurement/studio/screen-rect.ts';
import { useFrameCosts, type FrameCostsReport } from '#lib/picture/profiling/studio/frame-profile.ts';
import { useSceneOrNull } from '#lib/picture/video/studio/scene.tsx';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import { compilePaintedShot, shotCanvasLaying } from '../models/shot-compile.ts';
import { SHOT_FRAME_COSTS_LABEL, SHOT_WARM_COSTS_LABEL, shotCostsProfileEntry } from '../models/shot-cost-report.ts';
import type { PaintedShotProps } from '../models/shot-props.ts';
import { createShotCanvasSurface, disposeShotCanvasSurface, type ShotCanvasSurface } from './shot-canvas-surface.ts';
import {
  createShotPageWatch, SHOT_CANVAS_STYLE, SHOT_FILTER_CANVAS_STYLE, shotCanvasFillProblems, shotHtmlBehind, type ShotCanvasElements, type ShotPageWatch,
} from './shot-dom-points.ts';
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

/** The canvases a PaintedShot's children hold, as they mount: each its name and elements. */
type ShotCanvasRegistry = { readonly add: (name: string, canvas: ShotCanvasElements) => () => void };

const ShotCanvases = createContext<ShotCanvasRegistry | null>(null);

/**
 * A canvas of a PaintedShot among HTML, the whole frame: planes naming it draw here. Clear where nothing is painted;
 * takes no pointer events. Two canvas elements, a glaze's filter and its colour (ShotCanvasElements).
 */
export function PaintedShotCanvas({ name }: { readonly name: string }) {
  const registry = useContext(ShotCanvases), filter = useRef<HTMLCanvasElement>(null), colour = useRef<HTMLCanvasElement>(null);
  if (!registry) throw new Error(`PaintedShotCanvas ${name} lies outside a PaintedShot`);
  useLayoutEffect(() => registry.add(name, { filter: filter.current!, colour: colour.current! }), [registry, name]);
  return (
    <>
      <canvas ref={filter} style={SHOT_FILTER_CANVAS_STYLE} />
      <canvas ref={colour} style={SHOT_CANVAS_STYLE} />
    </>
  );
}

function createStyledShotCanvas(style: typeof SHOT_CANVAS_STYLE | typeof SHOT_FILTER_CANVAS_STYLE): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, style);
  return canvas;
}

/** A shot canvas's elements made off the page, styled as PaintedShotCanvas's. */
const createShotCanvasElements = (): ShotCanvasElements => ({ filter: createStyledShotCanvas(SHOT_FILTER_CANVAS_STYLE), colour: createStyledShotCanvas(SHOT_CANVAS_STYLE) });

/**
 * Draws `shot` at scene second `t`, holding the frame until its paint is solved. Its element is the camera's frame,
 * scaled to fill `box` (composition px; all of it when left out); `children`, HTML and PaintedShotCanvases, stack in
 * DOM order. Keep `shot` a module constant or memoised: a new one loads anew.
 */
export function PaintedShot({ shot, t, box: given, children }: { readonly shot: PaintedShotProps; readonly t: number; readonly box?: { x: number; y: number; w: number; h: number }; readonly children?: ReactNode }) {
  const format = useVideoFormat(), box = given ?? fullFrameRect(format), { frame } = shot.camera.stage, { fps } = format;
  // The scene playing the shot, when it's played in one: its length is what a warm span is held to.
  const sceneDur = useSceneOrNull()?.dur ?? null, report = useFrameCosts();
  const holder = useRef<HTMLDivElement>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const lensMode = useLensMode();
  // Canvases register into one map as they mount, before this element's own effects run. One added or gone once it's
  // mounted gives the map a new holder, so the shot loads anew; before then, the first load reads them all.
  const [canvases, setCanvases] = useState(() => ({ named: new Map<ShotCanvasElements, string>() })), mounted = useRef(false);
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
    let handle = delayRender('loading the painted shot onto the GPU'), open = true, live = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    // Each solve a warm makes gets the time a frame's solve gets: a hold of its own, the last let go once it's taken.
    const solving = (label: string) => {
      if (!open) return;
      const next = delayRender(label);
      continueRender(handle);
      handle = next;
    };
    const named = [...canvases.named].toSorted(([a], [b]) => (a.filter.compareDocumentPosition(b.filter) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    // With no PaintedShotCanvas, the shot's own canvas lies first, under its children.
    const own = named.length ? null : createShotCanvasElements();
    if (own) holder.current!.prepend(own.filter, own.colour);
    const elements = own ? [own] : named.map(([canvas]) => canvas);
    const loading = loadPaintedShotScene(shot, elements, named.map(([, name]) => name), { holder: holder.current!, pinsMoved: layoutMoved, fps, sceneDur, report, solving });
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
      own?.filter.remove();
      own?.colour.remove();
      setScene(null);
      release();
    };
  }, [shot, canvases, fps, sceneDur, report, delayRender, continueRender, cancelRender]);

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
  /** Resolves once loaded and its warm span solved, or rejects with the load's error. */
  readonly ready: Promise<void>;
  /**
   * Draws the frame at `t` as one task after every earlier one, its page read as it's called: refused when its
   * canvases, a clear back's HTML or its pinned elements are amiss there. A no-op once disposed.
   */
  readonly draw: (t: number, mode: LensMode) => Promise<void>;
  /** Takes no more draws, stops a warm, waits out the load and the draws queued, then lets go of the renderer, surfaces and device. */
  readonly dispose: () => Promise<void>;
};

/**
 * Where a shot loads: `holder`, its element, its page checked once laid out; `pinsMoved`, told when a pinned element
 * resizes; the composition's fps, counting its warm's frames; its scene's length, s (null outside one); the
 * profiler's cost report (null outside a profiling render); `solving`, told of each warm solve.
 */
type PaintedShotLoadContext = {
  readonly holder: HTMLElement;
  readonly pinsMoved: () => void;
  readonly fps: number;
  readonly sceneDur: number | null;
  readonly report: FrameCostsReport | null;
  readonly solving: (label: string) => void;
};

/**
 * `props` checked against `names` (its PaintedShotCanvases' names; none when it draws in its own) and its page, once
 * laid out; loaded on a device owner of its own over `canvases`, each laid as shotCanvasLaying says, its warm span
 * solved. Refuses every problem at once.
 */
function loadPaintedShotScene(props: PaintedShotProps, canvases: readonly ShotCanvasElements[], names: readonly string[], context: PaintedShotLoadContext): PaintedShotScene {
  const { holder, pinsMoved, fps, sceneDur, report, solving } = context;
  let owner: StampPaintGpuOwner | null = null, renderer: PaintedShotRenderer | null = null, page: ShotPageWatch | null = null, disposed = false;
  const surfaces: ShotCanvasSurface[] = [], costs = report ? createStampPaintCostTally() : undefined;
  const ready = (async () => {
    await whenLaidOut(holder);
    const { shot, problems } = compilePaintedShot(props, names, { htmlBehind: shotHtmlBehind(holder, canvases[0].filter) });
    const fill = shotCanvasFillProblems(holder, canvases, names, shot);
    if (!shot || fill.length) throw paintingProblemsError('shot', [...fill, ...problems]);
    if (!disposed) page = createShotPageWatch(holder, canvases, names, shot, pinsMoved);
    const made = await createStampPaintGpuOwner(stampPaintAssetUrl);
    owner = made;
    // One after another: each configures its canvases under the owner's error check.
    await gpuEachInTurn(canvases, async (canvas, index) => {
      surfaces.push(await createShotCanvasSurface(made, canvas, shotCanvasLaying(shot, index), shot.camera.stage.frame));
    });
    renderer = await createPaintedShotRenderer(made, surfaces, shot, { brushOf: paintedShotBrushOf, ...(costs && { costs }) });
    if (!shot.warm) return;
    await renderer.warm({ fps, sceneDur, stopped: () => disposed, solving });
    if (costs) report!(SHOT_WARM_COSTS_LABEL, shotCostsProfileEntry(costs.take()));
  })();
  /** The frame at `t` drawn once the shot's loaded, its pins laid at `pins`, its costs reported in a profiling render. */
  const drawFrame = async (t: number, mode: LensMode, pins: Parameters<PaintedShotRenderer['draw']>[2]) => {
    await ready;
    await renderer!.draw(t, mode, pins);
    if (costs) report!(SHOT_FRAME_COSTS_LABEL, shotCostsProfileEntry(costs.take()));
  };
  // The tasks queued so far, settled either way: one's failure is its caller's, not the next task's.
  let queue: Promise<unknown> = ready.catch(() => {});
  let disposing: Promise<void> | null = null;
  return {
    ready,
    draw: (t, mode) => {
      // Read now, after the frame's layout: by its turn in the queue a later frame may be laid out.
      const read = page?.read();
      if (read?.problems.length) return Promise.reject(paintingProblemsError(`shot's page at ${t} s`, read.problems));
      const run = queue.then(() => (disposed ? undefined : drawFrame(t, mode, read?.pins)));
      queue = run.catch(() => {});
      return run;
    },
    dispose: () => {
      disposed = true;
      page?.dispose();
      disposing ??= queue.then(() => {
        renderer?.dispose();
        for (const surface of surfaces.splice(0)) disposeShotCanvasSurface(surface);
        return owner?.dispose();
      });
      return disposing;
    },
  };
}

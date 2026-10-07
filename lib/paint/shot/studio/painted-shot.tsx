// painted-shot.tsx: a PaintedShot in a scene (ENGINE 6.3): an element the camera's frame, one CSS px a frame px,
// scaled to fill its box, its HTML children laid out in frame px among PaintedShotCanvases. One device owner draws
// every canvas; a shot with no PaintedShotCanvas draws in one of its own, under its children.
//
// It loads when its props or canvases change, once its page is laid out (shot-dom-points.ts), and solves its `warm`
// span; `t` draws the frame. It holds the render once for the load and warm and once a draw, while they make progress:
// its watch (shot-watch.ts) fails one once progress stops, a lost device at once. A pass drawing no picture only
// checks the shot.

import { createContext, useContext, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useDelayRender } from 'remotion';
import { paintSpanShownProblems } from '#lib/paint/animation/models/paint-span-moments.ts';
import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { BrushRef } from '#lib/paint/document/models/painting-document.ts';
import type { PaintingBrushOf } from '#lib/paint/document/models/painting-deposit-compile.ts';
import { paintingProblem, paintingProblemsError, paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import { createStampPaintCostTally, type StampPaintCostName } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { stampGpuCacheEvictionAttributes, type StampGpuCacheProducer, type StampGpuCacheProducerCounts } from '#lib/paint/painting/studio/stamp-paint-gpu-cache.ts';
import { createStampPaintGpuOwner, type StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import type { ResolvedStampPaintStyle } from '#lib/paint/style/models/style.ts';
import { stampPaintAssetUrl, stampPaintStyle } from '#lib/paint/style/studio/stamp-paint-styles.ts';
import { fullFrameRect } from '#lib/picture/frame/models/frame.ts';
import { usePictureDrawn } from '#lib/picture/frame/studio/picture-drawn.ts';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';
import type { LensMode } from '#lib/picture/lens/models/lens-mode.ts';
import { useLensMode } from '#lib/picture/lens/studio/lens-mode-context.ts';
import { unmeasuredAttrs } from '#lib/picture/measurement/studio/motion-tag.ts';
import { whenLaidOut } from '#lib/picture/measurement/studio/screen-rect.ts';
import { useFrameCosts, type FrameCostsReport } from '#lib/picture/profiling/studio/frame-profile.ts';
import { usePageTrace, usePageTraceDetail } from '#lib/picture/profiling/studio/page-trace-context.ts';
import { traceNesting, UNTRACED_NESTING, type TraceRecorderSpan } from '#lib/platform/trace/models/trace-recorder.ts';
import type { PageTrace } from '#lib/platform/trace/studio/page-trace.ts';
import { useSceneOrNull } from '#lib/picture/video/studio/scene.tsx';
import { logRenderPageWarning } from '#lib/platform/browser/studio/render-page-log.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import { compilePaintedShot, shotCanvasLayings } from '../models/shot-compile.ts';
import { SHOT_FRAME_COSTS_LABEL, SHOT_WARM_COSTS_LABEL, shotCostsProfileEntry, shotCostsTraceAttributes } from '../models/shot-cost-report.ts';
import { shotPlanesKeyDrawingsText } from '../models/shot-painting-in-time.ts';
import { shotWatchName, type ShotWatchName } from '../models/shot-progress.ts';
import type { PaintedShotProps } from '../models/shot-props.ts';
import { shotWarmPastScene } from '../models/shot-warm.ts';
import {
  createShotCanvasSurface, disposeShotCanvasSurface, placeShotCanvas, removeShotCanvas, shotCanvasPageOrder, shotElementStyle, type ShotCanvasElements, type ShotCanvasSurface,
} from './shot-canvas.ts';
import { createShotPageWatch, shotCanvasFillProblems, shotGlazeIsolationProblems, shotHtmlBehind, type ShotPageWatch } from './shot-dom-points.ts';
import { createPaintedShotRenderer, type PaintedShotRenderer } from './shot-renderer.ts';
import { createShotWatch, type ShotSolveProgress } from './shot-watch.ts';

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
 * takes no pointer events. Its elements are placed in a span of its own as it mounts (placeShotCanvas).
 */
export function PaintedShotCanvas({ name }: { readonly name: string }) {
  const registry = useContext(ShotCanvases), host = useRef<HTMLSpanElement>(null);
  if (!registry) throw new Error(`PaintedShotCanvas ${name} lies outside a PaintedShot`);
  useLayoutEffect(() => {
    const canvas = placeShotCanvas(host.current!), remove = registry.add(name, canvas);
    return () => {
      remove();
      removeShotCanvas(canvas);
    };
  }, [registry, name]);
  return <span ref={host} />;
}

/**
 * What `studio paint check` hands a scene it renders without a page (shot-scene-check.ts): every PaintedShot rendered
 * gives it its shot. Null in a render.
 */
export const PaintedShotSeenContext = createContext<((shot: PaintedShotProps) => void) | null>(null);

/**
 * Draws `shot` at scene second `t`, holding the frame until its paint is solved. Its element is the camera's frame,
 * scaled to fill `box` (composition px; all of it when left out); `children`, HTML and PaintedShotCanvases, stack in
 * DOM order. Keep `shot` a module constant or memoised: a new one loads anew.
 */
export function PaintedShot({ shot, t, box: given, children }: { readonly shot: PaintedShotProps; readonly t: number; readonly box?: { x: number; y: number; w: number; h: number }; readonly children?: ReactNode }) {
  useContext(PaintedShotSeenContext)?.(shot);
  const format = useVideoFormat(), box = given ?? fullFrameRect(format), { frame } = shot.camera.stage, { fps } = format;
  // The scene playing the shot, when it's played in one: its length is what a warm span is held to.
  const sceneDur = useSceneOrNull()?.dur ?? null, report = useFrameCosts(), pictureDrawn = usePictureDrawn(), trace = usePageTrace();
  const holder = useRef<HTMLDivElement>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const lensMode = useLensMode();
  // Read by a load as its warm starts: the frame it loads in says whether the warm's solves are traced in detail.
  const detail = usePageTraceDetail(), detailNow = useRef(detail);
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
    detailNow.current = detail;
  }, [detail]);

  useLayoutEffect(() => {
    const handle = delayRender('loading the painted shot onto the GPU');
    let open = true, live = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    const named = [...canvases.named].toSorted(([a], [b]) => shotCanvasPageOrder(a, b));
    // With no PaintedShotCanvas, the shot's own canvas lies first, under its children.
    const ownHost = named.length ? null : document.createElement('span');
    if (ownHost) holder.current!.prepend(ownHost);
    const own = ownHost && placeShotCanvas(ownHost), elements = own ? [own] : named.map(([canvas]) => canvas);
    const name = shotWatchName(holder.current!.closest<HTMLElement>('[data-scene]')?.dataset.scene ?? null, shot.planes.map(({ id }) => id));
    const context = { holder: holder.current!, pinsMoved: layoutMoved, fps, sceneDur, lensMode, report, name, pictureDrawn, trace, detailed: () => detailNow.current };
    const loading = loadPaintedShotScene(shot, elements, named.map(([, canvasName]) => canvasName), context);
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
      ownHost?.remove();
      setScene(null);
      release();
    };
  }, [shot, canvases, fps, sceneDur, lensMode, report, pictureDrawn, trace, delayRender, continueRender, cancelRender]);

  useLayoutEffect(() => {
    if (!scene) return undefined;
    // A pinned element resized moves layoutEpoch on, so the frame draws again over the page as it now lies.
    const handle = delayRender(`drawing the painted shot over its page's layout ${layoutEpoch}`);
    let open = true, live = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    scene.draw(t, lensMode, detail).then(release, (error: Error) => {
      // A frame overtaken by new props or an unmount may fail as its scene goes; only a live frame's failure counts.
      if (live) cancelRender(error);
    });
    return () => {
      live = false;
      release();
    };
  }, [scene, t, lensMode, detail, layoutEpoch, delayRender, continueRender, cancelRender]);

  return (
    <div ref={holder} {...unmeasuredAttrs('painted shot')} style={shotElementStyle(box, frame)}>
      <ShotCanvases.Provider value={registry}>{children}</ShotCanvases.Provider>
    </div>
  );
}

/** A shot loaded on a device of its own over its canvases, drawn a frame at a time, one after another. */
type PaintedShotScene = {
  /** Resolves once loaded and its warm span solved, or rejects with the load's error. */
  readonly ready: Promise<void>;
  /**
   * Draws the frame at `t` as one task after every earlier one, its page read as it's called, its solves traced in
   * detail if `detail`: refused when its canvases, a clear back's HTML or its pinned elements are amiss there. A no-op
   * once disposed.
   */
  readonly draw: (t: number, mode: LensMode, detail: boolean) => Promise<void>;
  /** Takes no more draws, stops a warm, waits out the load and the draws queued, then lets go of the renderer, surfaces and device. */
  readonly dispose: () => Promise<void>;
};

/**
 * Where a shot loads: `holder`, its element; `pinsMoved`, told when a pinned element resizes; the fps and lens mode
 * it's compiled and warmed for; its scene's length, s (null outside one); the profiler's report (null outside a
 * profiling render); its `name`; whether the pass draws; the page's trace; whether its warm is traced in detail.
 */
type PaintedShotLoadContext = {
  readonly holder: HTMLElement;
  readonly pinsMoved: () => void;
  readonly fps: number;
  readonly sceneDur: number | null;
  readonly lensMode: LensMode;
  readonly report: FrameCostsReport | null;
  readonly name: ShotWatchName;
  readonly pictureDrawn: boolean;
  readonly trace: PageTrace;
  readonly detailed: () => boolean;
};

/**
 * `props` checked against `names` (its PaintedShotCanvases' names; none when it draws in its own) and its page, once
 * laid out; loaded on a device owner of its own over `canvases`, each laid as shotCanvasLayings says, its warm span
 * solved. Refuses every problem at once. Without the picture, only checked.
 */
function loadPaintedShotScene(props: PaintedShotProps, canvases: readonly ShotCanvasElements[], names: readonly string[], context: PaintedShotLoadContext): PaintedShotScene {
  const { holder, pinsMoved, fps, sceneDur, lensMode, report, name, pictureDrawn, trace, detailed } = context;
  let owner: StampPaintGpuOwner | null = null, renderer: PaintedShotRenderer | null = null, page: ShotPageWatch | null = null, disposed = false;
  // The span the shot's solves run under now (its warm, or the frame drawing), the spans of the solve running in it,
  // and whether it's traced in detail: the shot's work runs one task at a time, so each is its own.
  let solvesUnder: TraceRecorderSpan | null = null, solveTrace = UNTRACED_NESTING, detailing = false;
  let solveFrom: { counts: ReadonlyMap<StampPaintCostName, number>; cache: ReadonlyMap<StampGpuCacheProducer, StampGpuCacheProducerCounts> } | null = null;
  const surfaces: ShotCanvasSurface[] = [], costs = createStampPaintCostTally({ trace: () => solveTrace, detailed: () => detailing });
  const watch = createShotWatch({
    name, costs, gpu: () => owner && { checksSettled: owner.checksSettled(), evictions: owner.cache.evictions(), uploaded: owner.uploaded(), bytes: owner.cache.bytes() },
  });
  /** The watch told of each solve, and each timed on the trace with the costs it counted. */
  const progress: ShotSolveProgress = {
    run: watch.run,
    solving: (solve) => {
      watch.solving(solve);
      solveFrom = { counts: new Map(costs.counted().counts), cache: owner?.cache.producers() ?? new Map() };
      solveTrace = traceNesting(solvesUnder?.begin(`solve ${solve.what}`, { kind: 'solve', attributes: { at: { value: solve.at, unit: 's' } } }) ?? null);
    },
    solved: () => {
      watch.solved();
      const from = solveFrom!, cache = owner?.cache.producers() ?? new Map();
      solveTrace.current()?.end({ ...shotCostsTraceAttributes(costs.counted().counts, from.counts), ...stampGpuCacheEvictionAttributes(from.cache, cache) });
      solveTrace = UNTRACED_NESTING;
    },
  };
  /** `work` as phase `phaseName` of `parent`, its begin sent before the work runs, so a page frozen in it shows where. */
  const phase = async <T,>(parent: TraceRecorderSpan, phaseName: string, work: (span: TraceRecorderSpan) => Promise<T> | T): Promise<T> => {
    const span = parent.begin(phaseName, { kind: 'shot-phase' });
    await trace.sent();
    try {
      const result = await work(span);
      span.end();
      return result;
    } catch (error) {
      span.fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  };
  /** `work` raced against the device's loss: rejected with it at once, before any check would see it. */
  const unlessLost = <T,>(work: Promise<T>) => Promise.race([work, owner!.whenLost.then((loss) => Promise.reject(loss))]);
  /** The costs counted since the last, given to the profiler under `label` in a profiling render, and onto `span`. */
  const reportCosts = (label: string, span: TraceRecorderSpan) => {
    const taken = costs.take();
    report?.(label, shotCostsProfileEntry(taken));
    span.end(shotCostsTraceAttributes(taken.counts));
    trace.sample('GPU bytes kept', taken.bytes.kept, 'bytes');
  };
  const load = trace.begin('painted shot load', { kind: 'shot-load', attributes: { shot: name.line } });
  const ready = watch.watching('loading', (async () => {
    await phase(load, 'laid out', () => whenLaidOut(holder));
    const { shot, layings } = await phase(load, 'compile', () => {
      const compiled = compilePaintedShot(props, names, { htmlBehind: shotHtmlBehind(holder, canvases[0]) });
      const laid = compiled.shot ? shotCanvasLayings(compiled.shot) : [];
      const placed = [
        ...shotCanvasFillProblems(holder, canvases, names), ...shotGlazeIsolationProblems(holder, canvases, names, laid),
        ...paintSpanShownProblems(props.span, fps, sceneDur).map((message) => paintingProblem('error', 'shot', 'span', message)),
      ];
      if (!compiled.shot || placed.length) throw paintingProblemsError('shot', [...placed, ...compiled.problems]);
      for (const line of shotPlanesKeyDrawingsText(compiled.shot.planes)) costs.planned(line);
      // Said in every render, once however many tabs load it: what the shot's motion may read badly as.
      for (const warning of compiled.problems.filter(({ severity }) => severity === 'warning')) {
        costs.warned(paintingProblemText(warning));
        logRenderPageWarning(`${name.line}: ${paintingProblemText(warning)}`);
      }
      return { shot: compiled.shot, layings: laid };
    });
    if (!disposed) page = createShotPageWatch(holder, canvases, names, shot, pinsMoved);
    if (!pictureDrawn) return;
    const made = await phase(load, 'device', () => createStampPaintGpuOwner(stampPaintAssetUrl));
    owner = made;
    // One after another: each configures its canvases under the owner's error check.
    await phase(load, 'surfaces', () => gpuEachInTurn(canvases, async (canvas, index) => {
      surfaces.push(await createShotCanvasSurface(made, canvas, layings[index], shot.camera.stage.frame));
    }));
    renderer = await phase(load, 'renderer', () => createPaintedShotRenderer(made, surfaces, shot, { brushOf: paintedShotBrushOf, costs, progress }));
    if (!shot.warm) return;
    // Said in every render, not only a profiled one: a span written in frames warms far less than meant.
    for (const warning of sceneDur === null ? [] : shotWarmPastScene(shot.warm, sceneDur)) {
      costs.warned(paintingProblemText(warning));
      logRenderPageWarning(`${name.line}: ${paintingProblemText(warning)}`);
    }
    const warming = load.begin('warm', { kind: 'shot-phase' });
    await trace.sent();
    solvesUnder = warming;
    detailing = detailed();
    await unlessLost(renderer.warm({ fps, sceneDur, mode: lensMode, stopped: () => disposed })).catch((error: Error) => {
      warming.fail(error);
      throw error;
    });
    solvesUnder = null;
    detailing = false;
    reportCosts(SHOT_WARM_COSTS_LABEL, warming);
  })());
  ready.then(() => load.end(), (error: Error) => load.fail(error));
  let drawn = 0;
  /** The frame at `t` drawn once the shot's loaded, its pins laid at `pins`, its costs reported and traced. */
  const drawFrame = async (t: number, mode: LensMode, detail: boolean, pins: Parameters<PaintedShotRenderer['draw']>[2]) => {
    await ready;
    if (!renderer) return;
    const span = trace.begin(drawn++ ? 'shot frame' : 'first draw', { kind: 'shot-frame', attributes: { shot: name.line, t: { value: t, unit: 's' } } });
    solvesUnder = span;
    detailing = detail;
    try {
      await unlessLost(renderer.draw(t, mode, pins));
    } catch (error) {
      span.fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      solvesUnder = null;
      detailing = false;
    }
    reportCosts(SHOT_FRAME_COSTS_LABEL, span);
    await trace.sent();
  };
  // The tasks queued so far, settled either way: one's failure is its caller's, not the next task's.
  let queue: Promise<unknown> = ready.catch(() => {});
  let disposing: Promise<void> | null = null;
  return {
    ready,
    draw: (t, mode, detail) => {
      // Read now, after the frame's layout: by its turn in the queue a later frame may be laid out.
      const read = page?.read();
      if (read?.problems.length) return Promise.reject(paintingProblemsError(`shot's page at ${t} s`, read.problems));
      const run = queue.then(() => (disposed ? undefined : drawFrame(t, mode, detail, read?.pins)));
      queue = run.catch(() => {});
      return watch.watching(`drawing ${t} s`, run);
    },
    dispose: () => {
      disposed = true;
      page?.dispose();
      watch.dispose();
      disposing ??= queue.then(() => {
        renderer?.dispose();
        for (const surface of surfaces.splice(0)) disposeShotCanvasSurface(surface);
        return owner?.dispose();
      });
      return disposing;
    },
  };
}

// shot-renderer.ts: a compiled shot drawn on one owner's device into its canvases (ENGINE 6.1). A frame solves each
// painted plane and variant it shows, once, at its moment; then each exposure (a fast frame's one, a reference
// frame's many) lays every plane where it lies, in its masks' order, reads its items, and composites each canvas far
// to near through its lens. The first canvas holds the back. A pinned plane lies where the frame's measures put it.
//
// Picture and three planes are the old path's sources (stamp-lens-source-layers.ts). An alphaOf mask reads plane px
// to plane px, no parallax between depths; a three render, and an instanced plane's items drawn still, are the
// camera's, seen through the reader's view.

import { paintNodeTimeAt } from '#lib/paint/animation/models/paint-clock.ts';
import { PAINT_SIMILARITY_IDENTITY, paintSimilarityAfter, paintSimilarityInverse, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import { paintCameraDepthLooks, paintCameraLensFrame, type PaintCameraDepthLooks } from '#lib/paint/animation/models/paint-camera.ts';
import { paintingProblemsError } from '#lib/paint/document/models/painting-problem.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { STAMP_REST_LOOK, type StampLaidSourcePlane, type StampLensFrame, type StampPlaneLook } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampStage, StampStageTexels } from '#lib/paint/painting/models/stamp-stage.ts';
import { createStampLensFrames, createStampLensSourceLayers, stampLensSourcesBlurExtent, type StampSourceRenders } from '#lib/paint/painting/studio/stamp-lens-source-layers.ts';
import { stampLensSourceExposureOf, type StampLensSource, type StampLensSourceExposure } from '#lib/paint/painting/studio/stamp-lens-source.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { loadStampPictureSources } from '#lib/paint/painting/studio/stamp-picture-sources.ts';
import { createStampGrowingUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import { loadPaintedThreeSources } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import { lensExposures } from '#lib/picture/lens/models/lens-exposures.ts';
import { LENS_REFERENCE_EXPOSURES, type LensMode } from '#lib/picture/lens/models/lens-mode.ts';
import { shutterOpensAt } from '#lib/picture/lens/models/lens-shutter.ts';
import { createLensCompositor, type LensItemsLayer, type LensLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import { shotCanvasLayings, shotPaintedSolvables, type CompiledPaintedShot, type CompiledShotPlane, type PaintedShotPaintOptions } from '../models/shot-compile.ts';
import { shotExposureMoments, shotSolvablesShown, shotWarmShown } from '../models/shot-shown.ts';
import { shotPinnedPlanes, type ShotPinCentres } from '../models/shot-placement.ts';
import { shotNodePoseAt, shotVisibilityAt } from '../models/shot-frame-plan.ts';
import { shotDrawSteps, shotExposureItems, type CompiledShotInstancedPlane, type CompiledShotVariant, type ShotExposureItems } from '../models/shot-instances.ts';
import { shotDrawableOrder } from '../models/shot-plan.ts';
import type { ShotMomentAt } from '../models/shot-sheet-lays.ts';
import { shotWarmFrames } from '../models/shot-warm.ts';
import { shotCanvasPaintSurfaces, type ShotCanvasSurface } from './shot-canvas.ts';
import { createShotSpanFade } from './shot-span-fade-pass.ts';
import { shotItemsCoverages, shotItemsLayer, type ShotItemsCoverage } from './shot-instance-passes.ts';
import { createShotPaintedPlanes, type ShotPlaneMoment, type ShotPlaneSolved, type ShotSourceRead } from './shot-painted-plane.ts';
import { createShotPaintedTextures, type ShotWarmSolve } from './shot-painted-textures.ts';
import { createShotRigPictures, createShotRigPiecesDrawer } from './shot-rig-pieces.ts';
import { createShotSheetsLayer } from './shot-sheets-lay.ts';
import type { ShotSolveProgress } from './shot-watch.ts';

/**
 * What made the pixels a mask reads of a plane it doesn't lay: a three render's frame and exposure, a picture's upload
 * and box, or an instanced plane's items (ShotItemsCoverage's key).
 */
type ShotSourceMade =
  | { readonly kind: 'three'; readonly t: number; readonly exposure: StampLensSourceExposure | null }
  | { readonly kind: 'picture'; readonly version: number; readonly box: StampStageTexels }
  | { readonly kind: 'items'; readonly key: string };

/** A source read's key: what made its pixels, the share of them read, and the map its reader reads them through. */
const shotSourceReadKey = (made: ShotSourceMade, weight: number, map: PaintSimilarity) => JSON.stringify([made, weight, map.ma, map.mb, map.kx, map.ky]);

/**
 * How a reader reads a camera's render: `seen` (its stage texel's point to frame px), then on to the render's texel
 * point, its first texel at frame px `at`.
 */
const throughCamera = (seen: PaintSimilarity, at: { readonly x: number; readonly y: number }) => paintSimilarityAfter({ ma: 1, mb: 0, kx: -at.x, ky: -at.y }, seen);

/**
 * How a shot warms: at the composition's `fps`; within the scene playing it, `sceneDur` s long (null: unknown); for
 * frames drawn in lens mode `mode`, a plane solved at those it shows at; stopping between solves once `stopped` says
 * so.
 */
export type PaintedShotWarmRun = { readonly fps: number; readonly sceneDur: number | null; readonly mode: LensMode; readonly stopped?: () => boolean };

/** How a renderer paints: its brushes and costs, and `progress`, told of each warm's and each frame's solves. */
export type PaintedShotRendererOptions = PaintedShotPaintOptions & { readonly progress?: ShotSolveProgress };

/**
 * A shot drawn a frame at a time: `warm` solving its warm span's films (nothing without one), `draw` at frame time `t`
 * in a lens mode, its pinned planes' elements as `pins` measures them at that frame (none needed without pins),
 * `finish` waiting out the GPU. Each counts its costs (evictions, uploads, bytes kept) and tells `progress` its solves.
 */
export type PaintedShotRenderer = {
  readonly stage: StampStage;
  warm: (run: PaintedShotWarmRun) => Promise<void>;
  draw: (t: number, mode: LensMode, pins?: ShotPinCentres) => Promise<void>;
  finish: () => Promise<void>;
  dispose: () => void;
};

/** How many uniform slots a shot's arena starts with; it grows as a frame's rigs and fades need. */
const SHOT_UNIFORM_SLOTS = 512;

/**
 * One exposure of a frame: its lens (the camera's looks at any depth, and its planes' looks), the moment its planes
 * lie at, its shutter's ends when it gathers motion, and the sources' exposure.
 */
type ShotExposure = ShotMomentAt & {
  readonly looks: PaintCameraDepthLooks; readonly lens: StampLensFrame; readonly exposure: (StampLensSourceExposure & { readonly count: number }) | null;
};

function shotExposures(shot: CompiledPaintedShot, t: number, mode: LensMode): ShotExposure[] {
  const { camera } = shot, { shutter } = camera.lens;
  if (mode === 'fast') {
    const opens = shutterOpensAt(t, shutter), looks = paintCameraDepthLooks(camera, t);
    const moments = shutter > 0 ? { open: paintMoment(opens, t), close: paintMoment(opens + shutter, t) } : null;
    return [{ looks, lens: paintCameraLensFrame(camera, looks), at: paintMoment(t), shutter: moments, exposure: null }];
  }
  const moments = shotExposureMoments(shutter, t, mode);
  return lensExposures(LENS_REFERENCE_EXPOSURES).map(({ index, count, aperture }) => {
    const at = moments[index], looks = paintCameraDepthLooks(camera, t, { at: at.at, aperture });
    return { looks, lens: paintCameraLensFrame(camera, looks), at, shutter: null, exposure: { index, count, at: at.at, aperture } };
  });
}

/**
 * `shot` on `owner`'s device, drawn into `surfaces`, one a canvas in the shot's canvas order, each the camera's frame
 * size and laid as shotCanvasLayings says (createShotCanvasSurface). A glaze's frame keeps what it lets through.
 */
export async function createPaintedShotRenderer(owner: StampPaintGpuOwner, surfaces: readonly ShotCanvasSurface[], shot: CompiledPaintedShot, options: PaintedShotRendererOptions): Promise<PaintedShotRenderer> {
  const { brushOf, costs, progress } = options;
  // Paint passes go through the owner's caching device; the lens and picture sources take the device itself.
  const { camera } = shot, { stage } = camera, { device, webgpu } = owner;
  if (surfaces.length !== shot.canvases) throw new Error(`shot: drawn into ${surfaces.length} canvases, and it names ${shot.canvases}`);
  const layings = shotCanvasLayings(shot);
  surfaces.forEach((canvas, index) => {
    for (const surface of shotCanvasPaintSurfaces(canvas)) {
      if (surface.width !== stage.frame.width || surface.height !== stage.frame.height) {
        throw new Error(`shot: the camera's frame is ${stage.frame.width} × ${stage.frame.height}, and canvas ${index}'s surface ${surface.width} × ${surface.height}`);
      }
    }
    if (canvas.laying !== layings[index]) throw new Error(`shot: canvas ${index} is laid ${layings[index]}, and its surfaces were made ${canvas.laying}`);
  });
  const arena = createStampGrowingUniformArena(device, SHOT_UNIFORM_SLOTS);
  // Let go of last made first: three's sources before the textures they sample.
  const made: { dispose: () => void }[] = [];
  const release = () => {
    for (const thing of made.splice(0).toReversed()) thing.dispose();
  };
  try {
    const sourceFps = shot.motion.animationFps;
    // A source plane's source reads the frame's moment held by its source clock: a three scene posed, a picture asked.
    const threeSources = shot.planes.flatMap((plane) => (plane.kind === 'three' ? [{
      id: plane.id,
      build: (tools: Parameters<typeof plane.source.build>[0]) => {
        const built = plane.source.build(tools);
        return { ...built, poseAt: (moment: PaintMoment) => built.poseAt(paintNodeTimeAt(plane.sourceClock, moment, sourceFps)) };
      },
    }] : []));
    // Only three sources read painted textures, so a shot without one draws none.
    const textures = threeSources.length ? createShotPaintedTextures(owner, shot.paintedTextures, { brushOf, costs }) : null;
    if (textures) made.push(textures);
    const three = textures && (await loadPaintedThreeSources(owner, camera, threeSources, textures));
    if (three) made.push(three);
    const pictures = loadStampPictureSources(webgpu, new Map(shot.planes.flatMap((plane) => (plane.kind === 'picture'
      ? [[plane.id, (moment: PaintMoment) => plane.source.pictureAt(paintNodeTimeAt(plane.sourceClock, moment, sourceFps))] as const]
      : []))));
    made.push(pictures);
    const sources = new Map<string, StampLensSource>([...(three?.sources ?? []), ...pictures.sources]);
    const piecesDrawer = [...shot.rigs.values()].some(({ pieces }) => pieces) ? await createShotRigPiecesDrawer(owner, stage) : null;
    if (piecesDrawer) made.push(piecesDrawer);
    const layer = createShotSheetsLayer(owner, { stage, arena, fade: createShotSpanFade(owner, arena) });
    const planes = createShotPaintedPlanes(owner, { shot, stage, brushOf, costs, arena, layer, rigPictures: createShotRigPictures(owner, costs), piecesDrawer });
    made.push(planes);
    const canvases = surfaces.map((surface, index) => {
      const own = new Map([...sources].filter(([id]) => shot.planes.some((plane) => plane.id === id && plane.canvas === index)));
      const lens = createLensCompositor(webgpu, { ...stage.frame, blurExtent: stampLensSourcesBlurExtent(stage, own) });
      made.push(lens);
      const frames = createStampLensFrames(lens, { through: surface.laying === 'glaze' });
      return { surface, index, lens, frames, sourceLayers: createStampLensSourceLayers(owner, { stage, lens, sources: own }), glowed: false };
    });
    const opaqueBack = shot.clearBack ? undefined : shot.planes[0], planeOf = new Map(shot.planes.map((plane) => [plane.id, plane]));
    const instancedOf = new Map(shot.instanced.map((plane) => [plane.id, plane]));
    const canvasOf = new Map([...shot.planes, ...shot.instanced].map(({ id, canvas }) => [id, canvas]));
    // A variant is a finished picture laid whole: it lies still at each exposure's moment. It shares its plane's id.
    const variantOf = new Map(shot.instanced.flatMap((plane) => [...plane.variants.values()].map((variant) => [variant.painted, variant] as const)));

    /** Where picture plane `id`'s node places its picture within the plane at `m`: picture px to plane px. */
    const pictureNodeMap = (id: string, m: PaintMoment): PaintSimilarity => {
      const node = shot.motion.nodes.get(id);
      if (!node) return PAINT_SIMILARITY_IDENTITY;
      const pose = shotNodePoseAt(node, m, shot.motion.animationFps, true);
      if (pose.kind !== 'similarity') throw new Error(`shot: picture plane ${id}'s node bends it (${pose.text}); its node only places it`);
      return pose.map;
    };

    /** A picture plane's look: its view after its node's placement within it, at the moment and the shutter's ends. */
    const pictureLook = (id: string, look: StampPlaneLook, { at, shutter }: ShotMomentAt): StampPlaneLook => {
      if (!shot.motion.nodes.has(id)) return look;
      const placed = (view: StampPlaneLook['view'], m: PaintMoment) => paintSimilarityAfter(view, pictureNodeMap(id, m));
      return { ...look, view: placed(look.view, at), shutter: look.shutter && shutter && { open: placed(look.shutter.open, shutter.open), close: placed(look.shutter.close, shutter.close) } };
    };

    const { margin } = stage, planePx: PaintSimilarity = { ma: 1, mb: 0, kx: -margin, ky: -margin };

    /**
     * Plane `id`, a source or instanced plane or a painted plane hidden this frame, as painted plane `reader`'s mask
     * reads it at `exposure` of frame `t`: a picture's alpha through its node's placement; a three render's, or the
     * items' (`items`), through the reader's view; each by its visibility; nothing of a hidden plane. And a key naming
     * what's read.
     */
    const sourceRead = (
      id: string, reader: string, exposure: ShotExposure, renders: readonly StampSourceRenders[], items: (plane: CompiledShotInstancedPlane) => ShotItemsCoverage, t: number,
    ): ShotSourceRead => {
      const { view } = exposure.lens.planes.get(reader) ?? STAMP_REST_LOOK, seen = paintSimilarityAfter(view, planePx), instanced = instancedOf.get(id);
      if (instanced) {
        // An item's visibility is in its look already: the plane's is read through its items.
        const { key, at, read } = items(instanced), map = throughCamera(seen, at);
        return {
          key: shotSourceReadKey({ kind: 'items', key }, 1, map),
          coverage: () => {
            const texture = read();
            return texture && { view: texture.createView(), channel: 3, weight: 1, extent: { w: texture.width, h: texture.height }, map };
          },
        };
      }
      const plane = planeOf.get(id)!;
      if (plane.kind === 'painted') return { key: 'hidden', coverage: () => null };
      const source = sources.get(id), weight = shotVisibilityAt(shot, id, id, exposure.at);
      if (plane.kind === 'three' && source?.kind === 'three') {
        // A three source is posed at its moment: frame t and the exposure name its render.
        const { texture, at } = source.picture, map = throughCamera(seen, at);
        return {
          key: shotSourceReadKey({ kind: 'three', t, exposure: stampLensSourceExposureOf(exposure.exposure ?? undefined) }, weight, map),
          coverage: () => ({ view: texture.createView(), channel: 3, weight, extent: { w: texture.width, h: texture.height }, map }),
        };
      }
      const picture = renders[plane.canvas].pictures.get(id) ?? null;
      if (!picture) return { key: 'nothing', coverage: () => null };
      const { box } = picture, map = paintSimilarityAfter({ ma: 1, mb: 0, kx: margin - box.x, ky: margin - box.y }, paintSimilarityAfter(paintSimilarityInverse(pictureNodeMap(id, exposure.at)), planePx));
      return {
        key: shotSourceReadKey({ kind: 'picture', version: picture.version, box }, weight, map),
        coverage: () => ({ view: picture.texture.createView(), channel: 3, weight, extent: { w: box.w, h: box.h }, map }),
      };
    };

    /**
     * Encodes and submits one exposure of every canvas, its painted planes as `moments` lays them, its variants as
     * `variantMoments` does, its items as `items` reads them.
     */
    const drawExposure = (
      exposure: ShotExposure, moments: ReadonlyMap<string, ShotPlaneMoment>, variantMoments: ReadonlyMap<CompiledShotVariant, ShotPlaneMoment>, items: ShotExposureItems,
      renders: readonly StampSourceRenders[], t: number,
    ) => owner.checked(`drawing the shot at ${exposure.at.at} s of ${t} s`, () => {
      arena.reset();
      layer.reserve([...moments.values(), ...variantMoments.values()].flatMap(({ shares }) => shares.map(({ frame }) => frame)));
      const encoder = device.createCommandEncoder(), lensFrame = exposure.lens, fast = !exposure.exposure;
      // Every painted plane laid first, each after those its masks read, whatever canvas or depth it's drawn at.
      const itemsCovered = shotItemsCoverages(encoder, { owner, lenses: canvases.map(({ lens }) => lens), planes, stage }, variantMoments, items);
      const presented = planes.present(encoder, moments, (id, reader) => sourceRead(id, reader, exposure, renders, itemsCovered, t));
      // The exposure's drawables far to near, consecutive items of a variant blurred alike in one step.
      const steps = shotDrawSteps(shotDrawableOrder(shot.written, items.items), (plane, item) => items.lookOf(plane, item).sigma);
      for (const canvas of canvases) {
        const rendered = renders[canvas.index], lookOf = (id: string) => lensFrame.planes.get(id) ?? STAMP_REST_LOOK;
        const own = steps.filter((step) => canvasOf.get(step.plane) === canvas.index), momentOf = (plane: CompiledShotPlane) => moments.get(plane.id);
        const shown = own.flatMap((step) => (step.kind === 'plane' ? [planeOf.get(step.plane)!] : []));
        const glowing = shown.some((plane) => momentOf(plane)?.emits);
        const itemsMove = own.some((step) => step.kind === 'items' && step.items.some((item) => items.lookOf(step.plane, item).shutter));
        const moving = fast && (shown.some((plane) => momentOf(plane)?.travels || lookOf(plane.id).shutter) || itemsMove || rendered.moved.size > 0);
        const layers = own.flatMap((step): (LensLayer | LensItemsLayer)[] => {
          // A plane or variant hidden at every exposure of the frame wasn't solved: it lays nothing.
          if (step.kind === 'items') {
            const variant = variantMoments.get(instancedOf.get(step.plane)!.variants.get(step.variant)!);
            const laid = variant && shotItemsLayer(encoder, canvas.lens, planes, stage, variant, step, (item) => items.lookOf(step.plane, item));
            return laid ? [laid] : [];
          }
          const plane = planeOf.get(step.plane)!, isBack = plane === opaqueBack, look = lookOf(plane.id);
          if (plane.kind === 'painted') {
            const solvedPlane = presented.get(plane.id), laid = solvedPlane && planes.picture(encoder, canvas.lens, solvedPlane, look);
            return laid ? [laid] : [];
          }
          // The compile refuses the opaque back a visibility: it reads 1.
          const visibility = shotVisibilityAt(shot, plane.id, plane.id, exposure.at);
          if (visibility <= 0) return [];
          const source: StampLaidSourcePlane = plane.kind === 'three' ? { id: plane.id, kind: 'three' } : { id: plane.id, kind: 'picture', extent: plane.source.extent };
          const seen = plane.kind === 'picture' ? pictureLook(plane.id, look, exposure) : look;
          return canvas.sourceLayers.layer(encoder, source, rendered, { look: seen, focus: lensFrame.focus, moving, back: isBack, visibility });
        });
        const { frame, last } = canvas.frames(exposure.exposure ?? undefined);
        if (!exposure.exposure || exposure.exposure.index === 0) canvas.glowed = false;
        canvas.glowed ||= glowing;
        frame.exposure(encoder, layers, { glowing, moving });
        // One bloom of all that glows over the frame's exposures, once they're in.
        if (last) {
          const { surface } = canvas, { colour } = surface, dithered = colour.format.endsWith('8unorm');
          const written = surface.laying === 'glaze'
            ? { encoding: { kind: 'glaze', dithered } as const, filterInto: surface.filter.frameTexture().createView() }
            : { encoding: { kind: 'encoded', dithered } as const };
          frame.develop(encoder, {
            bloom: canvas.glowed ? { sigma: lensFrame.bloom, strength: 1, glow: 'emission' } : null, into: colour.frameTexture().createView(), format: colour.format, ...written,
          });
        }
        canvas.lens.flush();
      }
      arena.flush();
      layer.flush();
      device.queue.submit([encoder.finish()]);
    });

    /** `run`, the device's evictions and uploads meanwhile counted, and the bytes its cache keeps after. */
    const counted = async (run: () => Promise<void>) => {
      const evicted = owner.cache.evictions(), uploaded = owner.uploaded();
      try {
        await run();
      } finally {
        costs?.count('evictions', owner.cache.evictions() - evicted);
        costs?.count('bytes uploaded', owner.uploaded() - uploaded);
        costs?.retained({ kept: owner.cache.bytes() - owner.cache.bytes('target'), targets: owner.cache.bytes('target') });
      }
    };

    let disposed = false;
    return {
      stage,
      warm: ({ fps, sceneDur, mode, stopped = () => false }) => counted(async () => {
        const { warm } = shot;
        if (disposed || !warm) return;
        owner.assertLive();
        const frames = shotWarmFrames(warm, fps, sceneDur);
        // Each plane's films solved at each pairing of moments the span's frames it shows at read, and let go to the
        // cache; then the textures'. A solve reads no lay, so a pinned plane warms unlaid.
        const solves: ShotWarmSolve[] = [
          ...shotPaintedSolvables(shot).flatMap((plane) => {
            const shown = shotWarmShown(shot, plane, frames, mode);
            costs?.count('hidden planes skipped', shown.hidden);
            return shown.frames.map((frame) => ({ solve: { what: plane.id, at: frame.at }, run: async () => (await planes.solve(plane, frame)).release() }));
          }),
          ...(textures?.warmSolves(frames) ?? []),
        ];
        progress?.run({ kind: 'warm', ...warm }, solves.length);
        await gpuEachInTurn(solves, async ({ solve, run }) => {
          if (stopped()) return;
          progress?.solving(solve);
          await run();
          progress?.solved();
        });
      }),
      draw: (t, mode, pins = new Map()) => counted(async () => {
        if (disposed) return;
        owner.assertLive();
        const pinned = shotPinnedPlanes(shot, pins);
        if (pinned.problems.length) throw paintingProblemsError(`the shot's pins at ${t} s`, pinned.problems);
        const solved: ShotPlaneSolved[] = [], exposures = shotExposures(shot, t, mode), shown = shotSolvablesShown(shot, exposures.map(({ at }) => at));
        costs?.count('hidden planes skipped', shown.hidden);
        progress?.run({ kind: 'frame', t }, shown.shown.length + (textures?.handles.length ?? 0));
        try {
          // Each plane's and variant's marks posed and solved once, at the frame's own moment, if it shows at one of
          // the frame's exposures; one after another on the solve lease. A pinned plane is solved where this frame's
          // measures lay it. Then the painted textures, which its three sources read as they render.
          await gpuEachInTurn(shown.shown, async (plane) => {
            progress?.solving({ what: plane.id, at: t });
            solved.push(await planes.solve(pinned.planes.get(plane.id) ?? plane, paintMoment(t)));
            progress?.solved();
          });
          await textures?.solveAt(t, progress);
          await gpuEachInTurn(exposures, async (exposure) => {
            const moments = new Map<string, ShotPlaneMoment>(), variantMoments = new Map<CompiledShotVariant, ShotPlaneMoment>();
            await gpuEachInTurn(solved, async (each) => {
              const variant = variantOf.get(each.plane);
              if (variant) variantMoments.set(variant, await planes.moment(each, { at: exposure.at, shutter: null }));
              else moments.set(each.plane.id, await planes.moment(each, exposure));
            });
            const items = shotExposureItems(shot.instanced, shot.motion, exposure, exposure.looks);
            const renders = await gpuEachInTurn(canvases, (canvas) => canvas.sourceLayers.render(t, stampLensSourceExposureOf(exposure.exposure ?? undefined)));
            await drawExposure(exposure, moments, variantMoments, items, renders, t);
          });
        } finally {
          for (const each of solved) each.release();
        }
      }),
      finish: () => (disposed ? Promise.resolve() : device.queue.onSubmittedWorkDone()),
      dispose: () => {
        disposed = true;
        release();
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}

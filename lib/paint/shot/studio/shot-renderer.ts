// shot-renderer.ts: a compiled shot drawn on one owner's device into its canvases (ENGINE 6.1). A frame solves each
// painted plane and instanced variant once, at its own moment; then each exposure (a fast frame's one, a reference
// frame's many) lays every plane where it lies then, in its masks' order, reads its items, and composites each
// canvas far to near through its lens. The first canvas holds the back. A pinned plane lies where the frame's
// measures put it.
//
// Picture and three planes are the old path's sources (stamp-lens-source-layers.ts), three reading the shot's painted
// textures (shot-painted-textures.ts). An alphaOf mask reads plane px to plane px, no parallax between depths; a three
// render is the camera's, seen through the reader's view.

import { PAINT_SIMILARITY_IDENTITY, paintSimilarityAfter, paintSimilarityInverse, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import { paintCameraDepthLooks, paintCameraLensFrame, type PaintCameraDepthLooks } from '#lib/paint/animation/models/paint-camera.ts';
import { paintingProblemsError, paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { STAMP_REST_LOOK, type StampLaidSourcePlane, type StampLensFrame, type StampPlaneLook } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampStage, StampStageTexels } from '#lib/paint/painting/models/stamp-stage.ts';
import { createStampLensFrames, createStampLensSourceLayers, stampLensSourcesBlurExtent, type StampSourceRenders } from '#lib/paint/painting/studio/stamp-lens-source-layers.ts';
import { stampLensSourceExposureOf, type StampLensSource, type StampLensSourceExposure } from '#lib/paint/painting/studio/stamp-lens-source.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import type { StampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { loadStampPictureSources } from '#lib/paint/painting/studio/stamp-picture-sources.ts';
import { createStampGrowingUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import { loadPaintedThreeSources } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import { lensExposures } from '#lib/picture/lens/models/lens-exposures.ts';
import { LENS_REFERENCE_EXPOSURES, type LensMode } from '#lib/picture/lens/models/lens-mode.ts';
import { shutterMomentAt, shutterOpensAt } from '#lib/picture/lens/models/lens-shutter.ts';
import { createLensCompositor, type LensItemsLayer, type LensLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import { shotCanvasAlphaMode, shotPaintedSolvables, type CompiledPaintedShot, type CompiledShotPlane, type PaintedShotPaintOptions } from '../models/shot-compile.ts';
import { shotPinnedPlanes, type ShotPinCentres } from '../models/shot-placement.ts';
import { shotNodePoseAt, shotPlaneClocks } from '../models/shot-frame-plan.ts';
import { shotDrawSteps, shotExposureItems, type CompiledShotVariant, type ShotExposureItems } from '../models/shot-instances.ts';
import { shotDrawableOrder } from '../models/shot-plan.ts';
import type { ShotMomentAt } from '../models/shot-sheet-lays.ts';
import { shotWarmCombinations, shotWarmFrames, shotWarmPastScene } from '../models/shot-warm.ts';
import { createShotGroupFade } from './shot-group-pass.ts';
import { shotItemsLayer } from './shot-instance-passes.ts';
import { createShotPaintedPlanes, type ShotPlaneMoment, type ShotPlaneSolved, type ShotSourceRead } from './shot-painted-plane.ts';
import { createShotPaintedTextures } from './shot-painted-textures.ts';
import { createShotRigPictures, createShotRigPiecesDrawer } from './shot-rig-pieces.ts';
import { createShotSheetsLayer } from './shot-sheets-lay.ts';

/** What made a source plane's render's pixels: a three render's frame and exposure, or a picture's upload and box. */
type ShotSourceMade =
  | { readonly kind: 'three'; readonly t: number; readonly exposure: StampLensSourceExposure | null }
  | { readonly kind: 'picture'; readonly version: number; readonly box: StampStageTexels };

/** A source read's key: what made its render's pixels, and the map its reader reads them through. */
const shotSourceReadKey = (made: ShotSourceMade, map: PaintSimilarity) => JSON.stringify([made, map.ma, map.mb, map.kx, map.ky]);

/**
 * How a shot warms: at the composition's `fps`; within the scene playing it, `sceneDur` s long (null: unknown);
 * stopping between solves once `stopped` says so; `solving` told of each solve before it starts, so a render can give
 * each the time a frame's solve gets.
 */
export type PaintedShotWarmRun = {
  readonly fps: number;
  readonly sceneDur: number | null;
  readonly stopped?: () => boolean;
  readonly solving?: (label: string) => void;
};

/**
 * A shot drawn a frame at a time: `warm` solving its warm span's films (nothing without one), `draw` at frame time `t`
 * in a lens mode, its pinned planes' elements as `pins` measures them at that frame (none needed without pins),
 * `finish` waiting out the GPU. Each counts its costs, the device's evictions, uploads and bytes kept among them.
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
  return lensExposures(LENS_REFERENCE_EXPOSURES).map(({ index, count, shutter: share, aperture }) => {
    const at = shutterMomentAt(t, shutter, share), looks = paintCameraDepthLooks(camera, t, { at, aperture });
    return { looks, lens: paintCameraLensFrame(camera, looks), at: paintMoment(at, t), shutter: null, exposure: { index, count, at, aperture } };
  });
}

/**
 * `shot` on `owner`'s device, drawn into `surfaces`, one a canvas in the shot's canvas order, each the camera's frame
 * size and handing the browser its alpha as shotCanvasAlphaMode says.
 */
export async function createPaintedShotRenderer(owner: StampPaintGpuOwner, surfaces: readonly StampPaintSurface[], shot: CompiledPaintedShot, { brushOf, costs }: PaintedShotPaintOptions): Promise<PaintedShotRenderer> {
  // Paint passes go through the owner's caching device; the lens and picture sources take the device itself.
  const { camera } = shot, { stage } = camera, { device, webgpu } = owner;
  if (surfaces.length !== shot.canvases) throw new Error(`shot: drawn into ${surfaces.length} canvases, and it names ${shot.canvases}`);
  surfaces.forEach((surface, index) => {
    if (surface.width !== stage.frame.width || surface.height !== stage.frame.height) {
      throw new Error(`shot: the camera's frame is ${stage.frame.width} × ${stage.frame.height}, and canvas ${index}'s surface ${surface.width} × ${surface.height}`);
    }
    const alphaMode = shotCanvasAlphaMode(shot, index);
    if (surface.alphaMode !== alphaMode) throw new Error(`shot: canvas ${index}'s surface is ${surface.alphaMode}; ${alphaMode === 'opaque' ? 'the first, holding an opaque back, is opaque' : 'it is laid premultiplied over the page'}`);
  });
  const arena = createStampGrowingUniformArena(device, SHOT_UNIFORM_SLOTS);
  // Let go of last made first: three's sources before the textures they sample.
  const made: { dispose: () => void }[] = [];
  const release = () => {
    for (const thing of made.splice(0).toReversed()) thing.dispose();
  };
  try {
    const threeSources = shot.planes.flatMap((plane) => (plane.kind === 'three' ? [{ id: plane.id, build: plane.source.build }] : []));
    // Only three sources read painted textures, so a shot without one draws none.
    const textures = threeSources.length ? createShotPaintedTextures(owner, shot.paintedTextures, { brushOf, costs }) : null;
    if (textures) made.push(textures);
    const three = textures && (await loadPaintedThreeSources(owner, camera, threeSources, textures));
    if (three) made.push(three);
    const pictures = loadStampPictureSources(webgpu, new Map(shot.planes.flatMap((plane) => (plane.kind === 'picture' ? [[plane.id, plane.source.pictureAt] as const] : []))));
    made.push(pictures);
    const sources = new Map<string, StampLensSource>([...(three?.sources ?? []), ...pictures.sources]);
    const piecesDrawer = [...shot.rigs.values()].some(({ pieces }) => pieces) ? await createShotRigPiecesDrawer(owner, stage) : null;
    if (piecesDrawer) made.push(piecesDrawer);
    const layer = createShotSheetsLayer(owner, { stage, arena, fade: createShotGroupFade(owner, arena) });
    const planes = createShotPaintedPlanes(owner, { shot, stage, brushOf, costs, arena, layer, rigPictures: createShotRigPictures(owner, costs), piecesDrawer });
    made.push(planes);
    const canvases = surfaces.map((surface, index) => {
      const own = new Map([...sources].filter(([id]) => shot.planes.some((plane) => plane.id === id && plane.canvas === index)));
      const lens = createLensCompositor(webgpu, { ...stage.frame, blurExtent: stampLensSourcesBlurExtent(stage, own) });
      made.push(lens);
      return { surface, index, lens, frames: createStampLensFrames(lens), sourceLayers: createStampLensSourceLayers(owner, { stage, lens, sources: own }), glowed: false };
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

    /**
     * Source plane `id` as painted plane `reader`'s mask reads it at `exposure` of frame `t`: its render's alpha, a
     * picture's through its node's placement, a three render's through the reader's view; and a key naming both.
     */
    const sourceRead = (id: string, reader: string, exposure: ShotExposure, renders: readonly StampSourceRenders[], t: number): ShotSourceRead => {
      const plane = planeOf.get(id)!, source = sources.get(id), { margin } = stage, planePx: PaintSimilarity = { ma: 1, mb: 0, kx: -margin, ky: -margin };
      if (plane.kind === 'three' && source?.kind === 'three') {
        // A three source is posed at its moment: frame t and the exposure name its render.
        const { texture, at } = source.picture, { view } = exposure.lens.planes.get(reader) ?? STAMP_REST_LOOK;
        const map = paintSimilarityAfter({ ma: 1, mb: 0, kx: -at.x, ky: -at.y }, paintSimilarityAfter(view, planePx));
        return { coverage: { view: texture.createView(), channel: 3, extent: { w: texture.width, h: texture.height }, map }, key: shotSourceReadKey({ kind: 'three', t, exposure: stampLensSourceExposureOf(exposure.exposure ?? undefined) }, map) };
      }
      if (plane.kind !== 'picture') throw new Error(`shot: ${reader}'s mask reads ${id}, a ${plane.kind} plane, as a source; only a picture or three plane renders one`);
      const picture = renders[plane.canvas].pictures.get(id) ?? null;
      if (!picture) return { coverage: null, key: 'nothing' };
      const { box } = picture, map = paintSimilarityAfter({ ma: 1, mb: 0, kx: margin - box.x, ky: margin - box.y }, paintSimilarityAfter(paintSimilarityInverse(pictureNodeMap(id, exposure.at)), planePx));
      return { coverage: { view: picture.texture.createView(), channel: 3, extent: { w: box.w, h: box.h }, map }, key: shotSourceReadKey({ kind: 'picture', version: picture.version, box }, map) };
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
      const presented = planes.present(encoder, moments, (id, reader) => sourceRead(id, reader, exposure, renders, t));
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
          if (step.kind === 'items') {
            const variant = variantMoments.get(instancedOf.get(step.plane)!.variants.get(step.variant)!)!;
            const laid = shotItemsLayer(encoder, canvas.lens, planes, stage, variant, step, (item) => items.lookOf(step.plane, item));
            return laid ? [laid] : [];
          }
          const plane = planeOf.get(step.plane)!, isBack = plane === opaqueBack, look = lookOf(plane.id);
          if (plane.kind === 'painted') {
            const laid = planes.picture(encoder, canvas.lens, presented.get(plane.id)!, look);
            return laid ? [laid] : [];
          }
          const source: StampLaidSourcePlane = plane.kind === 'three' ? { id: plane.id, kind: 'three' } : { id: plane.id, kind: 'picture', extent: plane.source.extent };
          const seen = plane.kind === 'picture' ? pictureLook(plane.id, look, exposure) : look;
          return canvas.sourceLayers.layer(encoder, source, rendered, { look: seen, focus: lensFrame.focus, moving, back: isBack });
        });
        const { frame, last } = canvas.frames(exposure.exposure ?? undefined);
        if (!exposure.exposure || exposure.exposure.index === 0) canvas.glowed = false;
        canvas.glowed ||= glowing;
        frame.exposure(encoder, layers, { glowing, moving });
        // One bloom of all that glows over the frame's exposures, once they're in.
        if (last) {
          const { surface } = canvas, dithered = surface.format.endsWith('8unorm');
          frame.develop(encoder, {
            bloom: canvas.glowed ? { sigma: lensFrame.bloom, strength: 1, glow: 'emission' } : null,
            into: surface.frameTexture().createView(), format: surface.format, encoding: { kind: shotCanvasAlphaMode(shot, canvas.index) === 'opaque' ? 'encoded' : 'premultiplied', dithered },
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
        costs?.retained(owner.cache.bytes());
      }
    };

    let disposed = false;
    return {
      stage,
      warm: ({ fps, sceneDur, stopped = () => false, solving }) => counted(async () => {
        const { warm } = shot;
        if (disposed || !warm) return;
        owner.assertLive();
        for (const warning of sceneDur === null ? [] : shotWarmPastScene(warm, sceneDur)) costs?.warned(paintingProblemText(warning));
        const frames = shotWarmFrames(warm, fps, sceneDur);
        // Each plane's films solved at each pairing of moments the span's frames read, and let go to the cache. A
        // solve reads no lay, so a pinned plane warms unlaid.
        await gpuEachInTurn(shotPaintedSolvables(shot), (plane) => gpuEachInTurn(shotWarmCombinations(frames, shotPlaneClocks(shot.motion, plane), shot.motion.animationFps), async (frame) => {
          if (stopped()) return;
          solving?.(`warming the painted shot's ${plane.id} at ${frame.at} s`);
          (await planes.solve(plane, frame)).release();
        }));
        await textures?.warm(frames, { stopped, ...(solving && { solving }) });
      }),
      draw: (t, mode, pins = new Map()) => counted(async () => {
        if (disposed) return;
        owner.assertLive();
        const pinned = shotPinnedPlanes(shot, pins);
        if (pinned.problems.length) throw paintingProblemsError(`the shot's pins at ${t} s`, pinned.problems);
        const solved: ShotPlaneSolved[] = [];
        try {
          // Each plane's and variant's marks posed and solved once, at the frame's own moment; one after another on the
          // solve lease. A pinned plane is solved where this frame's measures lay it.
          await gpuEachInTurn(shotPaintedSolvables(shot), async (plane) => {
            solved.push(await planes.solve(pinned.planes.get(plane.id) ?? plane, paintMoment(t)));
          });
          await gpuEachInTurn(shotExposures(shot, t, mode), async (exposure) => {
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

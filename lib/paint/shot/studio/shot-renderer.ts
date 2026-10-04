// shot-renderer.ts: a compiled shot drawn on one owner's device into its canvases (ENGINE 6.1). A frame solves each
// painted plane and instanced variant once, at its own moment; then each exposure (a fast frame's one, a reference
// frame's many) lays every plane where it lies at that moment, reads its items, and composites each canvas's planes
// and item batches far to near through that canvas's lens. The first canvas holds the back, opaque unless it's clear
// over HTML; a later one is developed premultiplied over the page. A pinned plane lies where the frame's measures put
// it.
//
// Picture and three planes are the old path's sources, rendered and laid through stamp-lens-source-layers.ts; a
// picture plane's node places it within its plane. Its three sources read no painted textures (shot-compile.ts).

import { paintSimilarityAfter } from '#lib/paint/animation/models/paint-similarity.ts';
import { paintCameraDepthLooks, paintCameraLensFrame, type PaintCameraDepthLooks } from '#lib/paint/animation/models/paint-camera.ts';
import type { PaintingBrushOf } from '#lib/paint/document/models/painting-deposit-compile.ts';
import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { STAMP_REST_LOOK, type StampLaidSourcePlane, type StampLensFrame, type StampPlaneLook } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { createStampLensFrames, createStampLensSourceLayers, stampLensSourcesBlurExtent, type StampSourceRenders } from '#lib/paint/painting/studio/stamp-lens-source-layers.ts';
import { stampLensSourceExposureOf, type StampLensSource, type StampLensSourceExposure } from '#lib/paint/painting/studio/stamp-lens-source.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import type { StampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { loadStampPictureSources } from '#lib/paint/painting/studio/stamp-picture-sources.ts';
import { createStampGrowingUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import { loadPaintedThreeSources, type PaintedThreeTexturesSupplied } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import { lensExposures } from '#lib/picture/lens/models/lens-exposures.ts';
import { LENS_REFERENCE_EXPOSURES, type LensMode } from '#lib/picture/lens/models/lens-mode.ts';
import { shutterMomentAt, shutterOpensAt } from '#lib/picture/lens/models/lens-shutter.ts';
import { createLensCompositor, type LensItemsLayer, type LensLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import { paintingProblemsError } from '#lib/paint/document/models/painting-problem.ts';
import { shotCanvasAlphaMode, type CompiledPaintedShot, type CompiledShotPaintedPlane, type CompiledShotPlane } from '../models/shot-compile.ts';
import { shotPinnedPlanes, type ShotPinCentres } from '../models/shot-placement.ts';
import { shotNodePoseAt } from '../models/shot-frame-plan.ts';
import { shotDrawSteps, shotExposureItems, type ShotExposureItems } from '../models/shot-instances.ts';
import { shotDrawableOrder } from '../models/shot-plan.ts';
import type { ShotMomentAt } from '../models/shot-sheet-lays.ts';
import { createShotGroupFade } from './shot-group-pass.ts';
import { shotItemsLayer } from './shot-instance-passes.ts';
import { createShotPaintedPlanes, type ShotPlaneMoment, type ShotPlaneSolved } from './shot-painted-plane.ts';
import { createShotRigPictures, createShotRigPiecesDrawer } from './shot-rig-pieces.ts';
import { createShotSheetsLayer } from './shot-sheets-lay.ts';

/** What a shot is painted with: its brushes, and where its solves, readbacks and warnings count. */
export type PaintedShotRendererOptions = { readonly brushOf: PaintingBrushOf; readonly costs?: StampPaintCostTally };

/**
 * A shot drawn a frame at a time: `draw` at frame time `t` in a lens mode, its pinned planes' elements as `pins`
 * measures them at that frame (none needed without pins); `finish` waiting out the GPU.
 */
export type PaintedShotRenderer = {
  readonly stage: StampStage;
  draw: (t: number, mode: LensMode, pins?: ShotPinCentres) => Promise<void>;
  finish: () => Promise<void>;
  dispose: () => void;
};

const SHOT_NO_PAINTED_TEXTURES: PaintedThreeTexturesSupplied = { handles: [], update: () => Promise.resolve() };

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

const isPainted = (plane: CompiledShotPlane): plane is CompiledShotPaintedPlane => plane.kind === 'painted';

/** `run` on each of `items` in turn, each finished before the next starts: GPU work that shares targets and a lease. */
const eachInTurn = <T,>(items: Iterable<T>, run: (item: T) => Promise<void>): Promise<void> =>
  [...items].reduce(async (before, item) => {
    await before;
    await run(item);
  }, Promise.resolve());

/**
 * `shot` on `owner`'s device, drawn into `surfaces`, one a canvas in the shot's canvas order, each the camera's frame
 * size and handing the browser its alpha as shotCanvasAlphaMode says.
 */
export async function createPaintedShotRenderer(owner: StampPaintGpuOwner, surfaces: readonly StampPaintSurface[], shot: CompiledPaintedShot, { brushOf, costs }: PaintedShotRendererOptions): Promise<PaintedShotRenderer> {
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
    const three = threeSources.length ? await loadPaintedThreeSources(owner, camera, threeSources, SHOT_NO_PAINTED_TEXTURES) : null;
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
    // A variant is a finished picture laid whole: it lies still at each exposure's moment.
    const variants = new Set(shot.instanced.flatMap((plane) => [...plane.variants.values()].map(({ painted }) => painted)));

    /** A picture plane's look: its view after its node's placement within it, at the moment and the shutter's ends. */
    const pictureLook = (id: string, look: StampPlaneLook, { at, shutter }: ShotMomentAt): StampPlaneLook => {
      const node = shot.motion.nodes.get(id);
      if (!node) return look;
      const placed = (view: StampPlaneLook['view'], m: PaintMoment) => {
        const pose = shotNodePoseAt(node, m, shot.motion.animationFps, true);
        if (pose.kind !== 'similarity') throw new Error(`shot: picture plane ${id}'s node bends it (${pose.text}); its node only places it`);
        return paintSimilarityAfter(view, pose.map);
      };
      return { ...look, view: placed(look.view, at), shutter: look.shutter && shutter && { open: placed(look.shutter.open, shutter.open), close: placed(look.shutter.close, shutter.close) } };
    };

    /**
     * Encodes and submits one exposure of every canvas, its painted planes and variants as `moments` lays them, its
     * items as `items` reads them.
     */
    const drawExposure = (
      exposure: ShotExposure, moments: ReadonlyMap<CompiledShotPlane, ShotPlaneMoment>, items: ShotExposureItems, renders: readonly StampSourceRenders[], t: number,
    ) => owner.checked(`drawing the shot at ${exposure.at.at} s of ${t} s`, () => {
      arena.reset();
      layer.reserve([...moments.values()].map(({ frame }) => frame));
      const encoder = device.createCommandEncoder(), lensFrame = exposure.lens, fast = !exposure.exposure;
      // The exposure's drawables far to near, consecutive items of a variant blurred alike in one step.
      const steps = shotDrawSteps(shotDrawableOrder(shot.written, items.items), (plane, item) => items.lookOf(plane, item).sigma);
      for (const canvas of canvases) {
        const rendered = renders[canvas.index], lookOf = (id: string) => lensFrame.planes.get(id) ?? STAMP_REST_LOOK;
        const own = steps.filter((step) => canvasOf.get(step.plane) === canvas.index), planOf = (plane: CompiledShotPlane) => moments.get(plane)?.plan;
        const shown = own.flatMap((step) => (step.kind === 'plane' ? [planeOf.get(step.plane)!] : []));
        const glowing = shown.some((plane) => planOf(plane)?.emits);
        const itemsMove = own.some((step) => step.kind === 'items' && step.items.some((item) => items.lookOf(step.plane, item).shutter));
        const moving = fast && (shown.some((plane) => planOf(plane)?.travels || lookOf(plane.id).shutter) || itemsMove || rendered.moved.size > 0);
        const layers = own.flatMap((step): (LensLayer | LensItemsLayer)[] => {
          if (step.kind === 'items') {
            const variant = moments.get(instancedOf.get(step.plane)!.variants.get(step.variant)!.painted)!;
            const laid = shotItemsLayer(encoder, canvas.lens, planes, variant, step, (item) => items.lookOf(step.plane, item));
            return laid ? [laid] : [];
          }
          const plane = planeOf.get(step.plane)!, isBack = plane === opaqueBack, look = lookOf(plane.id);
          if (plane.kind === 'painted') {
            const laid = planes.picture(encoder, canvas.lens, moments.get(plane)!, look);
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

    let disposed = false;
    return {
      stage,
      draw: async (t, mode, pins = new Map()) => {
        if (disposed) return;
        owner.assertLive();
        const pinned = shotPinnedPlanes(shot, pins);
        if (pinned.problems.length) throw paintingProblemsError(`the shot's pins at ${t} s`, pinned.problems);
        const solved: ShotPlaneSolved[] = [];
        try {
          // Each plane's and variant's marks posed and solved once, at the frame's own moment; one after another on the
          // solve lease. A pinned plane's moment is kept under the plane as compiled, which the exposure looks up.
          await eachInTurn([...shot.planes.filter(isPainted), ...variants], async (plane) => {
            solved.push(await planes.solve(pinned.planes.get(plane.id) ?? plane, paintMoment(t)));
          });
          await eachInTurn(shotExposures(shot, t, mode), async (exposure) => {
            const moments = new Map<CompiledShotPlane, ShotPlaneMoment>();
            await eachInTurn(solved, async (each) => {
              const variant = variants.has(each.plane);
              moments.set(variant ? each.plane : planeOf.get(each.plane.id)!, await planes.moment(each, variant ? { at: exposure.at, shutter: null } : exposure));
            });
            const items = shotExposureItems(shot.instanced, shot.motion, exposure, exposure.looks);
            const renders: StampSourceRenders[] = [];
            await eachInTurn(canvases, async (canvas) => {
              renders.push(await canvas.sourceLayers.render(t, stampLensSourceExposureOf(exposure.exposure ?? undefined)));
            });
            await drawExposure(exposure, moments, items, renders, t);
          });
        } finally {
          for (const each of solved) each.release();
        }
      },
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

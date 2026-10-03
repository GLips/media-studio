// shot-renderer.ts: a compiled shot drawn on one owner's device into its canvases (ENGINE 6.1). A frame solves each
// painted plane once, at its own moment; then each exposure (a fast frame's one, a reference frame's many) lays every
// plane where it lies at that moment and composites each canvas's planes far to near through that canvas's lens. The
// first canvas holds the back and is opaque; a later one is developed premultiplied over the page.
//
// Picture and three planes are the old path's sources, rendered and laid through stamp-lens-source-layers.ts; a
// picture plane's node places it within its plane. Its three sources read no painted textures (shot-compile.ts).

import { paintSimilarityAfter } from '#lib/paint/animation/models/paint-similarity.ts';
import { paintCameraLensAt } from '#lib/paint/animation/models/paint-camera.ts';
import type { PaintingBrushOf } from '#lib/paint/document/models/painting-deposit-compile.ts';
import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { STAMP_REST_LOOK, type StampLaidSourcePlane, type StampPlaneLook } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { createStampLensFrames, createStampLensSourceLayers, stampLensSourcesBlurExtent, type StampSourceRenders } from '#lib/paint/painting/studio/stamp-lens-source-layers.ts';
import { stampLensSourceExposureOf, type StampLensSource, type StampLensSourceExposure } from '#lib/paint/painting/studio/stamp-lens-source.ts';
import type { StampPaintDevice } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import type { StampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { loadStampPictureSources } from '#lib/paint/painting/studio/stamp-picture-sources.ts';
import { createStampUniformArena, type StampUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import { loadPaintedThreeSources, type PaintedThreeTexturesSupplied } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import { lensExposures } from '#lib/picture/lens/models/lens-exposures.ts';
import { LENS_REFERENCE_EXPOSURES, type LensMode } from '#lib/picture/lens/models/lens-mode.ts';
import { shutterMomentAt, shutterOpensAt } from '#lib/picture/lens/models/lens-shutter.ts';
import { createLensCompositor, type LensLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane, CompiledShotPlane } from '../models/shot-compile.ts';
import { shotNodePoseAt } from '../models/shot-frame-plan.ts';
import { createShotGroupFade } from './shot-group-pass.ts';
import { createShotPaintedPlanes, type ShotMomentAt, type ShotPlaneMoment, type ShotPlaneSolved } from './shot-painted-plane.ts';
import { createShotRigPictures, createShotRigPiecesDrawer } from './shot-rig-pieces.ts';
import { createShotSheetsLayer } from './shot-sheets-lay.ts';

/** What a shot is painted with: its brushes, and where its solves, readbacks and warnings count. */
export type PaintedShotRendererOptions = { readonly brushOf: PaintingBrushOf; readonly costs?: StampPaintCostTally };

/** A shot drawn a frame at a time: `draw` at frame time `t` in a lens mode, `finish` waiting out the GPU. */
export type PaintedShotRenderer = {
  readonly stage: StampStage;
  draw: (t: number, mode: LensMode) => Promise<void>;
  finish: () => Promise<void>;
  dispose: () => void;
};

const SHOT_NO_PAINTED_TEXTURES: PaintedThreeTexturesSupplied = { handles: [], update: () => Promise.resolve() };

/** How many uniform slots a shot's arena starts with; it grows by doubling. */
const SHOT_UNIFORM_SLOTS = 512;

/**
 * An arena that grows as a submit needs: each full one is kept with its slots until the next reset, and a new one
 * twice its size takes the rest. A frame's slots can't be counted before its rigs and fades are known.
 */
function createShotUniformArena(device: StampPaintDevice): StampUniformArena {
  let size = SHOT_UNIFORM_SLOTS, used = 0;
  const full: StampUniformArena[] = [];
  let current = createStampUniformArena(device, size);
  return {
    slot: (fill) => {
      if (used === size) {
        full.push(current);
        size *= 2;
        current = createStampUniformArena(device, size);
        used = 0;
      }
      used++;
      return current.slot(fill);
    },
    flush: () => {
      for (const arena of full) arena.flush();
      current.flush();
    },
    reset: () => {
      full.length = 0;
      current.reset();
      used = 0;
    },
  };
}

/** One exposure of a frame: its lens, the moment its planes lie at, its shutter's ends when it gathers motion, and the sources' exposure. */
type ShotExposure = ShotMomentAt & { readonly lens: ReturnType<typeof paintCameraLensAt>; readonly exposure: (StampLensSourceExposure & { readonly count: number }) | null };

function shotExposures(shot: CompiledPaintedShot, t: number, mode: LensMode): ShotExposure[] {
  const { camera } = shot, { shutter } = camera.lens;
  if (mode === 'fast') {
    const opens = shutterOpensAt(t, shutter);
    return [{ lens: paintCameraLensAt(camera, t), at: paintMoment(t), shutter: shutter > 0 ? { open: paintMoment(opens, t), close: paintMoment(opens + shutter, t) } : null, exposure: null }];
  }
  return lensExposures(LENS_REFERENCE_EXPOSURES).map(({ index, count, shutter: share, aperture }) => {
    const at = shutterMomentAt(t, shutter, share);
    return { lens: paintCameraLensAt(camera, t, { at, aperture }), at: paintMoment(at, t), shutter: null, exposure: { index, count, at, aperture } };
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
 * size; the first opaque, the rest premultiplied.
 */
export async function createPaintedShotRenderer(owner: StampPaintGpuOwner, surfaces: readonly StampPaintSurface[], shot: CompiledPaintedShot, { brushOf, costs }: PaintedShotRendererOptions): Promise<PaintedShotRenderer> {
  const { camera } = shot, { stage } = camera, device = owner.webgpu;
  if (surfaces.length !== shot.canvases) throw new Error(`shot: drawn into ${surfaces.length} canvases, and it names ${shot.canvases}`);
  surfaces.forEach((surface, index) => {
    if (surface.width !== stage.frame.width || surface.height !== stage.frame.height) {
      throw new Error(`shot: the camera's frame is ${stage.frame.width} × ${stage.frame.height}, and canvas ${index}'s surface ${surface.width} × ${surface.height}`);
    }
    const alphaMode = index === 0 ? 'opaque' : 'premultiplied';
    if (surface.alphaMode !== alphaMode) throw new Error(`shot: canvas ${index}'s surface is ${surface.alphaMode}; ${index === 0 ? 'the first, holding the back, is opaque' : 'a later one is laid premultiplied over the page'}`);
  });
  const arena = createShotUniformArena(device);
  // Let go of last made first: three's sources before the textures they sample.
  const made: { dispose: () => void }[] = [];
  const release = () => {
    for (const thing of made.splice(0).toReversed()) thing.dispose();
  };
  try {
    const threeSources = shot.planes.flatMap((plane) => (plane.kind === 'three' ? [{ id: plane.id, build: plane.source.build }] : []));
    const three = threeSources.length ? await loadPaintedThreeSources(owner, camera, threeSources, SHOT_NO_PAINTED_TEXTURES) : null;
    if (three) made.push(three);
    const pictures = loadStampPictureSources(device, new Map(shot.planes.flatMap((plane) => (plane.kind === 'picture' ? [[plane.id, plane.source.pictureAt] as const] : []))));
    made.push(pictures);
    const sources = new Map<string, StampLensSource>([...(three?.sources ?? []), ...pictures.sources]);
    const piecesDrawer = [...shot.rigs.values()].some(({ pieces }) => pieces) ? await createShotRigPiecesDrawer(owner, stage) : null;
    if (piecesDrawer) made.push(piecesDrawer);
    const layer = createShotSheetsLayer(owner, device, { stage, arena, fade: createShotGroupFade(owner, device, arena) });
    const planes = createShotPaintedPlanes(owner, { shot, stage, brushOf, costs, arena, layer, rigPictures: createShotRigPictures(owner, costs), piecesDrawer });
    const canvases = surfaces.map((surface, index) => {
      const shown = shot.planes.filter((plane) => plane.canvas === index), ids = new Set(shown.map(({ id }) => id));
      const own = new Map([...sources].filter(([id]) => ids.has(id)));
      const lens = createLensCompositor(device, { ...stage.frame, blurExtent: stampLensSourcesBlurExtent(stage, own) });
      made.push(lens);
      return { surface, index, planes: shown, lens, frames: createStampLensFrames(lens), sourceLayers: createStampLensSourceLayers(owner, { stage, lens, sources: own }), glowed: false };
    });
    const back = shot.planes[0];

    /** A picture plane's look: its view after its node's placement within it, at the moment and the shutter's ends. */
    const pictureLook = (id: string, look: StampPlaneLook, { at, shutter }: ShotMomentAt): StampPlaneLook => {
      const node = shot.motion.nodes.get(id);
      if (!node) return look;
      const placed = (view: StampPlaneLook['view'], m: PaintMoment) => {
        const pose = shotNodePoseAt(node, m, shot.motion.animationFps);
        if (pose.kind !== 'similarity') throw new Error(`shot: picture plane ${id}'s node bends it (${pose.text}); its node only places it`);
        return paintSimilarityAfter(view, pose.map);
      };
      return { ...look, view: placed(look.view, at), shutter: look.shutter && shutter && { open: placed(look.shutter.open, shutter.open), close: placed(look.shutter.close, shutter.close) } };
    };

    /** Encodes and submits one exposure of every canvas, its painted planes as `moments` lays them. */
    const drawExposure = (exposure: ShotExposure, moments: ReadonlyMap<string, ShotPlaneMoment>, renders: readonly StampSourceRenders[], t: number) => owner.checked(`drawing the shot at ${exposure.at.at} s of ${t} s`, () => {
      arena.reset();
      layer.reserve([...moments.values()].map(({ frame }) => frame));
      const encoder = device.createCommandEncoder(), lensFrame = exposure.lens, fast = !exposure.exposure;
      for (const canvas of canvases) {
        const rendered = renders[canvas.index], lookOf = (id: string) => lensFrame.planes.get(id) ?? STAMP_REST_LOOK;
        const glowing = canvas.planes.some((plane) => moments.get(plane.id)?.emits);
        const moving = fast && (canvas.planes.some((plane) => moments.get(plane.id)?.travels || lookOf(plane.id).shutter) || rendered.moved.size > 0);
        const layers = canvas.planes.flatMap((plane): LensLayer[] => {
          const isBack = plane === back, look = lookOf(plane.id);
          if (plane.kind === 'painted') {
            const laid = planes.picture(encoder, canvas.lens, moments.get(plane.id)!, look, isBack);
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
            into: surface.frameTexture().createView(), format: surface.format, encoding: { kind: canvas.index === 0 ? 'encoded' : 'premultiplied', dithered },
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
      draw: async (t, mode) => {
        if (disposed) return;
        owner.assertLive();
        const solved: ShotPlaneSolved[] = [];
        try {
          // Each plane's marks posed and solved once, at the frame's own moment; one after another on the solve lease.
          await eachInTurn(shot.planes.filter(isPainted), async (plane) => {
            solved.push(await planes.solve(plane, paintMoment(t)));
          });
          await eachInTurn(shotExposures(shot, t, mode), async (exposure) => {
            const moments = new Map<string, ShotPlaneMoment>();
            await eachInTurn(solved, async (each) => {
              moments.set(each.plane.id, await planes.moment(each, exposure));
            });
            const renders: StampSourceRenders[] = [];
            await eachInTurn(canvases, async (canvas) => {
              renders.push(await canvas.sourceLayers.render(t, stampLensSourceExposureOf(exposure.exposure ?? undefined)));
            });
            await drawExposure(exposure, moments, renders, t);
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

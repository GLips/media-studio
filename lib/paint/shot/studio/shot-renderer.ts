// shot-renderer.ts: a compiled shot drawn on one owner's device into its canvases. A frame solves each
// painted plane and variant it shows, once, at its moment; then each exposure (a fast frame's one, a reference
// frame's many) evaluates every plane's image where it lies, reads its items, and composites each canvas far
// to near through its lens. The first canvas holds the back. A pinned plane lies where the frame's measures put it.
//
// Picture and three planes are the old path's sources (stamp-lens-source-layers.ts). An alphaOf mask reads its
// drawable where this exposure's camera shows it: through the reader's view, then, for a painted or picture plane,
// the drawable's view undone.

import { paintNodeTimeAt } from '#lib/paint/animation/models/paint-clock.ts';
import { PAINT_SIMILARITY_IDENTITY, paintSimilarityAfter, paintSimilarityInverse, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import { paintViewAcross } from '#lib/paint/animation/models/paint-camera-depths.ts';
import { paintSpanDrawnProblem } from '#lib/paint/animation/models/paint-span-moments.ts';
import { paintingMemosKept } from '#lib/paint/document/models/painting-document-compile.ts';
import { paintingProblemsError } from '#lib/paint/document/models/painting-problem.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { STAMP_REST_LOOK, type StampLaidSourcePlane, type StampPlaneLook } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampStage, StampStageTexels } from '#lib/paint/painting/models/stamp-stage.ts';
import { createStampLensFrames, createStampLensSourceLayers, stampLensSourcesBlurExtent, type StampSourceRenders } from '#lib/paint/painting/studio/stamp-lens-source-layers.ts';
import { stampLensSourceExposureOf, type StampLensSource, type StampLensSourceExposure } from '#lib/paint/painting/studio/stamp-lens-source.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { loadStampPictureSources } from '#lib/paint/painting/studio/stamp-picture-sources.ts';
import { createStampSpanFade } from '#lib/paint/painting/studio/stamp-span-fade-pass.ts';
import { createStampGrowingUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import type { StampPixelBox } from '#lib/paint/painting/models/stamp-blur-region.ts';
import { copyStampLayerForReadback, readStampLayerCopy, type StampLayerReadback } from '#lib/paint/painting/studio/stamp-layer-readback.ts';
import { loadPaintedThreeSources } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import type { LensMode } from '#lib/picture/lens/models/lens-mode.ts';
import { createLensCompositor, type LensItemsLayer, type LensLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import { shotCanvasLayings, shotPaintedSolvables, shotPlaneLeaves, type CompiledPaintedShot, type CompiledShotPaintedPlane, type CompiledShotPlane, type PaintedShotPaintOptions } from '../models/shot-compile.ts';
import { shotImageLeafReads, shotLeafReadMoment, shotMomentMapped } from '../models/shot-effect.ts';
import { shotSolvablesShown, shotWarmShown } from '../models/shot-shown.ts';
import { shotPinnedPlanes, type ShotPinCentres } from '../models/shot-placement.ts';
import { shotNodePoseAt, shotRigReader, shotVisibilityAt, type ShotRigRead } from '../models/shot-frame-plan.ts';
import { shotHistoryPlanner, shotImageReach, shotPlacedReadKey } from '../models/shot-images.ts';
import { shotDrawSteps, shotExposureItems, type CompiledShotInstancedPlane, type CompiledShotVariant, type ShotExposureItems } from '../models/shot-instances.ts';
import { shotDrawablesAt } from '../models/shot-plan.ts';
import type { ShotMomentAt } from '../models/shot-sheet-lays.ts';
import { shotWarmFrames } from '../models/shot-warm.ts';
import { shotCanvasPaintSurfaces, type ShotCanvasSurface } from './shot-canvas.ts';
import { shotExposures, shotExposureAcross, shotExposureView, shotExposureAt, type ShotExposure } from './shot-exposure.ts';
import { shotItemsCoverages, shotItemsLayer, type ShotItemsCoverage } from './shot-instance-passes.ts';
import { shotEffectTableProblems, type ShotEffectGpu, type ShotEffectTable } from './shot-effect-gpu.ts';
import { shotEffectTableWithBuiltins } from './shot-effects-builtin.ts';
import { createShotPaintedPlanes, SHOT_IMAGE_NOTHING, type ShotSharpImage, type ShotImagesAt, type ShotEffectLaid, type ShotImage, type ShotImageRead, type ShotPlaneMoment, type ShotPlaneSolved } from './shot-painted-plane.ts';
import { createShotPaintedTextures, type ShotWarmSolve } from './shot-painted-textures.ts';
import { createShotLightSpillPass, type ShotSpillLaid } from './shot-light-spill-gpu.ts';
import { createShotRigPictures, createShotRigPiecesDrawer } from './shot-rig-pieces.ts';
import { createShotSheetsLayer } from './shot-sheets-lay.ts';
import type { ShotSolveProgress } from './shot-watch.ts';

/**
 * What made the pixels a mask reads of a plane it doesn't lay: a three render's frame and exposure, a picture's alpha
 * and box, or an instanced plane's items (ShotItemsCoverage's key).
 */
type ShotSourceMade =
  | { readonly kind: 'three'; readonly t: number; readonly exposure: StampLensSourceExposure | null }
  | { readonly kind: 'picture'; readonly coverage: string; readonly box: StampStageTexels }
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

/**
 * How a renderer paints: its brushes and costs; `progress`, told of each warm's and each frame's solves; and
 * `effects`, the studio halves of the effects it draws beside the built-ins (shot-effects-builtin.ts).
 */
export type PaintedShotRendererOptions = PaintedShotPaintOptions & { readonly progress?: ShotSolveProgress; readonly effects?: readonly ShotEffectGpu[] };

/** `shot`'s effect table: the built-ins and `effects`. Throws every effect it can't draw (shotEffectTableProblems). */
function shotRendererEffects(shot: CompiledPaintedShot, effects: readonly ShotEffectGpu[]): ShotEffectTable {
  const table = shotEffectTableWithBuiltins(effects), problems = shotEffectTableProblems(shot, table);
  if (problems.length) throw paintingProblemsError("the shot's effects", problems);
  return table;
}

/**
 * A painted image to solve, `laid` as this frame lays it (a pinned plane where its measures put it), and the frame
 * moment it's solved at: a plane's own, or where an effect's read maps it.
 */
type ShotSolveSite = { readonly plane: CompiledShotPaintedPlane; readonly laid: CompiledShotPaintedPlane; readonly at: PaintMoment };

/** The key a site's solve is kept under within a frame: its painted image, by object, and its moment. */
const shotSiteKey = (site: Pick<ShotSolveSite, 'plane' | 'at'>, order: ReadonlyMap<CompiledShotPaintedPlane, number>) => JSON.stringify([order.get(site.plane), site.at.at, site.at.frame]);

/** A plane's image read back unplaced: its picture's layers, and the stage texels they lie over. */
export type ShotImageReadback = { readonly layers: StampLayerReadback; readonly box: StampPixelBox };

/**
 * A shot drawn a frame at a time: `warm` solving its warm span, `draw` at frame `t` in a lens mode, its pins as `pins`
 * measures them, `finish` waiting out the GPU. `image` reads back a plane's sharp image at `at`, unplaced, solving
 * only the planes it reads (null: it lays nothing). Each counts costs and tells `progress` its solves.
 */
export type PaintedShotRenderer = {
  readonly stage: StampStage;
  warm: (run: PaintedShotWarmRun) => Promise<void>;
  draw: (t: number, mode: LensMode, pins?: ShotPinCentres) => Promise<void>;
  image: (plane: string, at: PaintMoment, pins?: ShotPinCentres) => Promise<ShotImageReadback | null>;
  finish: () => Promise<void>;
  dispose: () => void;
};

/** How many uniform slots a shot's arena starts with; it grows as a frame's rigs and fades need. */
const SHOT_UNIFORM_SLOTS = 512;

/**
 * `shot` on `owner`'s device, drawn into `surfaces`, one a canvas in the shot's canvas order, each the camera's frame
 * size and laid as shotCanvasLayings says (createShotCanvasSurface). A glaze's frame keeps what it lets through.
 */
export async function createPaintedShotRenderer(owner: StampPaintGpuOwner, surfaces: readonly ShotCanvasSurface[], shot: CompiledPaintedShot, options: PaintedShotRendererOptions): Promise<PaintedShotRenderer> {
  const { brushOf, costs, progress } = options, effects = shotRendererEffects(shot, options.effects ?? []);
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
    const three = textures && (await loadPaintedThreeSources(owner, camera, shot.light, threeSources, { handles: textures.handles, update: (t) => { progress?.extend?.(textures.handles.length); return textures.solveAt(t, progress); } }));
    if (three) made.push(three);
    const pictures = loadStampPictureSources(webgpu, new Map(shot.planes.flatMap((plane) => (plane.kind === 'picture'
      ? [[plane.id, (moment: PaintMoment) => plane.source.pictureAt(paintNodeTimeAt(plane.sourceClock, moment, sourceFps))] as const]
      : []))));
    made.push(pictures);
    const sources = new Map<string, StampLensSource>([...(three?.sources ?? []), ...pictures.sources]);
    const piecesDrawer = [...shot.rigs.values()].some(({ pieces }) => pieces) ? await createShotRigPiecesDrawer(owner, stage) : null;
    if (piecesDrawer) made.push(piecesDrawer);
    const layer = createShotSheetsLayer(owner, { stage, arena, fade: createStampSpanFade(owner, arena) });
    const planes = createShotPaintedPlanes(owner, { shot, effects, stage, brushOf, costs, arena, layer, rigPictures: createShotRigPictures(owner, costs), piecesDrawer });
    made.push(planes);
    const spill = createShotLightSpillPass(owner, { stage, arena });
    made.push(spill);
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
    // Each effect plane's reads of painted images, in its evaluation's order, and each of those by its index: a site's key.
    const effectPlanes = shot.planes.flatMap((plane) => (plane.kind === 'effect' ? [plane] : []));
    const effectReads = new Map(effectPlanes.map((plane) => [plane, shotImageLeafReads(plane.image)] as const));
    const allReads = [...effectReads.values()].flat();
    const readsByLeaf = new Map([...new Set(allReads.map(({ leaf }) => leaf))].map((plane) => [plane, allReads.filter(({ leaf }) => leaf === plane)]));
    const solvableOrder = new Map(shotPaintedSolvables(shot).map((plane, i) => [plane, i] as const));

    /**
     * The frame moments painted image `plane` is solved at for frame moment `frame`: its own, or each its effect's reads
     * map it to, none before its source begins.
     */
    const solvedAts = (plane: CompiledShotPaintedPlane, frame: PaintMoment): PaintMoment[] =>
      plane.placed ? [frame] : (readsByLeaf.get(plane) ?? []).flatMap((read) => shotLeafReadMoment(shot, read, frame) ?? []);

    /**
     * Where `shown` (shotSolvablesShown's) are solved for frame moment `frame`, each once, laid as `pinned` lays a pinned
     * plane: a plane or variant at it, an effect's input at each moment its reads map it to.
     */
    const solveSites = (shown: readonly CompiledShotPaintedPlane[], frame: PaintMoment, pinned: ReadonlyMap<string, CompiledShotPaintedPlane>): ShotSolveSite[] => {
      const sites = new Map<string, ShotSolveSite>();
      for (const plane of shown) {
        for (const at of solvedAts(plane, frame)) {
          const site = { plane, laid: (plane.placed && pinned.get(plane.id)) || plane, at };
          sites.set(shotSiteKey(site, solvableOrder), site);
        }
      }
      return [...sites.values()];
    };

    /** Where picture plane `id`'s node places its picture within the plane at `m`: picture px to plane px. */
    const pictureNodeMap = (id: string, m: PaintMoment): PaintSimilarity => {
      const node = shot.motion.nodes.get(id);
      if (!node) return PAINT_SIMILARITY_IDENTITY;
      const pose = shotNodePoseAt(node, m, shot.motion.animationFps, { wobble: true, solving: false });
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
     * Plane `id`, a source or instanced plane, as painted plane `reader`'s mask reads it at `exposure` of frame `t`:
     * a picture's alpha where the camera shows it, through its node's placement; a three render's, or the items'
     * (`items`), through the reader's view; each by its visibility. And a key naming what's read.
     */
    const sourceRead = (
      id: string, reader: string, exposure: ShotExposure, renders: readonly StampSourceRenders[], items: (plane: CompiledShotInstancedPlane) => ShotItemsCoverage, t: number,
    ): ShotImageRead => {
      const seen = paintSimilarityAfter(shotExposureView(exposure, reader), planePx), instanced = instancedOf.get(id);
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
      const plane = planeOf.get(id)!, source = sources.get(id), weight = shotVisibilityAt(shot, id, id, exposure.at);
      if (plane.kind === 'three' && source?.kind === 'three') {
        // A three source is posed at its moment: frame t and the exposure name its render.
        const { texture, at } = source.picture, map = throughCamera(seen, at);
        return {
          key: shotSourceReadKey({ kind: 'three', t, exposure: stampLensSourceExposureOf(exposure.exposure ?? undefined) }, weight, map),
          coverage: () => ({ view: texture.createView(), channel: 3, weight, extent: { w: texture.width, h: texture.height }, map }),
        };
      }
      if (plane.kind !== 'picture') throw new Error(`shot: ${reader}'s mask reads ${id}, a ${plane.kind} plane, as a source; only a picture, three or instanced plane renders one`);
      const picture = renders[plane.canvas].pictures.get(id) ?? null;
      // Unseen, it may be scaled to nothing, which no map leads back through.
      if (!picture || weight <= 0) return { key: 'nothing', coverage: () => null };
      const { box } = picture, onPlane = paintSimilarityAfter(shotExposureAcross(exposure)(id, reader), planePx);
      const map = paintSimilarityAfter({ ma: 1, mb: 0, kx: margin - box.x, ky: margin - box.y }, paintSimilarityAfter(paintSimilarityInverse(pictureNodeMap(id, exposure.at)), onPlane));
      return {
        key: shotSourceReadKey({ kind: 'picture', coverage: picture.coverageKey(), box }, weight, map),
        coverage: () => ({ view: picture.texture.createView(), channel: 3, weight, extent: { w: box.w, h: box.h }, map }),
      };
    };

    /**
     * `use` given each of `sites` solved at its moment, by its key, its rigs posed as `read` reads them, one after
     * another on the solve lease, `progress` told of each; each solve's films are let go once `use` is done.
     */
    const withSolved = async <T>(sites: readonly ShotSolveSite[], read: ShotRigRead, use: (solved: ReadonlyMap<string, ShotPlaneSolved>) => Promise<T>): Promise<T> => {
      const solved = new Map<string, ShotPlaneSolved>();
      try {
        await gpuEachInTurn(sites, async (site) => {
          progress?.solving({ what: site.plane.id, at: site.at.at });
          solved.set(shotSiteKey(site, solvableOrder), await planes.solve(site.laid, site.at, read));
          progress?.solved();
        });
        return await use(solved);
      } finally {
        for (const each of solved.values()) each.release();
      }
    };

    /** One exposure's painted planes, effect planes and variants as they lie, its items, and its canvases' source renders. */
    type ShotExposureLaid = {
      readonly moments: ReadonlyMap<string, ShotPlaneMoment>; readonly effects: ReadonlyMap<string, ShotEffectLaid>;
      readonly variantMoments: ReadonlyMap<CompiledShotVariant, ShotPlaneMoment>; readonly items: ShotExposureItems; readonly renders: readonly StampSourceRenders[];
    };

    /**
     * `exposure` of the frame at moment `frame` (`t`, its time) as `solved` (by site) lies at it, each variant still at
     * its moment and each effect's read where its moment map puts it (none before its source begins): its items, and
     * each canvas's sources rendered. An effect plane whose inputs weren't solved is hidden.
     */
    const exposureLaid = async (exposure: ShotExposure, solved: ReadonlyMap<string, ShotPlaneSolved>, frame: PaintMoment, t: number, only?: ReadonlySet<string>): Promise<ShotExposureLaid> => {
      const moments = new Map<string, ShotPlaneMoment>(), variantMoments = new Map<CompiledShotVariant, ShotPlaneMoment>(), effectsLaid = new Map<string, ShotEffectLaid>();
      const solvedAt = (plane: CompiledShotPaintedPlane, at: PaintMoment) => solved.get(shotSiteKey({ plane, at }, solvableOrder));
      await gpuEachInTurn([...solved.values()], async (each) => {
        const variant = variantOf.get(each.plane);
        if (variant) variantMoments.set(variant, await planes.moment(each, { at: exposure.at, shutter: null }));
        else if (each.plane.placed) moments.set(each.plane.id, await planes.moment(each, exposure));
      });
      await gpuEachInTurn(effectPlanes, async (plane) => {
        if (only && !only.has(plane.id)) return;
        const reads = effectReads.get(plane)!, laid = new Map<string, ShotPlaneMoment>(), readAts = reads.map((read) => shotLeafReadMoment(shot, read, frame));
        if (!reads.every(({ leaf }, i) => !readAts[i] || solvedAt(leaf, readAts[i]))) return;
        const leaves = await gpuEachInTurn(reads, async ({ leaf, moments: maps }, i) => {
          const readAt = readAts[i];
          if (!readAt) return null;
          const each = solvedAt(leaf, readAt)!, mapped = (m: PaintMoment) => shotMomentMapped(maps, m);
          const at: ShotMomentAt = { at: mapped(exposure.at), shutter: exposure.shutter && { open: mapped(exposure.shutter.open), close: mapped(exposure.shutter.close) } };
          // Two reads of one input at one moment lay it once.
          const key = JSON.stringify([solvableOrder.get(leaf), readAt, at]);
          let moment = laid.get(key);
          if (!moment) laid.set(key, (moment = await planes.moment(each, at)));
          return moment;
        });
        effectsLaid.set(plane.id, { plane, leaves, at: exposure.at, visibility: shotVisibilityAt(shot, plane.id, plane.id, exposure.at) });
      });
      const items = shotExposureItems(only ? shot.instanced.filter(({ id }) => only.has(id)) : shot.instanced, shot.motion, exposure, exposure.looks);
      const renders = await gpuEachInTurn(canvases, (canvas) => canvas.sourceLayers.render(t, stampLensSourceExposureOf(exposure.exposure ?? undefined), only));
      return { moments, effects: effectsLaid, variantMoments, items, renders };
    };

    /**
     * `laid`'s images at `exposure` of frame `t`, encoded into a new encoder as each is first asked for, with the arena
     * and lay readied for its planes. Those `hidden` this frame weren't solved: they lay nothing, and cover nothing for
     * a mask reading them.
     */
    const exposureImages = (exposure: ShotExposure, laid: ShotExposureLaid, hidden: ReadonlySet<CompiledShotPaintedPlane>, t: number, earlier: ShotImagesAt['earlier']) => {
      arena.reset();
      const effectLeaves = new Set([...laid.effects.values()].flatMap(({ leaves }) => leaves.filter((leaf) => leaf !== null)));
      layer.reserve([...laid.moments.values(), ...laid.variantMoments.values(), ...effectLeaves].flatMap(({ shares }) => shares.map(({ frame }) => frame)));
      const encoder = device.createCommandEncoder();
      const itemsCovered = shotItemsCoverages(encoder, { owner, lenses: canvases.map(({ lens }) => lens), planes, stage }, laid.variantMoments, hidden, laid.items);
      const reads = (id: string, reader: string) => sourceRead(id, reader, exposure, laid.renders, itemsCovered, t);
      return { encoder, image: planes.images(encoder, { moments: laid.moments, effects: laid.effects, hidden, sources: reads, earlier, across: shotExposureAcross(exposure) }) };
    };

    /** Submits `encoder`, every lens's, the arena's and the lay's uniforms uploaded first. */
    const submit = (encoder: GPUCommandEncoder) => {
      for (const canvas of canvases) canvas.lens.flush();
      arena.flush();
      layer.flush();
      device.queue.submit([encoder.finish()]);
    };

    const planHistory = shotHistoryPlanner(shot);
    const drawnRoots = new Set([
      ...shot.written.flatMap((plane) => plane.kind !== 'instanced' && !plane.imageOnly ? [plane.id] : []),
      ...[...shot.spills.values()].flatMap((spills) => spills.map(({ source }) => source)),
    ]);
    /** Retain the requested sharp pixels until the reading exposure submits. Scratch targets may be reused between draws. */
    const withHistory = async <T>(
      exposure: ShotExposure, roots: Iterable<string>, read: ShotRigRead, pins: ReadonlyMap<string, CompiledShotPaintedPlane>,
      use: (earlier: ShotImagesAt['earlier']) => Promise<T>,
    ): Promise<T> => {
      const held = new Map<string, { image: ShotSharpImage; view: PaintSimilarity }>(), releases: (() => void)[] = [];
      const readerAt = (reader: ShotExposure): ShotImagesAt['earlier'] => (id, at, readerId) => {
        const source = held.get(shotPlacedReadKey(id, at))!;
        return { image: source.image, map: paintViewAcross(source.view, shotExposureView(reader, readerId)) };
      };
      try {
        await gpuEachInTurn(planHistory(roots, exposure.at), async ({ id, at }) => {
          const past = shotExposureAt(shot, at, exposure.exposure), reach = shotImageReach(shot.planes, id, at);
          const shown = shotSolvablesShown(shot, [at], read), frame = paintMoment(at.frame);
          const sites = solveSites(shown.shown.filter((plane) => reach.has(plane.id)), frame, pins);
          progress?.extend?.(sites.length);
          await withSolved(sites, read, async (solved) => {
            const laid = await exposureLaid(past, solved, frame, frame.frame, reach);
            const sharp = await owner.checked(`reading ${id} at ${at.at} s`, () => {
              const { encoder, image } = exposureImages(past, laid, shown.hidden, frame.frame, readerAt(past));
              const source = laid.moments.has(id) || laid.effects.has(id) ? image(id) : SHOT_IMAGE_NOTHING;
              const kept = planes.retain(encoder, source, releases);
              submit(encoder);
              return kept;
            });
            held.set(shotPlacedReadKey(id, at), { image: sharp, view: shotExposureView(past, id) });
          });
        });
        return await use(readerAt(exposure));
      } finally {
        for (const unhold of releases) unhold();
      }
    };

    /** Encodes and submits one exposure of every canvas, its planes, variants and items as `lying` lays them, nothing of those `hidden`. */
    const drawExposure = (exposure: ShotExposure, lying: ShotExposureLaid, hidden: ReadonlySet<CompiledShotPaintedPlane>, t: number, earlier: ShotImagesAt['earlier']) =>
      owner.checked(`drawing the shot at ${exposure.at.at} s of ${t} s`, () => {
      const { encoder, image } = exposureImages(exposure, lying, hidden, t, earlier), { moments, effects: laidEffects, variantMoments, items, renders } = lying, lensFrame = exposure.lens, fast = !exposure.exposure;
      // Evaluate the drawn and spill-source images (and their dependencies) before any lens
      // lays a canvas: a mask reading items draws them through their canvas's lens.
      const images = new Map<string, ShotImage>([...drawnRoots].filter((id) => moments.has(id) || laidEffects.has(id)).map((id) => [id, image(id)]));
      // The exposure's drawables far to near at its moment, consecutive items of a variant blurred alike in one step.
      const steps = shotDrawSteps(shotDrawablesAt(shot, items.items, exposure.at), (plane, item) => items.lookOf(plane, item).sigma);
      for (const canvas of canvases) {
        const rendered = renders[canvas.index], lookOf = (id: string) => lensFrame.planes.get(id) ?? STAMP_REST_LOOK;
        const own = steps.filter((step) => canvasOf.get(step.plane) === canvas.index), momentOf = (plane: CompiledShotPlane) => moments.get(plane.id);
        const shown = own.flatMap((step) => (step.kind === 'plane' ? [planeOf.get(step.plane)!] : []));
        const effectEmits = (plane: CompiledShotPlane) => plane.kind === 'effect' && (images.get(plane.id)?.sharp()?.emission ?? null) !== null;
        const glowing = shown.some((plane) => momentOf(plane)?.emits || effectEmits(plane) || rendered.glowing.has(plane.id));
        const itemsMove = own.some((step) => step.kind === 'items' && step.items.some((item) => items.lookOf(step.plane, item).shutter));
        const moving = fast && (shown.some((plane) => momentOf(plane)?.travels || lookOf(plane.id).shutter) || itemsMove || rendered.moved.size > 0);
        /** Plane `id` as the lens takes it this exposure: its image placed, or its source rendered and laid. */
        const planeLayers = (id: string): LensLayer[] => {
          const plane = planeOf.get(id)!, isBack = plane === opaqueBack, look = lookOf(plane.id);
          if (plane.kind === 'painted' || plane.kind === 'effect') {
            const evaluated = images.get(plane.id);
            if (!evaluated) return [];
            const laid = planes.picture(encoder, canvas.lens, evaluated, look);
            return laid ? [laid] : [];
          }
          // The compile refuses the opaque back a visibility: it reads 1.
          const visibility = shotVisibilityAt(shot, plane.id, plane.id, exposure.at);
          if (visibility <= 0) return [];
          const source: StampLaidSourcePlane = plane.kind === 'three' ? { id: plane.id, kind: 'three' } : { id: plane.id, kind: 'picture', extent: plane.source.extent };
          const seen = plane.kind === 'picture' ? pictureLook(plane.id, look, exposure) : look;
          return canvas.sourceLayers.layer(encoder, source, rendered, { look: seen, focus: lensFrame.focus, moving, back: isBack, visibility });
        };
        /**
         * `laid`, plane `id`'s layer, lit by the light other planes throw on it, none from a source hidden or not
         * emitting. A three render is in frame px, so the spill is carried there through the receiver's own view, as
         * if flat at its depth (shot-light-spill.ts's approximation); any other takes it in its own plane px.
         */
        const lit = (id: string, laid: LensLayer): LensLayer => {
          const given = shot.spills.get(id), receiver = planeOf.get(id)!;
          if (!given) return laid;
          const spills = given.flatMap(({ source, reach, gain, added, map = PAINT_SIMILARITY_IDENTITY }): ShotSpillLaid[] => {
            const thrower = images.get(source), sharp = thrower?.sharp(), light = thrower && sharp && spill.light(encoder, sharp, thrower.key, reach);
            if (!light) return [];
            return [{ light, gain, added, map: receiver.kind === 'three' ? paintSimilarityAfter(shotExposureView(exposure, id), map) : map }];
          });
          return spills.length ? spill.lay(encoder, id, laid, spills) : laid;
        };
        const layers = own.flatMap((step): (LensLayer | LensItemsLayer)[] => {
          if (step.kind === 'plane') return planeLayers(step.plane).map((laid) => lit(step.plane, laid));
          const variant = instancedOf.get(step.plane)!.variants.get(step.variant)!;
          if (hidden.has(variant.painted)) return [];
          const laid = shotItemsLayer(encoder, canvas.lens, planes, stage, variantMoments.get(variant)!, step, (item) => items.lookOf(step.plane, item));
          return laid ? [laid] : [];
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
      }
      submit(encoder);
    });

    /** `run`, the device's evictions and uploads meanwhile counted, and the bytes its cache and the page's memos keep after. */
    const counted = async <T>(run: () => Promise<T>): Promise<T> => {
      const evicted = owner.cache.evictions(), uploaded = owner.uploaded();
      try {
        return await run();
      } finally {
        costs?.count('evictions', owner.cache.evictions() - evicted);
        costs?.count('bytes uploaded', owner.uploaded() - uploaded);
        costs?.retained(owner.cache.bytes(), paintingMemosKept());
      }
    };

    let disposed = false;
    return {
      stage,
      warm: ({ fps, sceneDur, mode, stopped = () => false }) => counted(async () => {
        const { warm } = shot;
        if (disposed || !warm) return;
        owner.assertLive();
        const frames = shotWarmFrames(warm, fps, sceneDur), read = shotRigReader(shot.motion);
        // Each plane's films solved at each pairing of moments the span's frames it shows at read, and let go to the
        // cache; then the textures'. A solve reads no lay, so a pinned plane warms unlaid.
        const solves: ShotWarmSolve[] = [
          ...shotPaintedSolvables(shot).flatMap((plane) => {
            const shown = shotWarmShown(shot, plane, frames, mode, read);
            costs?.count('hidden solves skipped', shown.hidden);
            // Adjacent stacks share earlier drawings. Warm each distinct solve site once across the span.
            const ats = shown.frames.flatMap((frame) => solvedAts(plane, frame));
            const unique = new Map(ats.map((at) => [shotSiteKey({ plane, at }, solvableOrder), at]));
            return [...unique.values()].map((at) => ({ solve: { what: plane.id, at: at.at }, run: async () => (await planes.solve(plane, at, read)).release() }));
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
        const outside = paintSpanDrawnProblem(shot.span, t);
        if (outside) throw new Error(`painted shot: ${outside}`);
        const pinned = shotPinnedPlanes(shot, pins);
        if (pinned.problems.length) throw paintingProblemsError(`the shot's pins at ${t} s`, pinned.problems);
        // One read of each rig's pose a moment for the frame: which planes show, and their solves and lays.
        const read = shotRigReader(shot.motion), exposures = shotExposures(shot, t, mode), shown = shotSolvablesShown(shot, exposures.map(({ at }) => at), read);
        costs?.count('hidden solves skipped', shown.hidden.size);
        const frame = paintMoment(t), sites = solveSites(shown.shown, frame, pinned.planes);
        progress?.run({ kind: 'frame', t }, sites.length);
        // Each plane's and variant's marks posed and solved once, at the frame's own moment, if it shows at one of the
        // frame's exposures; an effect's input, at each moment its reads map the frame's to. A pinned plane is solved
        // where this frame's measures lay it.
        await withSolved(sites, read, async (solved) => {
          await gpuEachInTurn(exposures, (exposure) => withHistory(exposure, drawnRoots, read, pinned.planes, async (earlier) =>
            drawExposure(exposure, await exposureLaid(exposure, solved, frame, t), shown.hidden, t, earlier)));
        });
      }),
      image: (id, at, pins = new Map()) => counted(async () => {
        if (disposed) throw new Error(`shot: ${id}'s image asked of a renderer disposed`);
        owner.assertLive();
        const outside = paintSpanDrawnProblem(shot.span, at.frame);
        if (outside) throw new Error(`painted shot: ${outside}`);
        const plane = planeOf.get(id);
        if (plane?.kind !== 'painted' && plane?.kind !== 'effect') throw new Error(`shot: an image is a painted or effect plane's, and ${id} is ${plane ? `a ${plane.kind} plane` : 'no plane of this shot'}`);
        const pinned = shotPinnedPlanes(shot, pins);
        if (pinned.problems.length) throw paintingProblemsError(`the shot's pins at ${at.frame} s`, pinned.problems);
        const read = shotRigReader(shot.motion), exposure = shotExposureAt(shot, at, null), shown = shotSolvablesShown(shot, [at], read), reach = shotImageReach(shot.planes, id, at);
        if (shotPlaneLeaves(plane).some((leaf) => shown.hidden.has(leaf))) return null;
        const frame = paintMoment(at.frame), sites = solveSites(shown.shown.filter((each) => reach.has(each.id)), frame, pinned.planes);
        progress?.run({ kind: 'frame', t: at.frame }, sites.length);
        // A pinned plane's picture is laid where the measures put it, as a frame at `at` would lay it.
        return withSolved(sites, read, (solved) => withHistory(exposure, [id], read, pinned.planes, async (earlier) => {
          const lying = await exposureLaid(exposure, solved, frame, at.frame, reach);
          const copy = await owner.checked(`evaluating ${id}'s image at ${at.at} s`, () => {
            const { encoder, image } = exposureImages(exposure, lying, shown.hidden, at.frame, earlier), sharp = image(id).sharp();
            // A picture's texture starts at its box's first texel.
            const copied = sharp && { box: sharp.box, copy: copyStampLayerForReadback(device, encoder, sharp.texture, { x: 0, y: 0, w: sharp.box.w, h: sharp.box.h }) };
            submit(encoder);
            return copied;
          });
          return copy && { box: copy.box, layers: await readStampLayerCopy(copy.copy) };
        }));
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

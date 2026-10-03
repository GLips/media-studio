// shot-painted-plane.ts: a shot's painted plane drawn for a frame (ENGINE 6.1 steps 1-4 and 6, 6.5). Its selection at
// the frame's source moment is compiled with its boil epochs, its marks posed at the frame's moment (occurrence nodes
// below each sheet's owner, a marks rig's cels) and its sheets solved; then at each moment the frame lays (itself, an
// exposure, a shutter's ends) its sheets lie where their owners and its place put them, a pieces rig is posed, and the
// plane's picture is laid as the lens reads it: the back on its paper, a nearer plane measured on white and black.

import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import { compilePaintingSelection, type PaintingSelectionCompiled } from '#lib/paint/document/models/painting-document-compile.ts';
import type { PaintingBrushOf } from '#lib/paint/document/models/painting-deposit-compile.ts';
import { PAINTING_REST_POSE, paintingPoseAfter, paintingPoseMap, paintingPoseText, type PaintingNodePose, type PaintingPoses } from '#lib/paint/document/models/painting-pose.ts';
import type { LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import { solvePaintingSheetFilms } from '#lib/paint/document/studio/painting-sheets-solve.ts';
import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPlaneLook } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { clearStampTarget, dispatchStampCompute, STAMP_WORKGROUP, stampArrayView } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { STAMP_PLANE_LIGHT, STAMP_PLANE_PICTURE, stampPlaneLightWgsl, stampPlanePictureLayerCount, stampPlanePictureLayers, stampPlanePictureLayersKey, stampPlanePictureWgsl } from '#lib/paint/painting/studio/stamp-paint-plane-passes.ts';
import { stampSheetCompositeTarget, stampSheetsLays, stampSheetsPhotographs, type StampSheetsLays } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import type { StampSheetFilmKept } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import type { StampUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import { gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { lensSigmaStepped } from '#lib/picture/lens/models/lens-focus.ts';
import type { LensCompositor, LensLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import type { PaintRigPicture } from '#lib/paint/rig/models/paint-rig-pieces.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane } from '../models/shot-compile.ts';
import { shotOccurrencePosesAt, shotPlaneLayAt, shotPlanePlaceAt, shotPlaneReseedAt, shotPlaneSelectionAt, shotRigPoseAt, shotVisibilityAt } from '../models/shot-frame-plan.ts';
import type { ShotLattice, ShotShutterAt } from '../models/shot-lattice.ts';
import { shotOccurrenceKey } from '../models/shot-occurrences.ts';
import { shotNodeShift } from '../models/shot-reach.ts';
import {
  shotRigCelPoses, shotRigHiddenCels, shotRigPartAxis, shotRigPartPivot, shotRigPieces, shotRigPiecesPlaced, shotRigPosed, shotRigSkin, type CompiledShotRig, type ShotRigAxis, type ShotRigSkin,
} from '../models/shot-rigs.ts';
import { shotBackGroundBox, shotFadeSpans, shotGroundLattice, shotSelectionStepLays, shotSheetPlaceAt, type ShotPlaneAt } from '../models/shot-sheet-lays.ts';
import type { ShotRigPictures, ShotRigPiecesAt, ShotRigPiecesDrawer, ShotSolvedFilms } from './shot-rig-pieces.ts';
import type { ShotPiecesDrawn, ShotSheetsLayer, ShotSheetsLayFrame, ShotStepFrame } from './shot-sheets-lay.ts';

/** A rig of a plane as its frame's solve found it: its rest cels' axes, and a marks rig's skin over its rest cels. */
type ShotRigFound = { readonly rig: CompiledShotRig; readonly axes: ReadonlyMap<string, ShotRigAxis>; readonly skin: ShotRigSkin | null };

/**
 * A painted plane solved for a frame: its selection, compiled; its sheets' lays and kept films (held until
 * `release`); its rigs as found; and the poses its marks were solved under.
 */
export type ShotPlaneSolved = {
  readonly plane: CompiledShotPaintedPlane;
  readonly selection: LayerSelection;
  readonly compiled: PaintingSelectionCompiled;
  readonly lays: StampSheetsLays;
  readonly films: readonly (readonly StampSheetFilmKept[])[];
  readonly rigs: readonly ShotRigFound[];
  readonly solvedPoses: PaintingPoses;
  readonly release: () => void;
};

/** A pieces rig at one moment: its occurrence, its cut pictures and its pieces. */
type ShotPiecesAt = ShotRigPiecesAt & { readonly rig: string; readonly pictures: readonly PaintRigPicture[] };

/** A painted plane at one moment: what its lay draws, its pieces rigs to draw first, how visible it is, and whether it glows and its paint travels. */
export type ShotPlaneMoment = {
  readonly solved: ShotPlaneSolved;
  readonly frame: Omit<ShotSheetsLayFrame, 'pieces'>;
  readonly pieces: readonly ShotPiecesAt[];
  readonly visibility: number;
  readonly emits: boolean;
  readonly travels: boolean;
};

/** A frame's moment, and its shutter's ends when it gathers what moves over them. */
export type ShotMomentAt = { readonly at: PaintMoment; readonly shutter: { readonly open: PaintMoment; readonly close: PaintMoment } | null };

const travels = (lattice: ShotLattice) => lattice.travel?.some((value) => Math.abs(value) > 1e-6) ?? false;

const piecesTravel = ({ shutter }: ShotRigPiecesAt) =>
  !!shutter && shutter.open.some(({ triangles }, p) => triangles.some((value, v) => v % 4 < 2 && Math.abs(value - shutter.close[p].triangles[v]) > 1e-6));

/** What a painted plane is drawn with on a shot's device: one stage, one arena, one lay, one picture reader and drawer. */
export type ShotPaintedPlanesOptions = {
  readonly shot: CompiledPaintedShot;
  readonly stage: StampStage;
  readonly brushOf: PaintingBrushOf;
  readonly costs?: StampPaintCostTally;
  readonly arena: StampUniformArena;
  readonly layer: ShotSheetsLayer;
  readonly rigPictures: ShotRigPictures;
  readonly piecesDrawer: ShotRigPiecesDrawer | null;
};

/** A shot's painted planes on `owner`'s device. */
export function createShotPaintedPlanes(owner: StampPaintGpuOwner, { shot, stage, brushOf, costs, arena, layer, rigPictures, piecesDrawer }: ShotPaintedPlanesOptions) {
  const { motion } = shot, fps = motion.animationFps, device = owner.device;
  const laysKept = new WeakMap<PaintingSelectionCompiled, StampSheetsLays>(), pipelines = new Map<string, GPUComputePipeline>();
  // Keyed by their code: two documents' compositors may differ in more than their targets.
  const pipelineOf = (code: string) => {
    let pipeline = pipelines.get(code);
    if (!pipeline) pipelines.set(code, (pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } })));
    return pipeline;
  };
  /** `compiled`'s sheets' lays on the shot's stage, made once a compile. */
  async function laysOf(compiled: PaintingSelectionCompiled): Promise<StampSheetsLays> {
    const known = laysKept.get(compiled);
    if (known) return known;
    const photographs = await stampSheetsPhotographs(owner, compiled.sheets);
    const made = stampSheetsLays(owner, device, arena, compiled.sheets, photographs, stage);
    laysKept.set(compiled, made);
    return made;
  }

  /** `plane`'s node poses at `m`: its occurrences' own, and each marks rig's cels' within its group's frame. */
  function posesAt(plane: CompiledShotPaintedPlane, rigs: readonly ShotRigFound[], m: PaintMoment): Map<NodeKey, PaintingNodePose> {
    const poses = shotOccurrencePosesAt(plane, motion, m);
    for (const { rig, axes, skin } of rigs) {
      if (!skin) continue;
      const { pose, groupPivot } = shotRigPoseAt(rig, motion, m);
      for (const [cel, celPose] of shotRigCelPoses(rig, shotRigPosed(rig, pose, groupPivot, axes), skin)) {
        const own = poses.get(cel);
        poses.set(cel, own ? paintingPoseAfter(celPose, own) : celPose);
      }
    }
    return poses;
  }

  /** `rig`'s rest cels as `rest` painted them: its axes, and a marks rig's skin over them. */
  async function rigFound(rig: CompiledShotRig, rest: ShotSolvedFilms): Promise<ShotRigFound> {
    const cels = await rigPictures.restCels(rest, rig), { groupPivot } = shotRigPoseAt(rig, motion, paintMoment(0));
    const axes = new Map(rig.parts.map((part, k) => [part.id, shotRigPartAxis(shotRigPartPivot(part, groupPivot), cels[k])] as const));
    return { rig, axes, skin: rig.pieces ? null : shotRigSkin(rig, cels).skin };
  }

  return {
    /** `plane` at frame moment `frameAt`: its selection compiled, its rigs found at rest, its marks posed and solved. */
    async solve(plane: CompiledShotPaintedPlane, frameAt: PaintMoment): Promise<ShotPlaneSolved> {
      const selection = shotPlaneSelectionAt(plane, frameAt, fps);
      const reseed = shotPlaneReseedAt(plane, motion, selection, frameAt);
      const compiled = compilePaintingSelection(selection.painting, brushOf, { layers: selection.layers, reseed });
      const lays = await laysOf(compiled), at = selection.at, rigs = [...shot.rigs.values()].filter((rig) => rig.plane === plane.id);
      let found: ShotRigFound[] = [];
      if (rigs.length) {
        // A rig's cels at rest: what its axes run along and a marks rig's skin is built over. Kept by their films' keys.
        const rest = await solvePaintingSheetFilms(owner, compiled, { costs, ...(at !== undefined && { at }) });
        try {
          found = await Promise.all(rigs.map((rig) => rigFound(rig, { compiled, films: rest.solved.map(({ films }) => films) })));
        } finally {
          rest.release();
        }
      }
      const solvedPoses = posesAt(plane, found, frameAt);
      const { solved, release } = await solvePaintingSheetFilms(owner, compiled, { poses: solvedPoses, costs, ...(at !== undefined && { at }) });
      return { plane, selection, compiled, lays, films: solved.map(({ films }) => films), rigs: found, solvedPoses, release };
    },

    /** `solved`'s plane as it lies at `moment`: its lattices, its fades, its pieces rigs posed. */
    async moment(solved: ShotPlaneSolved, { at, shutter }: ShotMomentAt): Promise<ShotPlaneMoment> {
      const { plane, compiled, films, rigs, selection } = solved, { tree } = compiled;
      const planeAt = (m: PaintMoment): ShotPlaneAt => ({ place: shotPlanePlaceAt(plane, motion, m), poses: posesAt(plane, rigs, m) });
      const atMoment = planeAt(at), shutterAt: ShotShutterAt<ShotPlaneAt> = shutter && { open: planeAt(shutter.open), close: planeAt(shutter.close) };
      const piecesRigs = rigs.filter(({ rig }) => rig.pieces);
      const filmBoxes = films.map((sheet) => sheet.map(({ box }): StampBox | null => box && { x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h }));
      const hidden = new Set(rigs.filter(({ rig }) => !rig.pieces).flatMap(({ rig }) => shotRigHiddenCels(rig, shotRigPoseAt(rig, motion, at).pose)));
      const steps = shotSelectionStepLays({
        compiled, filmBoxes, solved: solved.solvedPoses, at: atMoment, shutter: shutterAt, pieces: new Map(piecesRigs.map(({ rig }) => [rig.group, rig.occurrence])), hidden,
      });
      const visibilityOf = (key: NodeKey) => shotVisibilityAt(shot, plane.id, shotOccurrenceKey(plane.id, key), at);
      const glowOf = (key: NodeKey) => {
        const nearest = motion.nearest.get(shotOccurrenceKey(plane.id, key));
        return (nearest !== undefined && motion.nodes.get(nearest)?.glow) || null;
      };
      const stepFrames = steps.map((lay): ShotStepFrame | null => {
        if (!lay) return null;
        if (lay.kind !== 'film') return { lay, opacity: 1, glow: null };
        return { lay, opacity: visibilityOf(lay.layer), glow: glowOf(lay.layer) };
      });
      const faded = new Map(plane.occurrences.flatMap(({ kind, node }) => {
        const visibility = kind === 'group' ? visibilityOf(node) : 1;
        return visibility < 1 ? [[node, visibility] as const] : [];
      }));
      const { widthPx, heightPx } = selection.painting.document, ground = selection.ground ?? (plane.back ? 'paper' : 'transparent');
      let groundFrame: ShotSheetsLayFrame['ground'] = null;
      if (ground === 'paper') {
        const still = paintingPoseText(atMoment.place) === PAINTING_REST_POSE && !shutterAt;
        if (plane.back && still) groundFrame = { kind: 'stage' };
        else {
          const planeNode = motion.nodes.get(plane.id), document = { x0: 0, y0: 0, x1: widthPx, y1: heightPx };
          const box = plane.back ? shotBackGroundBox(stage, shotPlaneLayAt(plane, motion, at), planeNode ? shotNodeShift(planeNode, document) : 0) : document;
          groundFrame = { kind: 'placed', lattice: shotGroundLattice(box, atMoment, shutterAt) };
        }
      }
      const pieces = await Promise.all(piecesRigs.map(async ({ rig, axes }): Promise<ShotPiecesAt> => {
        const sheet = compiled.sheets.find(({ sheet: { owner: held } }) => held === rig.group)!.sheet;
        const posedAt = (m: PaintMoment) => {
          const { pose, groupPivot } = shotRigPoseAt(rig, motion, m);
          return shotRigPosed(rig, pose, groupPivot, axes);
        };
        const posed = posedAt(at), shown = rig.parts.map(({ id }) => posed.shown.get(id)!);
        const { skin, pictures } = await rigPictures.pieces({ compiled, films }, rig, shown);
        const placed = (m: PaintMoment, planeAtM: ShotPlaneAt, warn: boolean) => {
          const { pieces: posedPieces, stretches } = shotRigPieces(m === at ? posed : posedAt(m), pictures, skin);
          if (warn) for (const { joint, flips } of stretches) if (flips) costs?.warned(`${rig.occurrence}'s ${joint} joint folds over itself in ${flips} triangle${flips > 1 ? 's' : ''} at ${at.at} s`);
          return shotRigPiecesPlaced(posedPieces, paintingPoseMap(shotSheetPlaceAt(tree, sheet, planeAtM)));
        };
        return {
          rig: rig.occurrence, pictures, at: placed(at, atMoment, true),
          shutter: shutter && shutterAt && { open: placed(shutter.open, shutterAt.open, false), close: placed(shutter.close, shutterAt.close, false) },
        };
      }));
      const frame = { document: { width: widthPx, height: heightPx }, lays: solved.lays, films, steps: stepFrames, ground: groundFrame, fades: shotFadeSpans(compiled, faded) };
      const latticeTravels = !!shutter && ((groundFrame?.kind === 'placed' && travels(groundFrame.lattice)) || stepFrames.some((step) => step && step.lay.kind !== 'pieces' && travels(step.lay.lattice)));
      return {
        solved, frame, pieces, visibility: plane.back ? 1 : shotVisibilityAt(shot, plane.id, plane.id, at),
        emits: stepFrames.some((step) => step?.glow && step.opacity > 0), travels: latticeTravels || pieces.some(piecesTravel),
      };
    },

    /**
     * Draws `moment`'s pieces rigs, then its picture laid as the lens takes it (`look`'s view and defocus, `clipped`
     * unless it's the back): the stage over the plane's paper, or its film measured on white and black. Null for a
     * nearer plane that lays nothing, or one faded out.
     */
    picture(encoder: GPUCommandEncoder, lens: LensCompositor, moment: ShotPlaneMoment, look: StampPlaneLook, back: boolean): LensLayer | null {
      if (!back && moment.visibility <= 0) return null;
      const { lays } = moment.solved, compositor = lays.compositors[0], { width, height, margin } = stage;
      const drawn = new Map<string, ShotPiecesDrawn>();
      for (const posed of moment.pieces) {
        const made = piecesDrawer!.draw(posed.rig, posed.pictures, posed);
        if (made) drawn.set(posed.rig, made);
      }
      const frame: ShotSheetsLayFrame = { ...moment.frame, pieces: drawn }, staged = layer.stage(frame);
      const kind = back ? 'paper' : 'film', traced = moment.travels, layers = stampPlanePictureLayers(kind, { emits: moment.emits, travels: traced });
      const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT;
      const painting = stampSheetCompositeTarget(owner, 'shot painting', stage, lays.painting, usage | GPUTextureUsage.COPY_DST);
      const plain = (name: string) => owner.target(name, { size: [width, height], format: 'rgba16float', usage });
      const emission = layers.emission !== null ? plain('shot emission') : null, motionTarget = layers.motion !== null ? plain('shot motion') : null;
      for (const target of [emission, motionTarget]) if (target) clearStampTarget(encoder, target.createView());
      const into = { painting: { texture: painting.texture, shape: lays.painting, view: painting.view }, emission, motion: motionTarget };
      const lightPipeline = pipelineOf(stampPlaneLightWgsl(compositor, STAMP_WORKGROUP));
      const measure = (box: { x: number; y: number; w: number; h: number }, target: GPUTexture, at: number) => dispatchStampCompute(device, encoder, lightPipeline, [arena.slot((views) => {
        const put = gpuUniformWriter(STAMP_PLANE_LIGHT, views);
        put('origin', [box.x, box.y]);
        put('extent', [box.w, box.h]);
        put('layer', at);
      }), painting.view, stampArrayView(target)], box.w, box.h);
      const picture = owner.target(`shot picture ${moment.solved.plane.id}|${stampPlanePictureLayersKey(layers)}`, {
        size: [width, height, stampPlanePictureLayerCount(layers)], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
      const stageBox = { x: 0, y: 0, w: width, h: height };
      let backingLight: GPUTexture | null = null;
      if (kind === 'film') {
        // The measuring backings' own light, a texel each: the picture pass reads what a film lets through against them.
        backingLight = owner.target('shot backing light', { size: [1, 1, 2], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
        for (const [at, backing] of (['white', 'black'] as const).entries()) {
          lays.lays[0].drawPaper(encoder, painting.view, backing, 1, 1);
          measure({ x: 0, y: 0, w: 1, h: 1 }, backingLight, at);
        }
        if (!layer.lay(encoder, frame, staged, { ...into, backing: 'white' })) return null;
        // Between the lays the picture's colour layer holds the light on white; the picture pass replaces it.
        measure(stageBox, picture, 0);
        layer.lay(encoder, frame, staged, { painting: into.painting, backing: 'black', emission: null, motion: null });
      } else layer.lay(encoder, frame, staged, { ...into, backing: 'paper' });
      const picturePipeline = pipelineOf(stampPlanePictureWgsl(compositor, layers, STAMP_WORKGROUP));
      dispatchStampCompute(device, encoder, picturePipeline, [arena.slot((views) => {
        const put = gpuUniformWriter(STAMP_PLANE_PICTURE, views);
        put('origin', [0, 0]);
        put('extent', [width, height]);
        put('visibility', moment.visibility);
      }), painting.view, emission?.createView() ?? null, stampArrayView(picture), backingLight && stampArrayView(backingLight), motionTarget?.createView() ?? null], width, height);
      let shown = picture;
      // A plane's defocus is frame px: on its picture, it's that over the view's scale.
      const sigma = look.defocus && lensSigmaStepped(look.defocus / Math.hypot(look.view.ma, look.view.mb));
      if (sigma) {
        const count = picture.depthOrArrayLayers;
        shown = owner.target(`shot picture blurred ${moment.solved.plane.id}|${count}`, { size: [width, height, count], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
        lens.gaussian(encoder, { source: stampArrayView(picture), into: stampArrayView(shown), layers: count, sigma, read: stageBox, sourceAt: stageBox, box: stageBox });
      }
      return {
        picture: stampArrayView(shown), layers, view: look.view, shutter: look.shutter, origin: { x: -margin, y: -margin }, size: { w: width, h: height },
        clipped: !back, distance: look.distance, distances: 'layer',
      };
    },
  };
}

export type ShotPaintedPlanes = ReturnType<typeof createShotPaintedPlanes>;

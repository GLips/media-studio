// shot-painted-plane.ts: a shot's painted plane drawn for a frame (ENGINE 6.1 steps 1-4 and 6, 6.5). Each selection its
// source blends at the frame's source moment (one, unless it dissolves) is compiled with its boil epochs, its rigs
// found over all its paint unposed, its marks posed at the frame's moment and its sheets solved. Each moment the frame
// lays (itself, an exposure, a shutter's ends) is planned purely, a plan a selection (shotPlaneLayPlan); this reads its
// pieces rigs' pictures back, and lays each selection's picture as the lens reads it (stamp-plane-picture-pass.ts),
// kept under its plan's key so a plane held still is laid once. A dissolve sums its selections' pictures by weight
// (shot-dissolve-pass.ts).

import { compilePaintingSelection, type PaintingSelectionCompiled } from '#lib/paint/document/models/painting-document-compile.ts';
import type { PaintingBrushOf } from '#lib/paint/document/models/painting-deposit-compile.ts';
import type { PaintingPoses } from '#lib/paint/document/models/painting-pose.ts';
import type { LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import { paintingEvaluationCounts } from '#lib/paint/document/models/painting-source.ts';
import { solvePaintingSheetFilms } from '#lib/paint/document/studio/painting-sheets-solve.ts';
import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPlaneLook } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampArrayView } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { stampPlanePictureLayers } from '#lib/paint/painting/studio/stamp-paint-plane-passes.ts';
import { createStampPlanePictures, type StampPlanePicture } from '#lib/paint/painting/studio/stamp-plane-picture-pass.ts';
import { stampSheetCompositeTarget, stampSheetsLays, stampSheetsPhotographs, type StampSheetsLays } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import type { StampSheetFilmKept } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import type { StampUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import type { LensCompositor, LensLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import type { PaintRigPicture } from '#lib/paint/rig/models/paint-rig-pieces.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane } from '../models/shot-compile.ts';
import { shotPlanePosesAt, shotPlaneReseedAt, shotPlaneSharesAt, shotRigGroupPivot } from '../models/shot-frame-plan.ts';
import { shotRigFound, type ShotRigFound } from '../models/shot-rigs.ts';
import { shotPiecesPlaced, shotPlaneLayPlan, type ShotMomentAt, type ShotPlaneLayPlan, type ShotRigPiecesAt } from '../models/shot-sheet-lays.ts';
import { createShotDissolve, type ShotDissolveShare } from './shot-dissolve-pass.ts';
import type { ShotRigPictures, ShotRigPiecesDrawer, ShotRigRestCels } from './shot-rig-pieces.ts';
import type { ShotPiecesDrawn, ShotSheetsLayer, ShotSheetsLayFrame } from './shot-sheets-lay.ts';

/**
 * One selection a plane's source blends this frame, solved: its weight in the plane's picture; its compile; its
 * sheets' lays and kept films; its rigs as found, and their cels' rest pictures by rig occurrence; and the poses its
 * marks were solved under.
 */
export type ShotShareSolved = {
  readonly selection: LayerSelection;
  readonly weight: number;
  readonly compiled: PaintingSelectionCompiled;
  readonly lays: StampSheetsLays;
  readonly films: readonly (readonly StampSheetFilmKept[])[];
  readonly rigs: readonly ShotRigFound[];
  readonly restCels: ReadonlyMap<string, ShotRigRestCels>;
  readonly solvedPoses: PaintingPoses;
};

/** A painted plane solved for a frame: each selection its source blends, their films held until `release`. */
export type ShotPlaneSolved = { readonly plane: CompiledShotPaintedPlane; readonly shares: readonly ShotShareSolved[]; readonly release: () => void };

/** A pieces rig at one moment: its occurrence, its cut pictures and its pieces. */
type ShotPiecesAt = ShotRigPiecesAt & { readonly rig: string; readonly pictures: readonly PaintRigPicture[] };

/** A selection of a plane at one moment: its plan, what its lay draws, and its pieces rigs to draw first. */
type ShotShareMoment = {
  readonly share: ShotShareSolved;
  readonly plan: ShotPlaneLayPlan;
  readonly frame: Omit<ShotSheetsLayFrame, 'pieces'>;
  readonly pieces: readonly ShotPiecesAt[];
};

/**
 * A painted plane at one moment: each selection it blends as it lies then; whether any glows or travels; and how
 * visible the plane is, its own visibility, alike in every selection's plan.
 */
export type ShotPlaneMoment = {
  readonly plane: CompiledShotPaintedPlane;
  readonly shares: readonly ShotShareMoment[];
  readonly emits: boolean;
  readonly travels: boolean;
  readonly visibility: number;
};

/** What a shot's painted planes are drawn with on its device: one stage, one arena, one lay, one picture reader and drawer. */
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

/** A shot's painted planes on `owner`'s device, their pictures kept in its cache until `dispose`. */
export function createShotPaintedPlanes(owner: StampPaintGpuOwner, { shot, stage, brushOf, costs, arena, layer, rigPictures, piecesDrawer }: ShotPaintedPlanesOptions) {
  const { motion } = shot, { width, height, margin } = stage;
  const laysKept = new WeakMap<PaintingSelectionCompiled, StampSheetsLays>(), pictures = createStampPlanePictures(owner, { stage, arena });
  const dissolve = createShotDissolve(owner, { stage, arena });
  /** `compiled`'s sheets' lays on the shot's stage, made once a compile. */
  async function laysOf(compiled: PaintingSelectionCompiled): Promise<StampSheetsLays> {
    const known = laysKept.get(compiled);
    if (known) return known;
    const photographs = await stampSheetsPhotographs(owner, compiled.sheets);
    const made = stampSheetsLays(owner, owner.device, arena, compiled.sheets, photographs, stage);
    laysKept.set(compiled, made);
    return made;
  }

  /** `selection`, one of `plane`'s at frame moment `frameAt`, compiled, its rigs found, its marks posed and solved. */
  async function solveShare(plane: CompiledShotPaintedPlane, selection: LayerSelection, weight: number, frameAt: PaintMoment) {
    const reseed = shotPlaneReseedAt(plane, motion, selection, frameAt);
    const compiled = compilePaintingSelection(selection.painting, brushOf, { layers: selection.layers, reseed });
    const lays = await laysOf(compiled), at = selection.at, rigs = [...shot.rigs.values()].filter((rig) => rig.plane === plane.id);
    let restCels = new Map<string, ShotRigRestCels>();
    if (rigs.length) {
      // A rig's cels as all its paint makes them, unposed, whatever a timed prefix has painted yet: what its axes run
      // along and its skins are built over. Read back once per set of films.
      const rest = await solvePaintingSheetFilms(owner, compiled, { costs });
      try {
        const films = { compiled, films: rest.solved.map((sheet) => sheet.films) };
        restCels = new Map(await Promise.all(rigs.map(async (rig) => [rig.occurrence, await rigPictures.restCels(films, rig)] as const)));
      } finally {
        rest.release();
      }
    }
    const found = rigs.map((rig) => shotRigFound(rig, shotRigGroupPivot(rig, motion), rig.parts.map(({ cels }) => restCels.get(rig.occurrence)!.get(cels[0])!)));
    const solvedPoses = shotPlanePosesAt(plane, motion, found, frameAt, false);
    const { solved, release } = await solvePaintingSheetFilms(owner, compiled, { poses: solvedPoses, costs, ...(at !== undefined && { at }) });
    const share: ShotShareSolved = { selection, weight, compiled, lays, films: solved.map((sheet) => sheet.films), rigs: found, restCels, solvedPoses };
    return { share, release };
  }

  /** `moment`'s pieces rigs drawn, then `plane` laid into its picture: null for a nearer plane that lays nothing. */
  function paint(encoder: GPUCommandEncoder, plane: CompiledShotPaintedPlane, { share: { lays }, plan, frame: planned, pieces }: ShotShareMoment): StampPlanePicture | null {
    const drawn = new Map<string, ShotPiecesDrawn>();
    for (const posed of pieces) {
      const made = piecesDrawer!.draw(posed.rig, posed.pictures, posed);
      if (made) drawn.set(posed.rig, made);
    }
    const frame: ShotSheetsLayFrame = { ...planned, pieces: drawn }, staged = layer.stage(frame);
    const layers = stampPlanePictureLayers(plane.back ? 'paper' : 'film', { emits: plan.emits, travels: plan.travels });
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT;
    const target = stampSheetCompositeTarget(owner, 'shot painting', stage, lays.painting, usage | GPUTextureUsage.COPY_DST);
    const painting = { texture: target.texture, shape: lays.painting, view: target.view };
    const plain = (name: string) => owner.target(name, { size: [width, height], format: 'rgba16float', usage });
    const emission = layers.emission !== null ? plain('shot emission') : null, motionTarget = layers.motion !== null ? plain('shot motion') : null;
    return pictures.paint(encoder, {
      key: plan.key, compositor: lays.compositors[0], painting: painting.view, layers, emission: emission?.createView() ?? null, motion: motionTarget?.createView() ?? null,
      visibility: plan.visibility,
      paper: (backing, w, h) => lays.lays[0].drawPaper(encoder, painting.view, backing, w, h),
      lay: (backing) => layer.lay(encoder, frame, staged, backing === 'black' ? { painting, backing, emission: null, motion: null } : { painting, backing, emission, motion: motionTarget }),
    });
  }

  /**
   * `moment`'s picture defocused by `sigma` px of its own (0: sharp): each selection's kept, or its pieces rigs drawn
   * and it laid, each blurred as the picture pass keeps it, and a dissolve's summed by weight. Null for a nearer plane
   * that lays nothing, or one faded out.
   */
  function pictureDefocused(encoder: GPUCommandEncoder, lens: LensCompositor, moment: ShotPlaneMoment, sigma: number): StampPlanePicture | null {
    const { plane, shares } = moment;
    if (!plane.back && moment.visibility <= 0) return null;
    const laid = shares.flatMap((share): ShotDissolveShare[] => {
      const found = pictures.find(share.plan.key, encoder);
      costs?.count(found ? 'picture hits' : 'picture misses');
      const sharp = found ?? paint(encoder, plane, share);
      return sharp ? [{ picture: sigma ? pictures.blurred(encoder, lens, sharp, share.plan.key, sigma) : sharp, weight: share.share.weight }] : [];
    });
    if (!laid.length) return null;
    // A selection laying nothing adds nothing: what the others lay is still weighed.
    return laid.length === 1 && laid[0].weight === 1 ? laid[0].picture : dissolve.sum(encoder, stampPlanePictureLayers(plane.back ? 'paper' : 'film', moment), laid);
  }

  return {
    /** `plane` at frame moment `frameAt`: each selection its source blends compiled, its rigs found, its marks posed and solved. */
    async solve(plane: CompiledShotPaintedPlane, frameAt: PaintMoment): Promise<ShotPlaneSolved> {
      // A callback source evaluates its paintings as it's read: those count as the frame's.
      const before = paintingEvaluationCounts(), blended = shotPlaneSharesAt(plane, frameAt, motion.animationFps), after = paintingEvaluationCounts();
      costs?.count('evaluations made', after.made - before.made);
      costs?.count('evaluation memo hits', after.memoHits - before.memoHits);
      const releases: (() => void)[] = [];
      const release = () => {
        for (const each of releases.splice(0)) each();
      };
      try {
        const shares = await gpuEachInTurn(blended, async ({ selection, weight }) => {
          const solved = await solveShare(plane, selection, weight, frameAt);
          releases.push(solved.release);
          return solved.share;
        });
        return { plane, shares, release };
      } catch (error) {
        release();
        throw error;
      }
    },

    /** `solved`'s plane as it lies at `moment` (shotPlaneLayPlan, each selection's), its pieces rigs' pictures read back and posed. */
    async moment({ plane, shares }: ShotPlaneSolved, moment: ShotMomentAt): Promise<ShotPlaneMoment> {
      const laid = await Promise.all(shares.map(async (share): Promise<ShotShareMoment> => {
        const { selection, compiled, films, rigs, restCels, solvedPoses } = share;
        const plan = shotPlaneLayPlan({ shot, plane, selection, compiled, films, solved: solvedPoses, rigs, stage }, moment);
        const pieces = await Promise.all(plan.pieces.map(async (each): Promise<ShotPiecesAt> => {
          const occurrence = each.rig.occurrence, { skin, pictures: cut } = await rigPictures.pieces({ compiled, films }, restCels.get(occurrence)!, each);
          const { at, shutter, stretches } = shotPiecesPlaced(each, skin, cut);
          for (const { joint, flips } of stretches) if (flips) costs?.warned(`${occurrence}'s ${joint} joint folds over itself in ${flips} triangle${flips > 1 ? 's' : ''} at ${moment.at.at} s`);
          return { rig: occurrence, pictures: cut, at, shutter };
        }));
        const { widthPx, heightPx } = selection.painting.document;
        return { share, plan, pieces, frame: { document: { width: widthPx, height: heightPx }, lays: share.lays, films, steps: plan.steps, ground: plan.ground, fades: plan.fades } };
      }));
      return { plane, shares: laid, emits: laid.some(({ plan }) => plan.emits), travels: laid.some(({ plan }) => plan.travels), visibility: laid[0].plan.visibility };
    },

    pictureDefocused,

    /**
     * `moment`'s picture as the lens takes it (`look`'s view and defocus, clipped unless it's the back), as
     * pictureDefocused gives it. Null for a nearer plane that lays nothing, or one faded out.
     */
    picture(encoder: GPUCommandEncoder, lens: LensCompositor, moment: ShotPlaneMoment, look: StampPlaneLook): LensLayer | null {
      const { plane } = moment;
      // A plane's defocus is frame px: on its picture, it's that over the view's scale.
      const picture = pictureDefocused(encoder, lens, moment, look.defocus && look.defocus / Math.hypot(look.view.ma, look.view.mb));
      if (!picture) return null;
      return {
        picture: stampArrayView(picture.texture), layers: picture, view: look.view, shutter: look.shutter, origin: { x: picture.box.x - margin, y: picture.box.y - margin },
        size: picture.box, clipped: !plane.back, distance: look.distance, distances: 'layer',
      };
    },

    /** Gives up the pictures kept, once the frames reading them are submitted. */
    dispose: () => pictures.dispose(),
  };
}

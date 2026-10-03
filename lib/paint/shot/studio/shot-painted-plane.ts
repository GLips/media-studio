// shot-painted-plane.ts: a shot's painted plane drawn for a frame (ENGINE 6.1 steps 1-4 and 6, 6.5). Its selection at
// the frame's source moment is compiled with its boil epochs, its rigs found over all its paint unposed, its marks
// posed at the frame's moment (occurrence nodes below each sheet's owner, a marks rig's cels) and its sheets solved.
// Each moment the frame lays (itself, an exposure, a shutter's ends) is planned purely (shotPlaneLayPlan); this reads
// its pieces rigs' pictures back, and lays its picture as the lens reads it (stamp-plane-picture-pass.ts), kept under
// the plan's key so a plane held still is laid once.

import { compilePaintingSelection, type PaintingSelectionCompiled } from '#lib/paint/document/models/painting-document-compile.ts';
import type { PaintingBrushOf } from '#lib/paint/document/models/painting-deposit-compile.ts';
import type { PaintingPoses } from '#lib/paint/document/models/painting-pose.ts';
import type { LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
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
import type { CompiledPaintedShot, CompiledShotPaintedPlane } from '../models/shot-compile.ts';
import { shotPlanePosesAt, shotPlaneReseedAt, shotPlaneSelectionAt, shotRigGroupPivot } from '../models/shot-frame-plan.ts';
import { shotRigFound, type ShotRigFound } from '../models/shot-rigs.ts';
import { shotPiecesPlaced, shotPlaneLayPlan, type ShotMomentAt, type ShotPlaneLayPlan, type ShotRigPiecesAt } from '../models/shot-sheet-lays.ts';
import type { ShotRigPictures, ShotRigPiecesDrawer, ShotRigRestCels } from './shot-rig-pieces.ts';
import type { ShotPiecesDrawn, ShotSheetsLayer, ShotSheetsLayFrame } from './shot-sheets-lay.ts';

/**
 * A painted plane solved for a frame: its selection, compiled; its sheets' lays and kept films (held until
 * `release`); its rigs as found, and their cels' rest pictures by rig occurrence; and the poses its marks were solved
 * under.
 */
export type ShotPlaneSolved = {
  readonly plane: CompiledShotPaintedPlane;
  readonly selection: LayerSelection;
  readonly compiled: PaintingSelectionCompiled;
  readonly lays: StampSheetsLays;
  readonly films: readonly (readonly StampSheetFilmKept[])[];
  readonly rigs: readonly ShotRigFound[];
  readonly restCels: ReadonlyMap<string, ShotRigRestCels>;
  readonly solvedPoses: PaintingPoses;
  readonly release: () => void;
};

/** A pieces rig at one moment: its occurrence, its cut pictures and its pieces. */
type ShotPiecesAt = ShotRigPiecesAt & { readonly rig: string; readonly pictures: readonly PaintRigPicture[] };

/** A painted plane at one moment: its plan, what its lay draws, and its pieces rigs to draw first. */
export type ShotPlaneMoment = {
  readonly solved: ShotPlaneSolved;
  readonly plan: ShotPlaneLayPlan;
  readonly frame: Omit<ShotSheetsLayFrame, 'pieces'>;
  readonly pieces: readonly ShotPiecesAt[];
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
  const { motion } = shot, fps = motion.animationFps, { width, height, margin } = stage;
  const laysKept = new WeakMap<PaintingSelectionCompiled, StampSheetsLays>(), pictures = createStampPlanePictures(owner, { stage, arena });
  /** `compiled`'s sheets' lays on the shot's stage, made once a compile. */
  async function laysOf(compiled: PaintingSelectionCompiled): Promise<StampSheetsLays> {
    const known = laysKept.get(compiled);
    if (known) return known;
    const photographs = await stampSheetsPhotographs(owner, compiled.sheets);
    const made = stampSheetsLays(owner, owner.device, arena, compiled.sheets, photographs, stage);
    laysKept.set(compiled, made);
    return made;
  }

  /** `moment`'s pieces rigs drawn, then its plane laid into its picture: null for a nearer plane that lays nothing. */
  function paint(encoder: GPUCommandEncoder, { solved: { plane, lays }, plan, frame: planned, pieces }: ShotPlaneMoment): StampPlanePicture | null {
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

  return {
    /** `plane` at frame moment `frameAt`: its selection compiled, its rigs found, its marks posed and solved. */
    async solve(plane: CompiledShotPaintedPlane, frameAt: PaintMoment): Promise<ShotPlaneSolved> {
      const selection = shotPlaneSelectionAt(plane, frameAt, fps);
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
      return { plane, selection, compiled, lays, films: solved.map((sheet) => sheet.films), rigs: found, restCels, solvedPoses, release };
    },

    /** `solved`'s plane as it lies at `moment` (shotPlaneLayPlan), its pieces rigs' pictures read back and posed. */
    async moment(solved: ShotPlaneSolved, moment: ShotMomentAt): Promise<ShotPlaneMoment> {
      const { plane, selection, compiled, films, rigs, restCels, solvedPoses } = solved;
      const plan = shotPlaneLayPlan({ shot, plane, selection, compiled, films, solved: solvedPoses, rigs, stage }, moment);
      const pieces = await Promise.all(plan.pieces.map(async (each): Promise<ShotPiecesAt> => {
        const occurrence = each.rig.occurrence, { skin, pictures: cut } = await rigPictures.pieces({ compiled, films }, restCels.get(occurrence)!, each);
        const { at, shutter, stretches } = shotPiecesPlaced(each, skin, cut);
        for (const { joint, flips } of stretches) if (flips) costs?.warned(`${occurrence}'s ${joint} joint folds over itself in ${flips} triangle${flips > 1 ? 's' : ''} at ${moment.at.at} s`);
        return { rig: occurrence, pictures: cut, at, shutter };
      }));
      const { widthPx, heightPx } = selection.painting.document;
      return { solved, plan, pieces, frame: { document: { width: widthPx, height: heightPx }, lays: solved.lays, films, steps: plan.steps, ground: plan.ground, fades: plan.fades } };
    },

    /**
     * `moment`'s picture as the lens takes it (`look`'s view and defocus, clipped unless it's the back): kept, or its
     * pieces rigs drawn and it laid. Null for a nearer plane that lays nothing, or one faded out.
     */
    picture(encoder: GPUCommandEncoder, lens: LensCompositor, moment: ShotPlaneMoment, look: StampPlaneLook): LensLayer | null {
      const { plan, solved: { plane } } = moment;
      if (!plane.back && plan.visibility <= 0) return null;
      const found = pictures.find(plan.key, encoder);
      costs?.count(found ? 'picture hits' : 'picture misses');
      const sharp = found ?? paint(encoder, moment);
      if (!sharp) return null;
      // A plane's defocus is frame px: on its picture, it's that over the view's scale.
      const picture = look.defocus ? pictures.blurred(encoder, lens, sharp, plan.key, look.defocus / Math.hypot(look.view.ma, look.view.mb)) : sharp;
      return {
        picture: stampArrayView(picture.texture), layers: picture, view: look.view, shutter: look.shutter, origin: { x: picture.box.x - margin, y: picture.box.y - margin },
        size: picture.box, clipped: !plane.back, distance: look.distance, distances: 'layer',
      };
    },

    /** Gives up the pictures kept, once the frames reading them are submitted. */
    dispose: () => pictures.dispose(),
  };
}

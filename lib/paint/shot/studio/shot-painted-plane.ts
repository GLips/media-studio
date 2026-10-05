// shot-painted-plane.ts: a shot's painted plane drawn for a frame (ENGINE 6.1 steps 1-4 and 6, 6.5). Each selection its
// source blends at the frame's source moment is compiled, its rigs found over its paint, its marks posed (poses
// read once a frame: shotRigReader) and its sheets solved. Each moment laid is planned per selection
// (shotPlaneLayPlan); this reads pieces rigs back and lays each selection's picture, kept under its key so a plane
// held still is laid once; a dissolve sums them by weight.
//
// Planes are presented in their masks' order: each keeps the coverage others read in its picture's last layers, and
// a reader's picture is kept under what it read and through what map (shotPresentedKeys).

import { paintSimilarityAfter } from '#lib/paint/animation/models/paint-similarity.ts';
import { compilePaintingSelection, type PaintingSelectionCompiled } from '#lib/paint/document/models/painting-document-compile.ts';
import type { PaintingPoses } from '#lib/paint/document/models/painting-pose.ts';
import type { LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import { paintingEvaluationCounts } from '#lib/paint/document/models/painting-source.ts';
import { solvePaintingSheetFilms } from '#lib/paint/document/studio/painting-sheets-solve.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPlaneLook } from '#lib/paint/painting/models/stamp-plane.ts';
import { STAMP_FILMS_WHOLE } from '#lib/paint/painting/models/stamp-reveal.ts';
import { stampWrapPeriods, type StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampArrayView } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { stampPlanePictureLayers } from '#lib/paint/painting/studio/stamp-paint-plane-passes.ts';
import { stampPlaneGlowsOn } from '#lib/paint/painting/studio/stamp-plane-glow-pass.ts';
import { createStampPlanePictures, type StampPlanePicture } from '#lib/paint/painting/studio/stamp-plane-picture-pass.ts';
import { stampSheetCompositeTarget, stampSheetsLays, stampSheetsPhotographs, type StampSheetsLays } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import type { StampSheetFilmKept } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import type { StampUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import type { LensCompositor, LensLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import type { PaintRigPicture } from '#lib/paint/rig/models/paint-rig-pieces.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane, PaintedShotPaintOptions } from '../models/shot-compile.ts';
import { shotPlanePosesAt, shotPlaneReseedAt, shotPlaneSharesAt, shotRigGroupPivot, type ShotFrameRigs, type ShotRigRead } from '../models/shot-frame-plan.ts';
import { shotPresentedKeys, type ShotMaskAcross } from '../models/shot-masks.ts';
import { shotOccurrencePlane } from '../models/shot-occurrences.ts';
import type { OccurrenceKey } from '../models/shot-props.ts';
import { shotRigFound } from '../models/shot-rigs.ts';
import { shotPiecesPlaced, shotPlaneLayPlan, type ShotMomentAt, type ShotPlaneLayPlan, type ShotRigPiecesAt } from '../models/shot-sheet-lays.ts';
import { createShotDissolve, type ShotDissolveShare } from './shot-dissolve-pass.ts';
import { shotCoverageLayers, shotPictureCoverage, type ShotMaskCoverage } from './shot-mask-passes.ts';
import type { ShotRigPictures, ShotRigPiecesDrawer, ShotRigRestCels } from './shot-rig-pieces.ts';
import type { ShotPiecesDrawn, ShotSheetsLayer, ShotSheetsLayFrame } from './shot-sheets-lay.ts';

/**
 * One selection a plane's source blends this frame, solved: its weight in the plane's picture; its compile; its
 * sheets' lays and kept films; its rigs as found and posed by the frame's one read, which its moments read too, and
 * their cels' rest pictures by rig occurrence; and the poses its marks were solved under.
 */
export type ShotShareSolved = {
  readonly selection: LayerSelection;
  readonly weight: number;
  readonly compiled: PaintingSelectionCompiled;
  readonly lays: StampSheetsLays;
  readonly films: readonly (readonly StampSheetFilmKept[])[];
  readonly rigs: ShotFrameRigs;
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

/** A selection of a plane presented for an exposure: its sharp picture (null: it lays nothing), the key it's kept under, and its weight. */
type ShotSharePresented = { readonly picture: StampPlanePicture | null; readonly key: string; readonly weight: number };

/**
 * A painted plane presented for an exposure: its moment; each selection's sharp picture, none for a nearer plane faded
 * out; the key a reader names it by; and `sharp`, its selections summed, the coverage read of it in its last layers.
 */
export type ShotPlanePresented = {
  readonly moment: ShotPlaneMoment;
  readonly shares: readonly ShotSharePresented[];
  readonly key: string;
  readonly sharp: () => StampPlanePicture | null;
};

/**
 * What a painted plane's alphaOf mask reads of a plane it doesn't lay this exposure, a source or instanced plane or a
 * painted plane hidden this frame: a key naming that coverage's pixels as the reader reads them, and the coverage
 * (null: none), drawn when a lay first asks.
 */
export type ShotSourceRead = { readonly key: string; readonly coverage: () => ShotMaskCoverage | null };

/** Source or instanced plane `plane` as painted plane `reader`'s masks read it this exposure. */
export type ShotSourceReads = (plane: string, reader: string) => ShotSourceRead;

/** A painted plane hidden this frame, as a mask reads it: it lays nothing, so it covers nothing. */
const SHOT_HIDDEN_READ: ShotSourceRead = { key: 'hidden', coverage: () => null };

/** A variant's mask reads: it takes no mask, so it reads nothing. */
const SHOT_READS_NOTHING = (): ShotMaskCoverage | null => null;

/** What a shot's painted planes are drawn with on its device: what it paints with, one stage, one arena, one lay, one picture reader and drawer. */
export type ShotPaintedPlanesOptions = PaintedShotPaintOptions & {
  readonly shot: CompiledPaintedShot;
  readonly stage: StampStage;
  readonly arena: StampUniformArena;
  readonly layer: ShotSheetsLayer;
  readonly rigPictures: ShotRigPictures;
  readonly piecesDrawer: ShotRigPiecesDrawer | null;
};

/** A shot's painted planes on `owner`'s device, their pictures kept in its cache until `dispose`. */
export function createShotPaintedPlanes(owner: StampPaintGpuOwner, { shot, stage, brushOf, costs, arena, layer, rigPictures, piecesDrawer }: ShotPaintedPlanesOptions) {
  const { motion } = shot, { width, height, margin } = stage;
  // A stage texel's point to plane px and back: the stage's origin lies `margin` up and left of the frame's.
  const fromStage = { ma: 1, mb: 0, kx: -margin, ky: -margin }, toStage = { ma: 1, mb: 0, kx: margin, ky: margin };
  // A variant isn't here: a mask reads an instanced plane through its items.
  const paintedOf = new Map(shot.planes.flatMap((plane) => (plane.kind === 'painted' ? [[plane.id, plane] as const] : [])));
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

  /**
   * `selection`, one of `plane`'s at frame moment `frameAt`, compiled, its rigs found over its paint, its marks posed
   * as `read` reads its rigs and solved.
   */
  async function solveShare(plane: CompiledShotPaintedPlane, selection: LayerSelection, weight: number, frameAt: PaintMoment, read: ShotRigRead) {
    const reseed = shotPlaneReseedAt(plane, motion, selection, frameAt);
    const compiled = compilePaintingSelection(selection.painting, brushOf, { layers: selection.layers, reseed, costs });
    const lays = await laysOf(compiled), at = selection.at, rigs = [...shot.rigs.values()].filter((rig) => rig.plane === plane.id);
    let restCels = new Map<string, ShotRigRestCels>();
    if (rigs.length) {
      // A rig's cels as all its paint makes them, unposed, whatever a timed prefix has painted yet: what its axes run
      // along and its skins are built over. Read back once per set of films.
      const rest = await solvePaintingSheetFilms(owner, compiled, { costs });
      try {
        const films = { compiled, films: rest.solved.map((sheet) => sheet.films), reveals: compiled.sheets.map(() => STAMP_FILMS_WHOLE) };
        restCels = new Map(await Promise.all(rigs.map(async (rig) => [rig.occurrence, await rigPictures.restCels(films, rig)] as const)));
      } finally {
        rest.release();
      }
    }
    const found = rigs.map((rig) => shotRigFound(rig, shotRigGroupPivot(rig, motion), rig.parts.map(({ cels: [cel] }) => ({ cel, ...restCels.get(rig.occurrence)!.get(cel)! }))));
    const frameRigs: ShotFrameRigs = { found, read }, solvedPoses = shotPlanePosesAt(plane, motion, frameRigs, frameAt, false);
    const { solved, release } = await solvePaintingSheetFilms(owner, compiled, { poses: solvedPoses, costs, ...(at !== undefined && { at }) });
    const share: ShotShareSolved = { selection, weight, compiled, lays, films: solved.map((sheet) => sheet.films), rigs: frameRigs, restCels, solvedPoses };
    return { share, release };
  }

  /**
   * `moment`, share `share` (its index) of those its plane blends this frame: its pieces rigs drawn, its masks made
   * (each alphaOf mask reading what `coverageOf` gives of its drawable), then `plane` laid into its picture under
   * `key`, the coverage read of it in its last layers: none for a nearer plane that lays nothing.
   */
  function paint(
    encoder: GPUCommandEncoder, plane: CompiledShotPaintedPlane, moment: ShotShareMoment, share: number, key: string, coverageOf: (drawable: OccurrenceKey) => ShotMaskCoverage | null,
  ): StampPlanePicture | null {
    const { share: { lays }, plan, frame: planned, pieces } = moment, drawn = new Map<string, ShotPiecesDrawn>();
    for (const posed of pieces) {
      const made = piecesDrawer!.draw(posed.rig, share, posed.pictures, posed);
      if (made) drawn.set(posed.rig, made);
    }
    const frame: ShotSheetsLayFrame = { ...planned, pieces: drawn }, staged = layer.stage(frame, coverageOf), mask = layer.mask(encoder, staged);
    const layers = stampPlanePictureLayers(plane.opaqueBack ? 'paper' : 'film', { emits: plan.emits, travels: plan.travels, coverage: shotCoverageLayers(plan.reads.length) });
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT;
    const target = stampSheetCompositeTarget(owner, 'shot painting', stage, lays.painting, usage | GPUTextureUsage.COPY_DST, encoder);
    const painting = { texture: target.texture, shape: lays.painting, view: target.view };
    const plain = (name: string) => owner.target(name, { size: [width, height], format: 'rgba16float', usage }, encoder);
    const emission = layers.emission !== null ? plain('shot emission') : null, motionTarget = layers.motion !== null ? plain('shot motion') : null;
    const coverage = layer.coverageTarget(encoder, frame);
    return pictures.paint(encoder, {
      key, compositor: lays.compositors[0], painting: painting.view, layers, emission: emission?.createView() ?? null, motion: motionTarget?.createView() ?? null,
      coverage: coverage?.createView({ dimension: '2d-array' }) ?? null, visibility: plan.visibility,
      paper: (backing, w, h) => lays.lays[0].drawPaper(encoder, painting.view, backing, w, h),
      lay: (backing) => {
        // The first lay, on paper or white, traces.
        const traces = backing !== 'black';
        return layer.lay(encoder, frame, staged, {
          painting, backing, mask, emission: stampPlaneGlowsOn(backing) ? emission : null, motion: traces ? motionTarget : null, coverage: traces ? coverage : null,
        });
      },
    });
  }

  /**
   * Each of `moment`'s selections' sharp pictures under its key in `keys`: kept, or painted (`coverageOf` giving what
   * its alphaOf masks read). None for a nearer plane faded out, which covers nothing either.
   */
  function sharesUnder(
    encoder: GPUCommandEncoder, moment: ShotPlaneMoment, keys: readonly string[], coverageOf: (drawable: OccurrenceKey) => ShotMaskCoverage | null,
  ): ShotSharePresented[] {
    const { plane, shares } = moment;
    if (!plane.opaqueBack && moment.visibility <= 0) return [];
    return shares.map((share, i) => {
      const found = pictures.find(keys[i], encoder);
      costs?.count(found ? 'picture hits' : 'picture misses');
      return { picture: found ?? paint(encoder, plane, share, i, keys[i], coverageOf), key: keys[i], weight: share.share.weight };
    });
  }

  /** Each of `shares` that lays anything, defocused by `sigma` px of its own (0: sharp) as the picture pass keeps it. */
  function defocused(encoder: GPUCommandEncoder, lens: LensCompositor, shares: readonly ShotSharePresented[], sigma: number): ShotDissolveShare[] {
    return shares.flatMap(({ picture, key, weight }) => (picture ? [{ picture: sigma ? pictures.blurred(encoder, lens, picture, key, sigma) : picture, weight }] : []));
  }

  /**
   * `laid`, `moment`'s selections' pictures, summed by weight into one with `coverage` layers after the lens's; a lone
   * selection at weight 1 is its own picture. Null for none.
   */
  function summed(encoder: GPUCommandEncoder, moment: ShotPlaneMoment, laid: readonly ShotDissolveShare[], coverage = 0): StampPlanePicture | null {
    if (!laid.length) return null;
    // A selection laying nothing adds nothing: what the others lay is still weighed.
    if (laid.length === 1 && laid[0].weight === 1) return laid[0].picture;
    return dissolve.sum(encoder, stampPlanePictureLayers(moment.plane.opaqueBack ? 'paper' : 'film', { emits: moment.emits, travels: moment.travels, coverage }), laid);
  }

  /**
   * Variant `moment`'s picture defocused by `sigma` px of its own (0: sharp), each selection kept under its plan's
   * key: an instanced plane takes no mask and none reads it. Null for one that lays nothing, or faded out.
   */
  function pictureDefocused(encoder: GPUCommandEncoder, lens: LensCompositor, moment: ShotPlaneMoment, sigma: number): StampPlanePicture | null {
    const shares = sharesUnder(encoder, moment, moment.shares.map(({ plan }) => plan.key), SHOT_READS_NOTHING);
    return summed(encoder, moment, defocused(encoder, lens, shares, sigma));
  }

  return {
    /**
     * `plane` at frame moment `frameAt`: each selection its source blends compiled, its rigs found, its marks posed and
     * solved, every selection posed by `read`, the frame's reader of its rigs.
     */
    async solve(plane: CompiledShotPaintedPlane, frameAt: PaintMoment, read: ShotRigRead): Promise<ShotPlaneSolved> {
      // A callback source evaluates its paintings as it's read: those count as the frame's.
      const before = paintingEvaluationCounts(), blended = shotPlaneSharesAt(shot, plane, frameAt), after = paintingEvaluationCounts();
      costs?.count('evaluations made', after.made - before.made);
      costs?.count('evaluation memo hits', after.memoHits - before.memoHits);
      const releases: (() => void)[] = [];
      const release = () => {
        for (const each of releases.splice(0)) each();
      };
      try {
        const shares = await gpuEachInTurn(blended, async ({ selection, weight }) => {
          const solved = await solveShare(plane, selection, weight, frameAt, read);
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
          const occurrence = each.rig.occurrence, { skin, pictures: cut } = await rigPictures.pieces({ compiled, films, reveals: plan.reveals }, restCels.get(occurrence)!, each);
          const { at, shutter, stretches } = shotPiecesPlaced(each, skin, cut);
          for (const { joint, flips } of stretches) if (flips) costs?.warned(`${occurrence}'s ${joint} joint folds over itself in ${flips} triangle${flips > 1 ? 's' : ''} at ${moment.at.at} s`);
          return { rig: occurrence, pictures: cut, at, shutter };
        }));
        const { widthPx, heightPx, wrap } = selection.painting.document, periods = stampWrapPeriods({ width: widthPx, height: heightPx }, wrap ?? null);
        return {
          share, plan, pieces,
          frame: {
            document: { width: widthPx, height: heightPx, periods }, lays: share.lays, films, reveals: plan.reveals, steps: plan.steps, ground: plan.ground, fades: plan.fades,
            masks: plan.masks, reads: plan.reads,
          },
        };
      }));
      return { plane, shares: laid, emits: laid.some(({ plan }) => plan.emits), travels: laid.some(({ plan }) => plan.travels), visibility: laid[0].plan.visibility };
    },

    pictureDefocused,

    /**
     * Each of `moments`' planes presented, in the shot's masks' order: each selection's picture kept, or its pieces
     * rigs drawn and it laid, its alphaOf masks reading what planes before it laid, through the camera as `across`
     * maps it, and what `sources` rendered; nothing of a plane `hidden` this frame.
     */
    present(
      encoder: GPUCommandEncoder, moments: ReadonlyMap<string, ShotPlaneMoment>, hidden: ReadonlySet<CompiledShotPaintedPlane>, sources: ShotSourceReads, across: ShotMaskAcross,
    ): ReadonlyMap<string, ShotPlanePresented> {
      const sourceReads = new Map<string, ShotSourceRead>();
      const sourceRead = (plane: string, reader: string) => {
        const painted = paintedOf.get(plane);
        if (painted && hidden.has(painted)) return SHOT_HIDDEN_READ;
        const at = JSON.stringify([plane, reader]);
        let read = sourceReads.get(at);
        if (!read) sourceReads.set(at, (read = sources(plane, reader)));
        return read;
      };
      // A plane's masks are its own, alike in every selection's plan.
      const plans = new Map([...moments].map(([id, { plane, shares }]) => [id, {
        shares: shares.map(({ plan, share }) => ({ key: plan.key, weight: share.weight })), alphaOf: plane.masks.map((mask) => mask.drawable),
      }]));
      const keys = shotPresentedKeys(shot.masks.order, plans, (plane, reader) => sourceRead(plane, reader).key, across);
      const presented = new Map<string, ShotPlanePresented>();
      /**
       * What `reader`'s masks read of `drawable`: a painted plane's coverage from its sharp picture, where the camera
       * shows it (`across`, between stage texels), a source's from its render.
       */
      const coverageOf = (reader: string) => (drawable: OccurrenceKey): ShotMaskCoverage | null => {
        const on = shotOccurrencePlane(drawable), painted = presented.get(on);
        if (!painted) return sourceRead(on, reader).coverage();
        const sharp = painted.sharp(), stageAcross = paintSimilarityAfter(toStage, paintSimilarityAfter(across(on, reader), fromStage));
        return sharp && shotPictureCoverage(sharp, painted.moment.shares[0].plan.reads.findIndex((read) => read.drawable === drawable), stageAcross);
      };
      // The keys hold the planes in the masks' order: each after what it reads.
      for (const [id, key] of keys) {
        const moment = moments.get(id)!, shares = sharesUnder(encoder, moment, key.shares, coverageOf(id));
        const coverage = shotCoverageLayers(moment.shares[0].plan.reads.length);
        let sharp: StampPlanePicture | null | undefined;
        // A dissolve's sum is made once, for whichever wants it first: a reader's mask, or the lens drawing it sharp.
        const sharpSummed = () => (sharp === undefined ? (sharp = summed(encoder, moment, shares.flatMap(({ picture, weight }) => (picture ? [{ picture, weight }] : [])), coverage)) : sharp);
        presented.set(id, { moment, shares, key: key.plane, sharp: sharpSummed });
      }
      return presented;
    },

    /**
     * `presented`'s picture as the lens takes it (`look`'s view and defocus, clipped unless it's the back). Null for a
     * nearer plane that lays nothing, or one faded out.
     */
    picture(encoder: GPUCommandEncoder, lens: LensCompositor, presented: ShotPlanePresented, look: StampPlaneLook): LensLayer | null {
      const { moment } = presented, { plane } = moment;
      // A plane's defocus is frame px: on its picture, it's that over the view's scale.
      const sigma = look.defocus && look.defocus / Math.hypot(look.view.ma, look.view.mb);
      const picture = sigma ? summed(encoder, moment, defocused(encoder, lens, presented.shares, sigma)) : presented.sharp();
      if (!picture) return null;
      // Laid whole: the picture pass took the plane's visibility into its picture already.
      return {
        picture: stampArrayView(picture.texture), layers: picture, view: look.view, shutter: look.shutter, origin: { x: picture.box.x - margin, y: picture.box.y - margin },
        size: picture.box, clipped: !plane.opaqueBack, distance: look.distance, distances: 'layer', visibility: 1,
      };
    },

    /** Gives up the pictures kept, once the frames reading them are submitted. */
    dispose: () => pictures.dispose(),
  };
}

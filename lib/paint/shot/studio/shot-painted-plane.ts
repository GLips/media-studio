// shot-painted-plane.ts: a shot's painted plane drawn for a frame. Each selection its
// source blends at the frame's source moment is compiled, its rigs found over its paint, its marks posed (poses
// read once a frame: shotRigReader) and its sheets solved. Each moment laid is planned per selection
// (shotPlaneLayPlan); this reads pieces rigs back and lays each selection's picture, kept under its key so a plane
// held still is laid once; a dissolve sums them by weight.
//
// A plane's image, its sharp picture at a moment, is evaluated apart from where the lens places it: it asks first
// for what its masks read (an effect plane's, its reads' images), and is kept under what it read and through what
// map (shotImageKeys).

import { paintSimilarityAfter, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import { compilePaintingSelection, type PaintingSelectionCompiled } from '#lib/paint/document/models/painting-document-compile.ts';
import type { PaintingPoses } from '#lib/paint/document/models/painting-pose.ts';
import type { LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import { paintingEvaluationCounts } from '#lib/paint/document/models/painting-source.ts';
import { UNTRACED_NESTING } from '#lib/platform/trace/models/trace-recorder.ts';
import { solvePaintingSheetFilms } from '#lib/paint/document/studio/painting-sheets-solve.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampPictureDefocus, type StampPictureDefocus, type StampPlaneLook } from '#lib/paint/painting/models/stamp-plane.ts';
import { STAMP_FILMS_WHOLE } from '#lib/paint/painting/models/stamp-reveal.ts';
import { stampStageExtent, stampStageTexelsWithin, stampWrapPeriods, type StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampArrayView } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { stampPlanePictureLayers, stampPlanePictureLayerCount } from '#lib/paint/painting/studio/stamp-paint-plane-passes.ts';
import { stampPlaneGlowsOn } from '#lib/paint/painting/studio/stamp-plane-glow-pass.ts';
import { createStampPlanePictures, type StampPictureNote, type StampPlanePicture } from '#lib/paint/painting/studio/stamp-plane-picture-pass.ts';
import { stampSheetCompositeTarget, stampSheetsLays, stampSheetsPhotographs, type StampSheetsLays } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import type { StampSheetFilmKept } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import type { StampUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import type { LensCompositor, LensLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import type { PaintRigPicture } from '#lib/paint/rig/models/paint-rig-pieces.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import type { CompiledPaintedShot, CompiledShotEffectPlane, CompiledShotPaintedPlane, PaintedShotPaintOptions } from '../models/shot-compile.ts';
import { shotDrawingStarted, shotImageLeafReads, shotEffectBox, shotEffectKeyAt, shotEffectTimeAt, type CompiledShotImage } from '../models/shot-effect.ts';
import { shotPlanePosesAt, shotPlaneReseedAt, shotPlaneSharesAt, shotRigGroupPivot, type ShotFrameRigs, type ShotRigRead } from '../models/shot-frame-plan.ts';
import { shotEffectImageKey, shotImageKeys, shotImageReadKey } from '../models/shot-images.ts';
import type { ShotMaskAcross } from '../models/shot-masks.ts';
import { shotOccurrencePlane } from '../models/shot-occurrences.ts';
import type { OccurrenceKey } from '../models/shot-props.ts';
import { shotRigFound } from '../models/shot-rigs.ts';
import { shotPiecesPlaced, shotPlaneLayPlan, type ShotMomentAt, type ShotPlaneLayPlan, type ShotRigPiecesAt } from '../models/shot-sheet-lays.ts';
import { createShotDissolve, type ShotDissolveShare } from './shot-dissolve-pass.ts';
import { createShotEffectPass, type ShotEffectTable } from './shot-effect-gpu.ts';
import { shotCoverageLayers, shotPictureCoverage, type ShotMaskCoverage } from './shot-mask-passes.ts';
import type { ShotRigPictures, ShotRigPiecesDrawer, ShotRigRestCels } from './shot-rig-pieces.ts';
import type { ShotPiecesDrawn, ShotSheetsLayer, ShotSheetsLayFrame } from './shot-sheets-lay.ts';

/** A part of a plane's solve, traced under it: its source's evaluation, a selection's compile, lays and sheet solves. */
const SOLVE_PART = { kind: 'solve-part' } as const;

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

/** A selection of a plane's image: its sharp picture (null: it lays nothing), the key it's kept under, and its weight. */
type ShotImageShare = { readonly picture: StampPlanePicture | null; readonly key: string; readonly weight: number };

/**
 * An image: its sharp picture at one moment, not yet placed by the lens. The key a reader names it by; whether it's
 * the opaque back, laid unclipped; `sharp`, its picture (null: it lays nothing), drawn when first asked; and
 * `defocused`, that picture defocused through a lens as the picture pass keeps it.
 */
export type ShotImage = {
  readonly key: string;
  readonly opaqueBack: boolean;
  readonly sharp: () => StampPlanePicture | null;
  readonly defocused: (lens: LensCompositor, defocus: StampPictureDefocus) => StampPlanePicture | null;
};

export type ShotSharpImage = Pick<ShotImage, 'key' | 'sharp'>;

/**
 * A painted image: its moment, and each selection's sharp picture, none for a nearer plane faded out; its `sharp`, its
 * selections summed, holds the coverage read of it in its last layers.
 */
type ShotPaintedImage = ShotImage & { readonly moment: ShotPlaneMoment };

/**
 * An effect plane as one exposure lays it: the plane; each painted image its effect reads as that read lies
 * (shotImageLeafReads' order), null for a read before its source begins, which lays nothing; the exposure's moment,
 * which an effect varying in time reads (through its reads' moment maps when nested); and the visibility its output
 * is laid at.
 */
export type ShotEffectLaid = {
  readonly plane: CompiledShotEffectPlane; readonly leaves: readonly (ShotPlaneMoment | null)[]; readonly at: PaintMoment; readonly visibility: number;
};

/**
 * What an image reads where an alphaOf mask names a drawable, whatever lays it: another plane's image, a source's
 * render, an instanced plane's items, or a painted plane hidden this frame. A key naming the pixels read as the reader
 * reads them, and their coverage (null: none), drawn when a lay first asks.
 */
export type ShotImageRead = { readonly key: string; readonly coverage: () => ShotMaskCoverage | null };

/** Source or instanced plane `plane` as painted plane `reader`'s masks read it at the images' moment. */
export type ShotSourceReads = (plane: string, reader: string) => ShotImageRead;

/**
 * What a moment's images are evaluated over: each painted plane as it lies (`moments`), each effect plane (`effects`), those `hidden` this frame,
 * what `sources` rendered, and the camera's map between planes, `across`, through which a mask reads.
 */
export type ShotImagesAt = {
  readonly moments: ReadonlyMap<string, ShotPlaneMoment>;
  readonly effects: ReadonlyMap<string, ShotEffectLaid>;
  readonly hidden: ReadonlySet<CompiledShotPaintedPlane>;
  readonly sources: ShotSourceReads;
  readonly across: ShotMaskAcross;
  readonly earlier: (id: string, at: PaintMoment, reader: string) => { image: ShotSharpImage; map: PaintSimilarity };
};

/** A painted plane hidden this frame, as a mask reads it: it lays nothing, so it covers nothing. */
const SHOT_HIDDEN_READ: ShotImageRead = { key: 'hidden', coverage: () => null };

/** An image laying nothing: an effect's read before its source begins. */
export const SHOT_IMAGE_NOTHING: ShotImage = { key: 'nothing', opaqueBack: false, sharp: () => null, defocused: () => null };

/** A variant's mask reads: it takes no mask, so it reads nothing. */
const SHOT_READS_NOTHING = (): ShotMaskCoverage | null => null;

/** What a shot's painted planes are drawn with on its device: what it paints with, one stage, one arena, one lay, one picture reader and drawer. */
export type ShotPaintedPlanesOptions = PaintedShotPaintOptions & {
  readonly shot: CompiledPaintedShot;
  readonly effects: ShotEffectTable;
  readonly stage: StampStage;
  readonly arena: StampUniformArena;
  readonly layer: ShotSheetsLayer;
  readonly rigPictures: ShotRigPictures;
  readonly piecesDrawer: ShotRigPiecesDrawer | null;
};

/** A shot's painted planes on `owner`'s device, their pictures kept in its cache until `dispose`. */
export function createShotPaintedPlanes(owner: StampPaintGpuOwner, { shot, effects, stage, brushOf, costs, arena, layer, rigPictures, piecesDrawer }: ShotPaintedPlanesOptions) {
  const { motion } = shot, { width, height, margin } = stage;
  // A stage texel's point to plane px and back: the stage's origin lies `margin` up and left of the frame's.
  const fromStage = { ma: 1, mb: 0, kx: -margin, ky: -margin }, toStage = { ma: 1, mb: 0, kx: margin, ky: margin };
  // A variant isn't here: a mask reads an instanced plane through its items.
  const paintedOf = new Map(shot.planes.flatMap((plane) => (plane.kind === 'painted' ? [[plane.id, plane] as const] : [])));
  const laysKept = new WeakMap<PaintingSelectionCompiled, StampSheetsLays>(), pictures = createStampPlanePictures(owner, { stage, arena });
  const retainedSums = owner.cache.store<StampPictureNote>('picture');
  const dissolve = createShotDissolve(owner, { stage, arena }), effectPass = createShotEffectPass(owner, { stage, arena, costs });
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
    const trace = costs?.trace() ?? UNTRACED_NESTING, reseed = shotPlaneReseedAt(plane, motion, selection, frameAt);
    // Its digests timed in it (the tally's `digest`): a compile kept from before hashes nothing.
    const compiled = await trace.within('compile', async () => compilePaintingSelection(selection.painting, brushOf, { layers: selection.layers, reseed, costs }), SOLVE_PART);
    const lays = await trace.within('lays', () => laysOf(compiled), SOLVE_PART), at = selection.at, rigs = [...shot.rigs.values()].filter((rig) => rig.plane === plane.id);
    let restCels = new Map<string, ShotRigRestCels>();
    if (rigs.length) {
      // A rig's cels as all its paint makes them, unposed, whatever a timed prefix has painted yet: what its axes run
      // along and its skins are built over. Read back once per set of films.
      const rest = await trace.within('rest solve', () => solvePaintingSheetFilms(owner, compiled, { costs }), SOLVE_PART);
      try {
        const films = { compiled, films: rest.solved.map((sheet) => sheet.films), reveals: compiled.sheets.map(() => STAMP_FILMS_WHOLE) };
        restCels = new Map(await Promise.all(rigs.map(async (rig) => [rig.occurrence, await rigPictures.restCels(films, rig)] as const)));
      } finally {
        rest.release();
      }
    }
    const found = rigs.map((rig) => shotRigFound(rig, shotRigGroupPivot(rig, motion), rig.parts.map(({ cels: [cel] }) => ({ cel, ...restCels.get(rig.occurrence)!.get(cel)! }))));
    const frameRigs: ShotFrameRigs = { found, read }, solvedPoses = shotPlanePosesAt(plane, motion, frameRigs, frameAt, false);
    const { solved, release } = await trace.within('leased solve', () => solvePaintingSheetFilms(owner, compiled, { poses: solvedPoses, costs, ...(at !== undefined && { at }) }), SOLVE_PART);
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
  ): ShotImageShare[] {
    const { plane, shares } = moment;
    if (!plane.opaqueBack && moment.visibility <= 0) return [];
    return shares.map((share, i) => {
      const found = pictures.find(keys[i], encoder);
      costs?.count(found ? 'picture hits' : 'picture misses');
      return { picture: found ?? paint(encoder, plane, share, i, keys[i], coverageOf), key: keys[i], weight: share.share.weight };
    });
  }

  /** Each of `shares` that lays anything, defocused as `defocus` says (null: sharp) as the picture pass keeps it. */
  function defocused(encoder: GPUCommandEncoder, lens: LensCompositor, shares: readonly ShotImageShare[], defocus: StampPictureDefocus | null): ShotDissolveShare[] {
    return shares.flatMap(({ picture, key, weight }) => (picture ? [{ picture: defocus ? pictures.blurred(encoder, lens, picture, key, defocus) : picture, weight }] : []));
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
    return summed(encoder, moment, defocused(encoder, lens, shares, sigma ? { kind: 'even', sigma } : null));
  }

  return {
    /**
     * `plane` at frame moment `frameAt`: each selection its source blends compiled, its rigs found, its marks posed and
     * solved, every selection posed by `read`, the frame's reader of its rigs.
     */
    async solve(plane: CompiledShotPaintedPlane, frameAt: PaintMoment, read: ShotRigRead): Promise<ShotPlaneSolved> {
      // A callback source evaluates its paintings as it's read: those count as the frame's.
      const before = paintingEvaluationCounts();
      const blended = await (costs?.trace() ?? UNTRACED_NESTING).within('evaluate', async () => shotPlaneSharesAt(shot, plane, frameAt), SOLVE_PART);
      const after = paintingEvaluationCounts();
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
            masks: plan.masks, reads: plan.reads, light: shot.light,
          },
        };
      }));
      return { plane, shares: laid, emits: laid.some(({ plan }) => plan.emits), travels: laid.some(({ plan }) => plan.travels), visibility: laid[0].plan.visibility };
    },

    pictureDefocused,

    /**
     * Images at one moment, as `at` lays them, each painted into `encoder` once, when first asked: each selection's
     * picture kept, or laid, its masks reading first the images they name, where the camera shows them, or what
     * `sources` rendered. Nothing of a plane hidden this frame.
     */
    images(encoder: GPUCommandEncoder, { moments, effects: laidEffects, hidden, sources, across, earlier }: ShotImagesAt): (plane: string) => ShotImage {
      const made = new Map<string, ShotImage>(), sourceReads = new Map<string, ShotImageRead>(), leaves = new Map<ShotPlaneMoment, ShotImage>();
      /** What `reader`'s mask reads of `drawable`: an image's coverage where the camera shows it, or a source's. */
      const readOf = (reader: string, drawable: OccurrenceKey): ShotImageRead => {
        const on = shotOccurrencePlane(drawable), painted = paintedOf.get(on);
        if (painted && hidden.has(painted)) return SHOT_HIDDEN_READ;
        if (moments.has(on)) {
          // SAFETY: `moments` holds painted planes alone, and the compile refuses a mask reading an effect plane.
          const read = image(on) as ShotPaintedImage, map = across(on, reader), stageAcross = paintSimilarityAfter(toStage, paintSimilarityAfter(map, fromStage));
          const coverageLayer = read.moment.shares[0].plan.reads.findIndex((each) => each.drawable === drawable);
          return {
            key: shotImageReadKey(read.key, map),
            coverage: () => {
              const sharp = read.sharp();
              return sharp && shotPictureCoverage(sharp, coverageLayer, stageAcross);
            },
          };
        }
        const at = JSON.stringify([on, reader]);
        let read = sourceReads.get(at);
        if (!read) sourceReads.set(at, (read = sources(on, reader)));
        return read;
      };
      /** `moment`'s image, its masks reading what `reads` names (none for an effect's input). */
      const painted = (moment: ShotPlaneMoment, reads: ReadonlyMap<OccurrenceKey, ShotImageRead>): ShotPaintedImage => {
        const keys = shotImageKeys(moment.shares.map(({ plan, share }) => ({ key: plan.key, weight: share.weight })), [...reads].map(([name, { key }]) => ({ name, key })));
        let picturesLaid: ShotImageShare[] | undefined;
        const shares = () => (picturesLaid ??= sharesUnder(encoder, moment, keys.shares, (drawable) => reads.get(drawable)!.coverage()));
        // A placed plane's masks may render items through the lens, before that lens starts the canvas.
        if (moment.plane.placed) shares();
        const coverage = shotCoverageLayers(moment.shares[0].plan.reads.length);
        let sharp: StampPlanePicture | null | undefined;
        // A dissolve's sum is made once, for whichever wants it first: a reader's mask or effect, or the lens drawing it sharp.
        const sharpSummed = () => (sharp === undefined ? (sharp = summed(encoder, moment, shares().flatMap(({ picture, weight }) => (picture ? [{ picture, weight }] : [])), coverage)) : sharp);
        return {
          moment, key: keys.image, opaqueBack: moment.plane.opaqueBack, sharp: sharpSummed,
          defocused: (lens, defocus) => summed(encoder, moment, defocused(encoder, lens, shares(), defocus)),
        };
      };
      /** An effect's input as `moment` lays it: kept by its moment, which every read of it at that moment shares; nothing for none. */
      const leafImage = (moment: ShotPlaneMoment | null): ShotImage => {
        if (!moment) return SHOT_IMAGE_NOTHING;
        let known = leaves.get(moment);
        if (!known) leaves.set(moment, (known = painted(moment, new Map())));
        return known;
      };
      /** Effect plane `laid`'s image: its effect over its reads' images, each asked for first, its output laid at its visibility. */
      const effectImage = (laid: ShotEffectLaid): ShotImage => {
        let leaf = 0;
        const evaluate = (at: Exclude<CompiledShotImage, { kind: 'plane-image' }>, visibility: number, moment: PaintMoment): ShotSharpImage => {
          if (at.kind === 'painted') return leafImage(laid.leaves[leaf++]);
          const gpu = effects.get(at.definition)!, inputs = at.reads.map(({ input, moment: when, map }) => {
            const mapped = when?.(moment) ?? moment;
            if (when && input.kind !== 'painted' && !shotDrawingStarted(shot, laid.plane.sourceClock, mapped)) {
              leaf += shotImageLeafReads(input).length;
              return { image: SHOT_IMAGE_NOTHING, map };
            }
            if (input.kind !== 'plane-image') return { image: evaluate(input, 1, mapped), map };
            if (mapped.frame !== laid.at.frame || mapped.at !== laid.at.at) {
              const past = earlier(input.plane, mapped, laid.plane.id);
              return { image: past.image, map: paintSimilarityAfter(map, past.map) };
            }
            const current = moments.has(input.plane) || laidEffects.has(input.plane) ? image(input.plane) : SHOT_IMAGE_NOTHING;
            return { image: current, map: paintSimilarityAfter(map, across(laid.plane.id, input.plane)) };
          });
          const maps = inputs.map((read) => read.map);
          const key = shotEffectImageKey(shotEffectKeyAt(at, moment), visibility, inputs.map(({ image: input, map }) => ({ key: input.key, map })));
          let sharp: StampPlanePicture | null | undefined;
          const drawn = () => {
            if (sharp !== undefined) return sharp;
            if (visibility <= 0) return null;
            const found = effectPass.find(key, encoder);
            if (found) return (sharp = found);
            const pictured = inputs.map(({ image: input }) => input.sharp());
            // Each input box, plane px, through its read's map, grown, then clipped to the stage.
            const box = at.extent === 'stage' ? stampStageExtent(stage) : shotEffectBox(at, (_, i) => {
              const picture = pictured[i];
              return picture && { x0: picture.box.x - margin, y0: picture.box.y - margin, x1: picture.box.x + picture.box.w - margin, y1: picture.box.y + picture.box.h - margin };
            }, maps);
            const texels = box && stampStageTexelsWithin(stage, box.x0, box.y0, box.x1, box.y1);
            sharp = texels
              ? effectPass.draw(encoder, {
                gpu, params: at.params, time: shotEffectTimeAt(at, moment), reads: maps.map((map, i) => ({ picture: pictured[i], map })), box: texels, visibility, key,
              })
              : null;
            return sharp;
          };
          return { key, sharp: drawn };
        };
        const output = evaluate(laid.plane.image, laid.visibility, laid.at);
        return {
          ...output, opaqueBack: laid.plane.opaqueBack,
          defocused: (lens, defocus) => {
            const picture = output.sharp();
            return picture && pictures.blurred(encoder, lens, picture, output.key, defocus);
          },
        };
      };
      const image = (id: string): ShotImage => {
        const known = made.get(id);
        if (known) return known;
        const effect = laidEffects.get(id);
        let evaluated: ShotImage;
        if (effect) evaluated = effectImage(effect);
        else {
          // A plane's masks are its own, alike in every selection's plan.
          const moment = moments.get(id)!;
          evaluated = painted(moment, new Map(moment.plane.masks.map(({ drawable }) => [drawable, readOf(id, drawable)])));
        }
        made.set(id, evaluated);
        return evaluated;
      };
      return image;
    },

    /** Keep sharp pixels across encoder submissions. A dissolve's scratch texture is copied on its first retained read. */
    retain(encoder: GPUCommandEncoder, image: ShotImage, releases: (() => void)[]): ShotSharpImage {
      const { key } = image, kept = retainedSums.find(key, encoder);
      if (kept) {
        releases.push(retainedSums.hold(key)!);
        return { key, sharp: () => ({ ...kept.note, texture: kept.textures[0] }) };
      }
      const picture = image.sharp();
      if (!picture) return SHOT_IMAGE_NOTHING;
      const hold = effectPass.hold(key) ?? pictures.hold(key);
      if (hold) {
        releases.push(hold);
        return { key, sharp: () => picture };
      }
      const { texture: source, ...note } = picture, { w, h } = picture.box, layers = stampPlanePictureLayerCount(picture);
      const { entry, release } = retainedSums.take(key, encoder, [{
        width: w, height: h, layers, format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
      }], note);
      releases.push(release);
      const [texture] = entry.textures;
      encoder.copyTextureToTexture({ texture: source }, { texture }, [w, h, layers]);
      return { key, sharp: () => ({ ...picture, texture }) };
    },

    /**
     * `image` placed as the lens takes it (`look`'s view and defocus, clipped unless it's the back). Null for a nearer
     * plane that lays nothing, or one faded out.
     */
    picture(encoder: GPUCommandEncoder, lens: LensCompositor, image: ShotImage, look: StampPlaneLook): LensLayer | null {
      const defocus = stampPictureDefocus(look, margin);
      const picture = defocus ? image.defocused(lens, defocus) : image.sharp();
      if (!picture) return null;
      // Laid whole: the picture pass took the plane's visibility into its picture already.
      return {
        picture: stampArrayView(picture.texture), layers: picture, view: look.view, shutter: look.shutter, shear: look.shear, origin: { x: picture.box.x - margin, y: picture.box.y - margin },
        size: picture.box, clipped: !image.opaqueBack, distance: look.distance, distances: 'layer', visibility: 1,
      };
    },

    /** Gives up the pictures kept, once the frames reading them are submitted. */
    dispose: () => {
      pictures.dispose();
      effectPass.dispose();
      retainedSums.dispose();
    },
  };
}

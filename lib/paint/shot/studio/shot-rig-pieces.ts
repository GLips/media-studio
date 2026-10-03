// shot-rig-pieces.ts: what a rig in a shot reads back and draws on the GPU (ENGINE 6.5). A cel's rest picture is its
// films (and, on a shared sheet, the cards of sheets it owns) read back clear, once per set of film keys; a rig's axes
// and a marks rig's skin are found over them. A rig drawn as pieces makes a cel layer of its shown cels' paint alone,
// reads its sheets laid with those cels' films once, cuts that by the cel layer's ownership, and draws the pieces
// through three.js into a stage-sized target with an attachment for their motion, for the plane's lay to lay as paint
// by their alpha.

import { OrthographicCamera, Scene } from 'three/webgpu';
import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import type { PaintingSelectionCompiled } from '#lib/paint/document/models/painting-document-compile.ts';
import type { StampPixelBox } from '#lib/paint/painting/models/stamp-blur-region.ts';
import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { stampBoxUnion, stampStageTexelsWithin, type StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { readStampSheetsPicture, type StampSheetsComposite } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import type { StampSheetFilmKept } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import { createLensThreeMotion, LENS_THREE_MOTION_NAME } from '#lib/picture/lens/studio/lens-three-motion.ts';
import { paintRigPiecesBox, type PaintRigPicture, type PaintRigPiece } from '#lib/paint/rig/models/paint-rig-pieces.ts';
import { createPaintRigPieceMeshes, type PaintRigPieceMeshes } from '#lib/paint/rig/studio/paint-rig-piece-meshes.ts';
import { shotRigCelSteps, shotRigPiecePictures, shotRigSkin, type CompiledShotRig, type ShotRigSkin } from '../models/shot-rigs.ts';
import type { ShotPiecesDrawn } from './shot-sheets-lay.ts';

/** A selection's films as one moment's solve kept them: each sheet's, in its compiled order. */
export type ShotSolvedFilms = { readonly compiled: PaintingSelectionCompiled; readonly films: readonly (readonly StampSheetFilmKept[])[] };

/** How many read-back pictures a shot keeps, the oldest forgotten first: a rig's cels at a few epochs and swaps. */
const SHOT_RIG_PICTURES_KEPT = 64;

const EMPTY: PaintRigPicture = { x0: 0, y0: 0, w: 0, h: 0, rgba: new Float32Array(0) };

const boxOf = (films: readonly StampSheetFilmKept[]) => films.reduce<StampPixelBox | null>((union, { box }) => stampBoxUnion(union, box), null);

/** What a card read back from `films` is keyed by: their keys, so another film under it reads it again. */
const cardFilmsKey = (films: readonly StampSheetFilmKept[]) => films.map(({ key }) => key).join('+');

/**
 * A shot's rig pictures read back on `owner`, kept by what they're read from, counted into `costs`: a cel's, a pieces
 * rig's card, and a pieces rig's cut pictures and skin for a set of shown cels.
 */
export function createShotRigPictures(owner: StampPaintGpuOwner, costs?: StampPaintCostTally) {
  const kept = new Map<string, Promise<unknown>>();
  /** What `make` gives, kept under `key`: made once while kept, a later ask counted as a hit. */
  const keptAs = <T,>(key: string, make: () => Promise<T>): Promise<T> => {
    // SAFETY: a key names one kind of read (its prefix: cel, card or pieces), whose promise was kept under it as a T.
    const known = kept.get(key) as Promise<T> | undefined;
    costs?.count(known ? 'picture hits' : 'picture misses');
    if (known) return known;
    const made = make();
    kept.set(key, made);
    // A failed read isn't kept: the next ask reads again.
    made.catch(() => kept.delete(key));
    if (kept.size > SHOT_RIG_PICTURES_KEPT) kept.delete(kept.keys().next().value!);
    return made;
  };
  /**
   * `solved`'s steps `steps` read back clear, the sheets unmoved, each sheet holding only the films `keeps` keeps: its
   * card's edge is made from those, and a step laying another isn't read.
   */
  const readSteps = (solved: ShotSolvedFilms, steps: readonly number[], keeps: (sheet: number, film: number) => boolean = () => true): Promise<PaintRigPicture> => {
    const { compiled } = solved, films = solved.films.map((each, s) => each.filter((_, f) => keeps(s, f)));
    // Each film's index among those kept, -1 for one left out.
    const remap = solved.films.map((each, s) => {
      let next = 0;
      return each.map((_, f) => (keeps(s, f) ? next++ : -1));
    });
    const laid = steps.map((index) => compiled.steps[index]).filter((step) => step.kind === 'card' || remap[step.sheet][step.film] >= 0);
    const composite: StampSheetsComposite = {
      sheets: compiled.sheets.map(({ program }, s) => ({ program, films: films[s], place: null })),
      steps: laid.map((step) => (step.kind === 'card' ? step : { ...step, film: remap[step.sheet][step.film] })),
    };
    const crop = laid.reduce<StampPixelBox | null>((union, step) => stampBoxUnion(union, step.kind === 'card' ? boxOf(films[step.sheet]) : solved.films[step.sheet][step.film].box), null);
    return crop ? readStampSheetsPicture(owner, composite, crop, 'clear', costs) : Promise.resolve(EMPTY);
  };
  /** Cel `key`'s steps read back clear: with `cards`, the cards of sheets it or a node under it owns; else its paint alone. */
  const cel = (solved: ShotSolvedFilms, key: NodeKey, cards: boolean): Promise<PaintRigPicture> => {
    const steps = shotRigCelSteps(solved.compiled, key).filter((index) => cards || solved.compiled.steps[index].kind === 'film');
    const read = steps.map((index) => {
      const step = solved.compiled.steps[index];
      return step.kind === 'card' ? `card ${cardFilmsKey(solved.films[step.sheet])}` : solved.films[step.sheet][step.film].key;
    });
    return keptAs(`cel|${key}|${read.join('|')}`, () => readSteps(solved, steps));
  };
  return {
    /**
     * Each of `rig`'s parts' rest cel (its first) as `solved` painted it, in the rig's part order: a pieces rig's its
     * paint alone, a marks rig's with the sheets it owns, which move with it.
     */
    restCels: (solved: ShotSolvedFilms, rig: CompiledShotRig) => Promise.all(rig.parts.map((part) => cel(solved, part.cels[0], !rig.pieces))),
    /**
     * A pieces rig's pictures for `shown`, the cel each part shows (in part order): its group's sheet, and those nested
     * in it, laid with the shown cels' films alone on their paper and edge, cut by the cel layer their paint makes into
     * one picture a skin group. Overlapping cels show their paper once, under both.
     */
    pieces: (solved: ShotSolvedFilms, rig: CompiledShotRig, shown: readonly NodeKey[]): Promise<{ readonly skin: ShotRigSkin; readonly pictures: readonly PaintRigPicture[] }> => {
      const { tree, sheets, steps } = solved.compiled, shownLayers = new Set(shown.flatMap((key) => rig.celLayers.get(key)!));
      const inGroup = (sheet: number) => {
        const { owner: held } = sheets[sheet].sheet;
        return held !== null && (held === rig.group || tree.byKey.get(held)!.groups.includes(rig.group));
      };
      // Its sheets, nested ones too, laid with the shown cels' films alone.
      const shownFilm = (sheet: number, film: number) => shownLayers.has(tree.layers[sheets[sheet].layers[film]].node.key);
      const laid = steps.flatMap((step, index) => (inGroup(step.sheet) ? [index] : []));
      const read = laid.map((index) => {
        const step = steps[index];
        if (step.kind === 'card') return `card ${cardFilmsKey(solved.films[step.sheet].filter((_, f) => shownFilm(step.sheet, f)))}`;
        return shownFilm(step.sheet, step.film) ? solved.films[step.sheet][step.film].key : '';
      });
      return keptAs(`pieces|${rig.occurrence}|${shown.join(',')}|${read.join('|')}`, async () => {
        const paint = await Promise.all(shown.map((key) => cel(solved, key, false)));
        const { skin } = shotRigSkin(rig, paint), combined = await readSteps(solved, laid, (sheet, film) => !inGroup(sheet) || shownFilm(sheet, film));
        return { skin, pictures: shotRigPiecePictures(combined, skin) };
      });
    },
  };
}

export type ShotRigPictures = ReturnType<typeof createShotRigPictures>;

/** A pieces rig's pieces at a moment, and at its shutter's ends when the frame gathers their motion. */
export type ShotRigPiecesAt = { readonly at: readonly PaintRigPiece[]; readonly shutter: { readonly open: readonly PaintRigPiece[]; readonly close: readonly PaintRigPiece[] } | null };

/**
 * Pieces rigs drawn on `owner`'s three.js renderer over `stage`: a target of colour and motion each rig, its meshes
 * made anew when its pictures change, so the old ones' textures go with them.
 */
export async function createShotRigPiecesDrawer(owner: StampPaintGpuOwner, stage: StampStage) {
  const { renderer, targetInto } = await owner.three(), { width, height, margin } = stage;
  // Plane px, y down: the stage's first texel row is the frame's top less its margin.
  const camera = new OrthographicCamera(-margin, stage.frame.width + margin, -margin, stage.frame.height + margin, -1, 1);
  camera.updateProjectionMatrix();
  const motion = createLensThreeMotion({ width, height, distanceUnit: 1 });
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
  type Held = { scene: Scene; meshes: PaintRigPieceMeshes; pictures: readonly PaintRigPicture[]; target: ReturnType<typeof targetInto>; colour: GPUTexture; motion: GPUTexture };
  const held = new Map<string, Held>();
  const heldFor = (rig: string, pictures: readonly PaintRigPicture[]): Held => {
    let made = held.get(rig);
    if (made && made.pictures.length === pictures.length && made.pictures.every((picture, p) => picture === pictures[p])) return made;
    if (made) {
      made.meshes.dispose();
      made.pictures = pictures;
      made.meshes = createPaintRigPieceMeshes();
      made.scene.clear();
      made.scene.add(made.meshes.object);
      return made;
    }
    const stageTexture = () => owner.webgpu.createTexture({ size: [width, height], format: 'rgba16float', usage });
    const colour = stageTexture(), moved = stageTexture();
    const meshes = createPaintRigPieceMeshes(), scene = new Scene();
    scene.add(meshes.object);
    const target = targetInto([{ name: 'output', texture: colour }, { name: LENS_THREE_MOTION_NAME, texture: moved }]);
    made = { scene, meshes, pictures, target, colour, motion: moved };
    held.set(rig, made);
    return made;
  };
  return {
    /**
     * Rig `rig`'s `pieces` (each over one of `pictures`) drawn into its target, their travel over the shutter into its
     * motion; null where none lies on the stage. Rendered and submitted now, ahead of the frame that lays it.
     */
    draw(rig: string, pictures: readonly PaintRigPicture[], pieces: ShotRigPiecesAt): ShotPiecesDrawn | null {
      const made = heldFor(rig, pictures), { scene, meshes } = made;
      motion.still();
      if (pieces.shutter) {
        for (const moment of ['open', 'close'] as const) {
          meshes.show(pieces.shutter[moment]);
          motion.record(moment, scene, camera);
        }
        motion.moved(scene);
      }
      meshes.show(pieces.at);
      renderer.setMRT(motion.mrt);
      renderer.setRenderTarget(made.target);
      renderer.render(scene, camera);
      renderer.setMRT(null);
      renderer.setRenderTarget(null);
      const reach = paintRigPiecesBox(pieces.at), box = reach && stampStageTexelsWithin(stage, reach.x0, reach.y0, reach.x0 + reach.w, reach.y0 + reach.h);
      return box && { colour: made.colour.createView(), motion: made.motion.createView(), box };
    },
    dispose() {
      for (const { meshes, target, colour, motion: moved } of held.values()) {
        meshes.dispose();
        target.dispose();
        colour.destroy();
        moved.destroy();
      }
      held.clear();
    },
  };
}

export type ShotRigPiecesDrawer = Awaited<ReturnType<typeof createShotRigPiecesDrawer>>;

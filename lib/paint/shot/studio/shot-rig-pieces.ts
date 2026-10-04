// shot-rig-pieces.ts: what a rig in a shot reads back and draws on the GPU (ENGINE 6.5). A cel's rest picture is its
// films (on a shared sheet, with the cards of sheets it owns) as the whole selection paints them unposed; a rig's
// axes and a marks rig's skin are found over them. A pieces rig skins its shown cels' rest paint, reads its sheets
// laid with those cels' films so far, cuts that by the skin, and draws the pieces through three.js, colour and
// motion, for the plane's lay to lay as paint by their alpha; a dissolve's shares into a target each.
// Readbacks are kept by what makes their pixels (stamp-film-readback.ts): what's made from them, by their identity.

import { OrthographicCamera, Scene } from 'three/webgpu';
import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import { paintingNodeSteps, type PaintingSelectionCompiled } from '#lib/paint/document/models/painting-document-compile.ts';
import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import { stampBoxUnion, stampStageTexelsWithin, type StampPointBox, type StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { readStampSheetsPictureKept } from '#lib/paint/painting/studio/stamp-film-readback.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import type { StampSheetsComposite } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import type { StampSheetFilmKept } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import { createLensThreeMotion, LENS_THREE_MOTION_NAME } from '#lib/picture/lens/studio/lens-three-motion.ts';
import { paintRigPiecesBox, type PaintRigPicture } from '#lib/paint/rig/models/paint-rig-pieces.ts';
import { createPaintRigPieceMeshes, type PaintRigPieceMeshes } from '#lib/paint/rig/studio/paint-rig-piece-meshes.ts';
import { shotRigPiecePictures, shotRigSkin, type CompiledShotRig, type ShotRigRestCel, type ShotRigSkin } from '../models/shot-rigs.ts';
import type { ShotPiecesPlan, ShotRigPiecesAt } from '../models/shot-sheet-lays.ts';
import type { ShotPiecesDrawn } from './shot-sheets-lay.ts';

/** A selection's films as one solve kept them: each sheet's, in its compiled order. */
export type ShotSolvedFilms = { readonly compiled: PaintingSelectionCompiled; readonly films: readonly (readonly StampSheetFilmKept[])[] };

/** A rig's cels as the whole selection paints them unposed, each with the key naming its pixels, by document key. */
export type ShotRigRestCels = ReadonlyMap<NodeKey, ShotRigRestCel>;

const EMPTY: PaintRigPicture = { x0: 0, y0: 0, w: 0, h: 0, rgba: new Float32Array(0) };

const boxOf = (films: readonly StampSheetFilmKept[]) => films.reduce<StampPointBox | null>((union, { box }) => stampBoxUnion(union, box), null);

/** What `make` makes from `from`, made once while `made` keeps it. */
function derivedOf<K, T>(made: { get: (key: K) => T | undefined; set: (key: K, value: T) => void }, from: K, make: () => T): T {
  let value = made.get(from);
  if (value === undefined) made.set(from, (value = make()));
  return value;
}

/** A shot's rig pictures read back on `owner`, counted into `costs`: rest cels, and a pieces rig's skin and cut pictures. */
export function createShotRigPictures(owner: StampPaintGpuOwner, costs?: StampPaintCostTally) {
  const ids = new WeakMap<PaintRigPicture, number>();
  let idCount = 0;
  const idOf = (picture: PaintRigPicture) => derivedOf(ids, picture, () => idCount++);
  // A skin, by its cels' pictures: the first's, then all of theirs. Cut pictures, by what's cut and the skin cutting it.
  const skins = new WeakMap<PaintRigPicture, Map<string, ShotRigSkin>>(), cuts = new WeakMap<PaintRigPicture, WeakMap<ShotRigSkin, readonly PaintRigPicture[]>>();
  /**
   * `solved`'s steps `steps` read back clear, the sheets unmoved, each sheet holding only the films `keeps` keeps: its
   * card's edge is made from those, and a step laying another isn't read. Kept under its films' keys and its cards'
   * papers, which name its pixels.
   */
  const readSteps = async (solved: ShotSolvedFilms, steps: readonly number[], keeps: (sheet: number, film: number) => boolean = () => true): Promise<ShotRigRestCel> => {
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
    const crop = laid.reduce<StampPointBox | null>((union, step) => stampBoxUnion(union, step.kind === 'card' ? boxOf(films[step.sheet]) : solved.films[step.sheet][step.film].box), null);
    const key = laid.map((step) => {
      if (step.kind === 'film') return solved.films[step.sheet][step.film].key;
      return `card ${stampCanonicalJson(compiled.sheets[step.sheet].program.paper)} ${films[step.sheet].map(({ key: film }) => film).join('+')}`;
    }).join('|');
    return { picture: crop ? await readStampSheetsPictureKept(owner, key, composite, crop, 'clear', costs) : EMPTY, key };
  };
  /** Cel `key`'s steps read back clear: with `cards`, the cards of sheets it or a node under it owns; else its paint alone. */
  const cel = (solved: ShotSolvedFilms, key: NodeKey, cards: boolean): Promise<ShotRigRestCel> =>
    readSteps(solved, paintingNodeSteps(solved.compiled, key).filter((index) => cards || solved.compiled.steps[index].kind === 'film'));
  return {
    /**
     * `rig`'s cels as `rest` (the whole selection, unposed) paints them: a pieces rig's every cel, paint alone; a marks
     * rig's rest cels (each part's first) with the sheets they own, which move with them.
     */
    restCels: async (rest: ShotSolvedFilms, rig: CompiledShotRig): Promise<ShotRigRestCels> => {
      const keys = rig.pieces ? rig.parts.flatMap(({ cels }) => cels) : rig.parts.map(({ cels }) => cels[0]);
      return new Map(await Promise.all(keys.map(async (key) => [key, await cel(rest, key, !rig.pieces)] as const)));
    },
    /**
     * A pieces rig's pictures as `plan` shows it: the shown cels' rest paint (`rest`) skinned, and its group's sheets
     * (those nested in it too) laid as `solved` painted them with the plan's steps and layers alone, on their paper and
     * edge, cut by that skin into one picture a skin group. Overlapping cels show their paper once, under both.
     */
    pieces: async (solved: ShotSolvedFilms, rest: ShotRigRestCels, plan: ShotPiecesPlan): Promise<{ readonly skin: ShotRigSkin; readonly pictures: readonly PaintRigPicture[] }> => {
      const { tree, sheets } = solved.compiled, shown = plan.shown.map((cel) => ({ cel, ...rest.get(cel)! }));
      const skin = derivedOf(derivedOf(skins, shown[0].picture, () => new Map<string, ShotRigSkin>()), shown.map(({ picture }) => idOf(picture)).join(','), () => shotRigSkin(plan.rig, shown).skin);
      const { picture: combined } = await readSteps(solved, plan.steps, (sheet, film) => plan.layers.has(tree.layers[sheets[sheet].layers[film]].node.key));
      return { skin, pictures: derivedOf(derivedOf(cuts, combined, () => new WeakMap<ShotRigSkin, readonly PaintRigPicture[]>()), skin, () => shotRigPiecePictures(combined, skin)) };
    },
  };
}

export type ShotRigPictures = ReturnType<typeof createShotRigPictures>;

/**
 * Pieces rigs drawn on `owner`'s three.js renderer over `stage`: a target of colour and motion each rig and share of
 * its plane's blend, its meshes made anew when its pictures change, so the old ones' textures go with them.
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
  /** What's held in `slot` (a rig and share) for `pictures`: its target, and meshes over them. */
  const heldFor = (slot: string, pictures: readonly PaintRigPicture[]): Held => {
    let made = held.get(slot);
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
    held.set(slot, made);
    return made;
  };
  return {
    /**
     * Rig `rig`'s `pieces` (each over one of `pictures`) in share `share` (its index in this frame's blend) drawn into
     * its target, their travel over the shutter into its motion; null where none lies on the stage. Rendered and
     * submitted now: one submit lays every share after, so each draws into a target of its own.
     */
    draw(rig: string, share: number, pictures: readonly PaintRigPicture[], pieces: ShotRigPiecesAt): ShotPiecesDrawn | null {
      const made = heldFor(JSON.stringify([rig, share]), pictures), { scene, meshes } = made;
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

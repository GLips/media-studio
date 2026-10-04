// shot-sheet-lays.ts: how a painted plane lays its selection's sheets at one moment (ENGINE 5.3, 5.4, 6.2), purely.
// Poses split at each sheet's owner: the owner's node and those enclosing it, then the plane's place, carry the sheet
// whole; the nodes below it posed its marks before the solve, and a lattice carries the solved paint where they pose
// it now. Each composite step becomes a lattice (a card over its sheet's edge, a film over its paint); a sheet drawn
// as pieces gives way to its pieces at its card. An isolated group's span is mixed back by its visibility. Masks lie
// where the plane does (ENGINE 6.3). shotPlaneLayPlan plans and keys a moment; the studio draws it.

import { PAINT_SIMILARITY_IDENTITY, paintSimilarityBox, paintSimilarityInverse, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import { paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import { paintingNodeSteps, paintingStepNode, type PaintingSelectionCompiled } from '#lib/paint/document/models/painting-document-compile.ts';
import { paintingBoxUnion, paintingNodeBox } from '#lib/paint/document/models/painting-footprint.ts';
import {
  PAINTING_REST_POSE, paintingPoseAfter, paintingPoseMap, paintingPoseText, paintingSimilarityPose, type PaintingNodePose, type PaintingPoses,
} from '#lib/paint/document/models/painting-pose.ts';
import type { LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import { paintingSheetInGroup, type PaintingSheet, type PaintingTree } from '#lib/paint/document/models/painting-tree.ts';
import type { PaintMoment, StampGroupGlow } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampBoxGrown, type StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampPointBox, StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { PaintRigPicture, PaintRigPiece } from '#lib/paint/rig/models/paint-rig-pieces.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane } from './shot-compile.ts';
import { shotPlaneLayAt, shotPlaneMomentAt, shotPlanePlaceAt, shotPlanePosesAt, shotRigPosedAt, shotVisibilityAt, type ShotFrameRigs } from './shot-frame-plan.ts';
import { shotFilmLattice, shotPlacedLattice, type ShotLattice, type ShotShutterAt } from './shot-lattice.ts';
import { shotPathInkedLength, shotPathMaskBox, shotPathMaskCapsules, shotPathRevealProblem, type ShotMaskCapsule } from './shot-masks.ts';
import { shotOccurrenceKey, shotOccurrencePlane } from './shot-occurrences.ts';
import { shotPresentationAt, type OccurrenceKey } from './shot-props.ts';
import { shotNodeShift } from './shot-reach.ts';
import {
  shotRigHiddenCels, shotRigPieces, shotRigPiecesPlaced, type CompiledShotRig, type ShotRigFound, type ShotRigPosed, type ShotRigSkin, type ShotRigStretch,
} from './shot-rigs.ts';
import { shotIsolatedGroups } from './shot-visibility.ts';

/** A plane at one moment: where it lays its document (document px to plane px), and its nodes' poses by document key. */
export type ShotPlaneAt = { readonly place: PaintingNodePose; readonly poses: PaintingPoses };

const REST = paintingSimilarityPose(PAINT_SIMILARITY_IDENTITY);

const posedBy = (keys: readonly NodeKey[], poses: PaintingPoses): PaintingNodePose =>
  keys.reduce((pose, key) => paintingPoseAfter(pose, poses.get(key) ?? REST), REST);

/** The nodes carrying `sheet` whole, outermost first: its owner and the groups enclosing it; none for the root's. */
export function shotSheetOwnerKeys(tree: PaintingTree, sheet: PaintingSheet): NodeKey[] {
  if (sheet.owner === null) return [];
  return [...tree.byKey.get(sheet.owner)!.groups, sheet.owner];
}

/** The nodes posing layer `layer`'s marks (an ordinal of `tree.layers`), outermost first: those below its sheet's owner, itself last. */
export function shotLayerMarkKeys(tree: PaintingTree, layer: number): NodeKey[] {
  const { groups, node, sheet } = tree.layers[layer], line = [...groups, node.key];
  return sheet.owner === null ? line : line.slice(line.indexOf(sheet.owner) + 1);
}

/** Where `sheet` lies at `at`: its owner's line posed, then its plane's place. Document px to plane px. */
export const shotSheetPlaceAt = (tree: PaintingTree, sheet: PaintingSheet, at: ShotPlaneAt): PaintingNodePose =>
  paintingPoseAfter(at.place, posedBy(shotSheetOwnerKeys(tree, sheet), at.poses));

/** Layer `layer`'s marks' map under `poses`: document px to its sheet's frame. */
export const shotLayerMarksAt = (tree: PaintingTree, layer: number, poses: PaintingPoses): PaintingNodePose => posedBy(shotLayerMarkKeys(tree, layer), poses);

/**
 * How a step lays this moment: a card's paper over its sheet's `edge` (document px), a film through its lattice, or
 * a rig's pieces (`rig`, its group occurrence) in place of its group's sheet.
 */
export type ShotStepLay =
  | { readonly kind: 'card'; readonly sheet: number; readonly edge: StampBox; readonly lattice: ShotLattice }
  | { readonly kind: 'film'; readonly sheet: number; readonly film: number; readonly layer: NodeKey; readonly lattice: ShotLattice }
  | { readonly kind: 'pieces'; readonly rig: string };

/** A step as one moment lays it: its lay, a film's opacity (its layer's visibility) and the glow its layer gives. */
export type ShotStepFrame = { readonly lay: ShotStepLay; readonly opacity: number; readonly glow: StampGroupGlow | null };

/**
 * What a selection's lay at one moment reads: its compile; each film's painted box, document px (null: painted
 * nowhere); the poses its marks were solved under; the plane at the moment and the shutter's ends (null: none);
 * groups drawn as pieces, by key to their rig's occurrence; and cels a marks rig hides (shotRigHiddenCels).
 */
export type ShotSelectionLayInput = {
  readonly compiled: PaintingSelectionCompiled;
  readonly filmBoxes: readonly (readonly (StampBox | null)[])[];
  readonly solved: PaintingPoses;
  readonly at: ShotPlaneAt;
  readonly shutter: ShotShutterAt<ShotPlaneAt>;
  readonly pieces: ReadonlyMap<NodeKey, string>;
  readonly hidden: ReadonlySet<NodeKey>;
};

/**
 * Each of the selection's steps as it lays at `input.at`: null for one with nothing to lay (a film painted nowhere, a
 * card of no paint, a step a rig's pieces stand in for, or one in a hidden cel). A pieces group's own card is where
 * its pieces go.
 */
export function shotSelectionStepLays({ compiled, filmBoxes, solved, at, shutter, pieces, hidden }: ShotSelectionLayInput): (ShotStepLay | null)[] {
  const { tree, sheets, steps } = compiled;
  const placeOf = (s: number) => {
    const { sheet } = sheets[s], place = (moment: ShotPlaneAt) => shotSheetPlaceAt(tree, sheet, moment);
    return { at: place(at), shutter: shutter && { open: place(shutter.open), close: place(shutter.close) } };
  };
  return steps.map((step): ShotStepLay | null => {
    const { sheet } = sheets[step.sheet], key = paintingStepNode(compiled, step);
    if ([key, ...tree.byKey.get(key)!.groups].some((each) => hidden.has(each))) return null;
    // Groups drawn as pieces never nest: nothing in a rigged group is rigged again.
    const group = [...pieces.keys()].find((each) => paintingSheetInGroup(tree, sheet, each));
    if (group !== undefined) return step.kind === 'card' && sheet.owner === group ? { kind: 'pieces', rig: pieces.get(group)! } : null;
    const placed = placeOf(step.sheet);
    if (step.kind === 'card') {
      const edge = filmBoxes[step.sheet].reduce<StampBox | undefined>((union, box) => paintingBoxUnion(union, box ?? undefined), undefined);
      return edge ? { kind: 'card', sheet: step.sheet, edge, lattice: shotPlacedLattice(edge, placed.at, placed.shutter) } : null;
    }
    const box = filmBoxes[step.sheet][step.film];
    if (!box) return null;
    const layer = sheets[step.sheet].layers[step.film], marks = (poses: PaintingPoses) => shotLayerMarksAt(tree, layer, poses);
    const atMoment = { place: placed.at, marks: marks(at.poses) };
    const shutterAt = shutter && placed.shutter && { open: { place: placed.shutter.open, marks: marks(shutter.open.poses) }, close: { place: placed.shutter.close, marks: marks(shutter.close.poses) } };
    const { node } = tree.layers[layer];
    return { kind: 'film', sheet: step.sheet, film: step.film, layer: node.key, lattice: shotFilmLattice(box, marks(solved), atMoment, shutterAt, paintingNodeBox(node)) };
  });
}

/** An isolated group's span of steps, `first` to `last` inclusive, and how visible it is. */
export type ShotFadeSpan = { readonly group: NodeKey; readonly first: number; readonly last: number; readonly visibility: number };

/**
 * The spans of steps `isolated` groups (document keys, by visibility) composite apart: each one's steps
 * (paintingNodeSteps), contiguous in document order. Outermost first where spans nest; none for a group the selection
 * lays nothing of.
 */
export function shotFadeSpans(compiled: PaintingSelectionCompiled, isolated: ReadonlyMap<NodeKey, number>): ShotFadeSpan[] {
  const spans: ShotFadeSpan[] = [];
  for (const [group, visibility] of isolated) {
    const inside = paintingNodeSteps(compiled, group);
    if (inside.length) spans.push({ group, first: inside[0], last: inside.at(-1)!, visibility });
  }
  return spans.toSorted((a, b) => a.first - b.first || b.last - a.last);
}

/**
 * The document px the back's ground must cover: the stage (plane px, its margin round the frame) taken back through
 * the plane's `lay`, grown by `reach`, the most its node moves a point.
 */
export function shotBackGroundBox({ frame, margin }: Pick<StampStage, 'frame' | 'margin'>, lay: PaintSimilarity, reach: number): StampBox {
  const stageBox = { x0: -margin, y0: -margin, x1: frame.width + margin, y1: frame.height + margin };
  return stampBoxGrown(paintSimilarityBox(paintSimilarityInverse(lay), stageBox), reach + 1);
}

/** The ground's lattice: its paper over `box` (document px) laid where its plane lies, at `at` and over the shutter. */
export const shotGroundLattice = (box: StampBox, at: ShotPlaneAt, shutter: ShotShutterAt<ShotPlaneAt>): ShotLattice =>
  shotPlacedLattice(box, at.place, shutter && { open: shutter.open.place, close: shutter.close.place });

/**
 * A plane's ground at one moment: the stage's paper where the back lies still, its paper over `box` (document px)
 * through a lattice, or none.
 */
export type ShotGroundLay = { readonly kind: 'stage' } | { readonly kind: 'placed'; readonly box: StampBox; readonly lattice: ShotLattice } | null;

/** A frame's moment, and its shutter's ends when it gathers what moves over them. */
export type ShotMomentAt = { readonly at: PaintMoment; readonly shutter: { readonly open: PaintMoment; readonly close: PaintMoment } | null };

/** A pieces rig's pose at one moment: its parts' maps (its group's wobble in) and its group's sheet's placement. */
export type ShotPiecesPose = { readonly posed: ShotRigPosed; readonly place: PaintingNodePose };

/**
 * A pieces rig at one moment, before its pictures are read: its rig; the cel each part shows, in part order; the steps
 * its sheets lay (none under a node faded out) and the layers whose films they lay (its shown cels' that show); its
 * pose at the moment and at the shutter's ends; and whether it moves between them.
 */
export type ShotPiecesPlan = {
  readonly rig: CompiledShotRig;
  readonly shown: readonly NodeKey[];
  readonly steps: readonly number[];
  readonly layers: ReadonlySet<NodeKey>;
  readonly at: ShotPiecesPose;
  readonly shutter: { readonly open: ShotPiecesPose; readonly close: ShotPiecesPose } | null;
  readonly travels: boolean;
};

/** A pieces rig's pieces at a moment, and at its shutter's ends when the frame gathers their motion. */
export type ShotRigPiecesAt = { readonly at: readonly PaintRigPiece[]; readonly shutter: { readonly open: readonly PaintRigPiece[]; readonly close: readonly PaintRigPiece[] } | null };

/**
 * `plan`'s pieces placed: each of `pictures` (shotRigPiecePictures over `skin`) through its skin group's mesh as each
 * pose puts it, then where its sheet lies; and each skin joint's stretch at the moment.
 */
export function shotPiecesPlaced(plan: ShotPiecesPlan, skin: ShotRigSkin, pictures: readonly PaintRigPicture[]): ShotRigPiecesAt & { readonly stretches: readonly ShotRigStretch[] } {
  const placed = ({ posed, place }: ShotPiecesPose) => {
    const { pieces, stretches } = shotRigPieces(posed, pictures, skin);
    return { pieces: shotRigPiecesPlaced(pieces, paintingPoseMap(place)), stretches };
  };
  const at = placed(plan.at);
  return { at: at.pieces, stretches: at.stretches, shutter: plan.shutter && { open: placed(plan.shutter.open).pieces, close: placed(plan.shutter.close).pieces } };
}

/**
 * A path mask at one moment: how much of its inked length shows (`revealPx`, at most all) as capsules (document px),
 * its band's width and softness, the box its whole band can reach (shotPathMaskBox), and the lattice laying that box
 * where the plane lies. Node poses below the plane don't carry it: it cuts the plane's frame.
 */
export type ShotPathMaskAt = {
  readonly kind: 'path'; readonly revealPx: number; readonly capsules: readonly ShotMaskCapsule[]; readonly widthPx: number; readonly softPx: number;
  readonly box: StampBox; readonly lattice: ShotLattice;
};

/** An alphaOf mask: the drawable whose laid coverage it reads, and whether it shows where that drawable isn't. */
export type ShotAlphaOfMaskAt = { readonly kind: 'alphaOf'; readonly drawable: OccurrenceKey; readonly invert: boolean };

export type ShotMaskAt = ShotPathMaskAt | ShotAlphaOfMaskAt;

/**
 * A drawable of a plane that another plane's alphaOf mask reads: the steps whose lay covers it (its node's; all of
 * them for the plane itself) and whether the ground does (the plane itself only).
 */
export type ShotPlaneRead = { readonly drawable: OccurrenceKey; readonly steps: ReadonlySet<number>; readonly ground: boolean };

/**
 * `plane`'s masks at frame moment `at`, read at its presentation's moment, the plane lying at `place`. Throws on a
 * reveal callback's value below 0.
 */
function shotMasksAt(input: ShotPlaneLayInput, at: PaintMoment, place: PaintingNodePose): ShotMaskAt[] {
  const { plane, shot } = input, moment = shotPlaneMomentAt(shot.motion, plane.id, at);
  return plane.masks.map((mask, i): ShotMaskAt => {
    if (mask.kind === 'alphaOf') return { kind: 'alphaOf', drawable: mask.drawable, invert: mask.invert ?? false };
    const revealPx = shotPresentationAt(mask.revealPx, moment), problem = shotPathRevealProblem(plane.id, i, revealPx, moment.at);
    if (problem) throw new Error(`shot: ${paintingProblemText(problem)}`);
    const box = shotPathMaskBox(mask), shown = Math.min(revealPx, shotPathInkedLength(mask.subpaths));
    return { kind: 'path', revealPx: shown, capsules: shotPathMaskCapsules(mask.subpaths, shown), widthPx: mask.widthPx, softPx: mask.softPx ?? 0, box, lattice: shotPlacedLattice(box, place, null) };
  });
}

/** What of `input`'s plane the shot's alphaOf masks read: each drawable's steps in its compile, the plane's being all of them. */
function shotPlaneReads({ shot, plane, compiled }: Pick<ShotPlaneLayInput, 'shot' | 'plane' | 'compiled'>): ShotPlaneRead[] {
  return [...shot.masks.read].filter((drawable) => shotOccurrencePlane(drawable) === plane.id).map((drawable): ShotPlaneRead => {
    if (drawable === plane.id) return { drawable, steps: new Set(compiled.steps.keys()), ground: true };
    const { node } = plane.occurrences.find(({ key }) => key === drawable)!;
    return { drawable, steps: new Set(paintingNodeSteps(compiled, node)), ground: false };
  });
}

/** A solved film as a plan reads it: where it painted (document px, a sheet's stage being its document; null for nowhere) and the key naming its pixels. */
export type ShotFilmSolved = { readonly box: StampPointBox | null; readonly key: string };

/**
 * What a painted plane's moments are planned from: its shot and plane; the selection drawn this frame, its compile,
 * its films as solved (by sheet) and the poses they were solved under; its rigs as found in that selection and posed
 * by the frame's one read of them; and the stage it's laid on.
 */
export type ShotPlaneLayInput = {
  readonly shot: CompiledPaintedShot;
  readonly plane: CompiledShotPaintedPlane;
  readonly selection: LayerSelection;
  readonly compiled: PaintingSelectionCompiled;
  readonly films: readonly (readonly ShotFilmSolved[])[];
  readonly solved: PaintingPoses;
  readonly rigs: ShotFrameRigs;
  readonly stage: Pick<StampStage, 'frame' | 'margin'>;
};

/**
 * A painted plane at one moment, planned: its steps, its isolated groups' spans (outermost first), its ground, its
 * pieces rigs, its masks, what other planes' masks read of it, its visibility, whether it glows and whether anything
 * travels over the shutter. `key` names all the lay reads; what its alphaOf masks read is named per frame
 * (shotPresentedKeys).
 */
export type ShotPlaneLayPlan = {
  readonly key: string;
  readonly steps: readonly (ShotStepFrame | null)[];
  readonly fades: readonly ShotFadeSpan[];
  readonly ground: ShotGroundLay;
  readonly pieces: readonly ShotPiecesPlan[];
  readonly masks: readonly ShotMaskAt[];
  readonly reads: readonly ShotPlaneRead[];
  readonly visibility: number;
  readonly emits: boolean;
  readonly travels: boolean;
};

const compileIds = new WeakMap<PaintingSelectionCompiled, number>();
let compileCount = 0;
/** A number naming `compiled` while it lives: its tree, sheets, papers and steps, which its memo hands back alike for a selection. */
function compileId(compiled: PaintingSelectionCompiled): number {
  let id = compileIds.get(compiled);
  if (id === undefined) compileIds.set(compiled, (id = compileCount++));
  return id;
}

const posesText = (poses: PaintingPoses) => [...poses].map(([key, pose]) => `${key}=${paintingPoseText(pose)}`).join(';');
const planeAtText = ({ place, poses }: ShotPlaneAt) => `${paintingPoseText(place)}|${posesText(poses)}`;
const piecesPoseText = ({ posed, place }: ShotPiecesPose) => `${paintingPoseText(place)}|${[...posed.maps].map(([id, pose]) => `${id}=${paintingPoseText(pose)}`).join(';')}`;

const latticeTravels = (lattice: ShotLattice) => lattice.travel?.some((value) => Math.abs(value) > 1e-6) ?? false;

/**
 * `input`'s pieces rig, as found, at `moment`, its plane there (`planeAt`) and at the shutter's ends (`planeEnds`).
 * Throws on a visibility inside it between 0 and 1.
 */
function shotPiecesPlan(input: ShotPlaneLayInput, found: ShotRigFound, { at, shutter: ends }: ShotMomentAt, planeAt: ShotPlaneAt, planeEnds: ShotShutterAt<ShotPlaneAt>): ShotPiecesPlan {
  const { shot, plane, compiled, rigs: { read } } = input, { rig } = found, { tree } = compiled;
  const sheet = compiled.sheets.find(({ sheet: { owner } }) => owner === rig.group)!.sheet;
  const poseAt = (m: PaintMoment, planeAtM: ShotPlaneAt): ShotPiecesPose => ({ posed: shotRigPosedAt(found, read, m, true), place: shotSheetPlaceAt(tree, sheet, planeAtM) });
  const atPose = poseAt(at, planeAt), shutter = ends && planeEnds && { open: poseAt(ends.open, planeEnds.open), close: poseAt(ends.close, planeEnds.close) };
  const faded = new Set(plane.occurrences.filter(({ groups }) => groups.includes(rig.occurrence)).flatMap(({ key, node }) => {
    const visibility = shotVisibilityAt(shot, plane.id, key, at);
    if (visibility > 0 && visibility < 1) throw new Error(`shot: ${key}'s visibility is ${visibility} at ${at.at} s, inside ${rig.occurrence}, drawn as pieces: a layer or group there shows (1) or doesn't (0)`);
    return visibility === 0 ? [node] : [];
  }));
  const unseen = new Set([...faded].flatMap((key) => paintingNodeSteps(compiled, key))), shown = rig.parts.map(({ id }) => atPose.posed.shown.get(id)!);
  const layers = new Set(shown.flatMap((cel) => rig.celLayers.get(cel)!).filter((layer) => ![layer, ...tree.byKey.get(layer)!.groups].some((key) => faded.has(key))));
  const steps = compiled.steps.flatMap((step, index) => (paintingSheetInGroup(tree, compiled.sheets[step.sheet].sheet, rig.group) && !unseen.has(index) ? [index] : []));
  return { rig, shown, steps, layers, at: atPose, shutter, travels: !!shutter && piecesPoseText(shutter.open) !== piecesPoseText(shutter.close) };
}

/**
 * `input`'s plane as it lies at `moment`: its sheets where their owners and its place put them, its pieces rigs posed,
 * its fades, ground and masks. Throws on a callback's visibility outside 0..1, or between 0 and 1 inside a pieces rig,
 * whose layers show whole or not at all, and on a reveal callback's value below 0.
 */
export function shotPlaneLayPlan(input: ShotPlaneLayInput, moment: ShotMomentAt): ShotPlaneLayPlan {
  const { at, shutter } = moment;
  const { shot, plane, selection, compiled, films, solved, rigs: frameRigs, stage } = input, { motion } = shot, { found: rigs, read } = frameRigs;
  const planeAt = (m: PaintMoment): ShotPlaneAt => ({ place: shotPlanePlaceAt(plane, motion, m), poses: shotPlanePosesAt(plane, motion, frameRigs, m, true) });
  const atMoment = planeAt(at), shutterAt: ShotShutterAt<ShotPlaneAt> = shutter && { open: planeAt(shutter.open), close: planeAt(shutter.close) };
  const visibilityOf = (key: NodeKey) => shotVisibilityAt(shot, plane.id, shotOccurrenceKey(plane.id, key), at);
  const piecesRigs = rigs.filter(({ rig }) => rig.pieces);
  const pieces = piecesRigs.map((found) => shotPiecesPlan(input, found, moment, atMoment, shutterAt));

  const hidden = new Set(rigs.filter(({ rig }) => !rig.pieces).flatMap(({ rig }) => shotRigHiddenCels(rig, read(rig, at).pose)));
  const filmBoxes = films.map((sheet) => sheet.map(({ box }): StampBox | null => box && { x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h }));
  const lays = shotSelectionStepLays({ compiled, filmBoxes, solved, at: atMoment, shutter: shutterAt, pieces: new Map(piecesRigs.map(({ rig }) => [rig.group, rig.occurrence])), hidden });
  const steps = lays.map((lay): ShotStepFrame | null => {
    if (!lay) return null;
    if (lay.kind !== 'film') return { lay, opacity: 1, glow: null };
    const nearest = motion.nearest.get(shotOccurrenceKey(plane.id, lay.layer));
    return { lay, opacity: visibilityOf(lay.layer), glow: (nearest !== undefined && motion.nodes.get(nearest)?.glow) || null };
  });

  // A group inside a pieces rig shows whole or not at all in its pictures: it isn't composited apart.
  const groups = plane.occurrences.filter((occurrence) => occurrence.kind === 'group' && !piecesRigs.some(({ rig }) => occurrence.groups.includes(rig.occurrence)));
  const groupVisibility = new Map(groups.map(({ key, node }) => [key, visibilityOf(node)]));
  const isolated = new Set(shotIsolatedGroups(groups.map(({ key }) => key), groupVisibility, shot.masks.read, new Set(rigs.map(({ rig }) => rig.occurrence))));
  const fades = shotFadeSpans(compiled, new Map(groups.filter(({ key }) => isolated.has(key)).map(({ key, node }) => [node, groupVisibility.get(key)!])));

  const { widthPx, heightPx } = selection.painting.document, groundKind = selection.ground ?? (plane.opaqueBack ? 'paper' : 'transparent');
  let ground: ShotGroundLay = null;
  if (groundKind === 'paper') {
    if (plane.opaqueBack && paintingPoseText(atMoment.place) === PAINTING_REST_POSE && !shutterAt) ground = { kind: 'stage' };
    else {
      const planeNode = motion.nodes.get(plane.id), documentBox = { x0: 0, y0: 0, x1: widthPx, y1: heightPx };
      const box = plane.opaqueBack ? shotBackGroundBox(stage, shotPlaneLayAt(plane, motion, at), planeNode ? shotNodeShift(planeNode, documentBox) : 0) : documentBox;
      ground = { kind: 'placed', box, lattice: shotGroundLattice(box, atMoment, shutterAt) };
    }
  }

  const masks = shotMasksAt(input, at, atMoment.place), reads = shotPlaneReads(input);
  const visibility = plane.opaqueBack ? 1 : shotVisibilityAt(shot, plane.id, plane.id, at), emits = steps.some((step) => step?.glow && step.opacity > 0);
  const travels = !!shutter && ((ground?.kind === 'placed' && latticeTravels(ground.lattice)) || steps.some((step) => step && step.lay.kind !== 'pieces' && latticeTravels(step.lay.lattice)) || pieces.some((each) => each.travels));
  // All the lay reads: the compile and its films, every pose at the moment and the shutter's ends, how much shows of
  // what, the ground, the pieces, the masks and the drawables read. The stage is the renderer's, whose own store keeps
  // the pictures. A path mask's subpaths and band are its plane's, the same all shot.
  const key = JSON.stringify([
    plane.id, plane.opaqueBack, compileId(compiled), films.map((sheet) => sheet.map((film) => film.key)), posesText(solved), planeAtText(atMoment),
    shutterAt && [planeAtText(shutterAt.open), planeAtText(shutterAt.close)], [...hidden], steps.map((step) => step && [step.opacity, step.glow]), fades,
    ground && (ground.kind === 'stage' ? 'stage' : ground.box), pieces.map((each) => [
      each.rig.occurrence, each.shown, each.steps, [...each.layers], piecesPoseText(each.at), each.shutter && [piecesPoseText(each.shutter.open), piecesPoseText(each.shutter.close)],
    ]), masks.map((mask) => (mask.kind === 'path' ? mask.revealPx : [mask.drawable, mask.invert])), reads.map(({ drawable }) => drawable), visibility, emits, travels,
  ]);
  return { key, steps, fades, ground, pieces, masks, reads, visibility, emits, travels };
}

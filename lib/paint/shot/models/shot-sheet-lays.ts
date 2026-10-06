// shot-sheet-lays.ts: how a painted plane lays its selection's sheets at one moment (ENGINE 5.3, 5.4, 6.2), purely.
// Poses split at each sheet's owner: the owner's node and those enclosing it, then the plane's place, carry the sheet
// whole; the nodes below it posed its marks before the solve, and a lattice carries the solved paint where they pose
// it now. Each composite step becomes a lattice (a card over its films as far as each shows, a film over its paint);
// a sheet drawn as pieces gives way to its pieces at its card. A span faded apart is mixed back by its visibility; a
// film is cut by its reveals. shotPlaneLayPlan plans and keys a moment.

import { PAINT_SIMILARITY_IDENTITY } from '#lib/paint/animation/models/paint-similarity.ts';
import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import { paintingProblem, paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import { paintingNodeSteps, paintingStepNode, type PaintingSelectionCompiled } from '#lib/paint/document/models/painting-document-compile.ts';
import { paintingRevealLinksOf } from '#lib/paint/document/models/painting-reveal.ts';
import { paintingBoxUnion, paintingNodeBox } from '#lib/paint/document/models/painting-footprint.ts';
import {
  PAINTING_REST_POSE, paintingPoseAfter, paintingPoseMap, paintingPoseText, paintingSimilarityPose, type PaintingNodePose, type PaintingPoses,
} from '#lib/paint/document/models/painting-pose.ts';
import type { LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import { paintingSheetInGroup, type PaintingSheet, type PaintingTree } from '#lib/paint/document/models/painting-tree.ts';
import type { PaintMoment, StampGroupGlow } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampFilmRevealLinks } from '#lib/paint/painting/models/stamp-reveal.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampSheetCompositeShown } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import type { StampPointBox, StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { PaintRigPicture, PaintRigPiece } from '#lib/paint/rig/models/paint-rig-pieces.ts';
import { shotBackFrameProblem, shotBackGroundBox } from './shot-back.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane } from './shot-compile.ts';
import { shotNodeGlowAt, shotPlanePlaceAt, shotPlanePosesAt, shotRigPosedAt, shotVisibilityAt, type ShotFrameRigs } from './shot-frame-plan.ts';
import { shotFilmLattice, shotPlacedLattice, type ShotLattice, type ShotShutterAt } from './shot-lattice.ts';
import { shotOccurrenceKey, shotOccurrencePlane } from './shot-occurrences.ts';
import type { OccurrenceKey } from './shot-props.ts';
import {
  shotRigHiddenCels, shotRigPieces, shotRigPiecesPlaced, type CompiledShotRig, type ShotRigFound, type ShotRigPosed, type ShotRigSkin, type ShotRigStretch,
} from './shot-rigs.ts';
import { shotFadedApart } from './shot-visibility.ts';

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
 * A film a card is cut round, and how much of its coverage the card counts, above 0: its layer's visibility times
 * its groups' below the card's owner. The owner's own fade, and its enclosing groups', are its span's.
 */
export type ShotCardFilm = { readonly film: number; readonly shown: number };

/**
 * How a step lays this moment: a card's paper over its sheet's `edge` (document px), cut round the sheet's films
 * `films` (those showing, painted somewhere); a film through its lattice; or a rig's pieces (`rig`, its group
 * occurrence) in place of its group's sheet.
 */
export type ShotStepLay =
  | { readonly kind: 'card'; readonly sheet: number; readonly films: readonly ShotCardFilm[]; readonly edge: StampBox; readonly lattice: ShotLattice }
  | { readonly kind: 'film'; readonly sheet: number; readonly film: number; readonly layer: NodeKey; readonly lattice: ShotLattice }
  | { readonly kind: 'pieces'; readonly rig: string };

/**
 * A step as one moment lays it: its lay, a film's opacity and the glow its layer gives then (null: none, or none
 * this moment). A film's opacity is its layer's visibility, or 1 where its layer is faded apart, its own span fading it.
 */
export type ShotStepFrame = { readonly lay: ShotStepLay; readonly opacity: number; readonly glow: StampGroupGlow | null };

/**
 * What a selection's lay at one moment reads: its compile; each film's painted box, document px (null: nowhere); the
 * poses its marks were solved under; the plane at the moment and the shutter's ends (null: none); groups drawn as
 * pieces, by key to their rig's occurrence; cels a marks rig hides (shotRigHiddenCels); each node's own visibility.
 */
export type ShotSelectionLayInput = {
  readonly compiled: PaintingSelectionCompiled;
  readonly filmBoxes: readonly (readonly (StampBox | null)[])[];
  readonly solved: PaintingPoses;
  readonly at: ShotPlaneAt;
  readonly shutter: ShotShutterAt<ShotPlaneAt>;
  readonly pieces: ReadonlyMap<NodeKey, string>;
  readonly hidden: ReadonlySet<NodeKey>;
  readonly visibilityOf: (node: NodeKey) => number;
};

/**
 * Each of the selection's steps as it lays at `input.at`: null for one with nothing to lay (a film painted nowhere, a
 * card of no paint showing, a step a rig's pieces stand in for, or one in a hidden cel). A card is cut round each
 * film as far as it shows; a pieces group's card lays its pieces.
 */
export function shotSelectionStepLays({ compiled, filmBoxes, solved, at, shutter, pieces, hidden, visibilityOf }: ShotSelectionLayInput): (ShotStepLay | null)[] {
  const { tree, sheets, steps } = compiled;
  const placeOf = (s: number) => {
    const { sheet } = sheets[s], place = (moment: ShotPlaneAt) => shotSheetPlaceAt(tree, sheet, moment);
    return { at: place(at), shutter: shutter && { open: place(shutter.open), close: place(shutter.close) } };
  };
  const unseen = (key: NodeKey) => [key, ...tree.byKey.get(key)!.groups].some((each) => hidden.has(each));
  return steps.map((step): ShotStepLay | null => {
    const { sheet } = sheets[step.sheet];
    if (unseen(paintingStepNode(compiled, step))) return null;
    // Groups drawn as pieces never nest: nothing in a rigged group is rigged again.
    const group = [...pieces.keys()].find((each) => paintingSheetInGroup(tree, sheet, each));
    if (group !== undefined) return step.kind === 'card' && sheet.owner === group ? { kind: 'pieces', rig: pieces.get(group)! } : null;
    const placed = placeOf(step.sheet);
    if (step.kind === 'card') {
      // A film counts as far as it shows, so a view switched off takes its paper as a hidden cel does, and one fading
      // thins the paper its paint alone cut.
      const films = sheets[step.sheet].layers.flatMap((layer, f): ShotCardFilm[] => {
        if (!filmBoxes[step.sheet][f] || unseen(tree.layers[layer].node.key)) return [];
        const shown = shotLayerMarkKeys(tree, layer).reduce((product, key) => product * visibilityOf(key), 1);
        return shown > 0 ? [{ film: f, shown }] : [];
      });
      const edge = films.reduce<StampBox | undefined>((union, { film }) => paintingBoxUnion(union, filmBoxes[step.sheet][film]!), undefined);
      return edge ? { kind: 'card', sheet: step.sheet, films, edge, lattice: shotPlacedLattice(edge, placed.at, placed.shutter) } : null;
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

/** The span of steps a node faded apart composites, `first` to `last` inclusive, and how visible it is, below 1. */
export type ShotFadeSpan = { readonly node: NodeKey; readonly first: number; readonly last: number; readonly visibility: number };

/**
 * The spans of steps `apart` nodes (document keys, by visibility: shotFadedApart's) composite apart: each one's steps
 * (paintingNodeSteps, its own sheet's card among them), contiguous in document order. Outermost first where spans
 * nest; none for a node the selection lays nothing of.
 */
export function shotFadeSpans(compiled: PaintingSelectionCompiled, apart: ReadonlyMap<NodeKey, number>): ShotFadeSpan[] {
  const spans: ShotFadeSpan[] = [];
  for (const [node, visibility] of apart) {
    const inside = paintingNodeSteps(compiled, node);
    if (inside.length) spans.push({ node, first: inside[0], last: inside.at(-1)!, visibility });
  }
  return spans.toSorted((a, b) => a.first - b.first || b.last - a.last);
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
 * its sheets lay (in its compile's steps): cards and shown cels' films, none under a node at 0; how much of each
 * shows (null: all); its pose then and at the shutter's ends; and whether it moves.
 */
export type ShotPiecesPlan = {
  readonly rig: CompiledShotRig;
  readonly shown: readonly NodeKey[];
  readonly steps: readonly number[];
  readonly levels: StampSheetCompositeShown | null;
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

/** An alphaOf mask: the drawable whose laid coverage it reads, and whether it shows where that drawable isn't. */
export type ShotMaskAt = { readonly drawable: OccurrenceKey; readonly invert: boolean };

/**
 * A drawable of a plane that another plane's alphaOf mask reads: the steps whose lay covers it (its node's; all of
 * them for the plane itself) and whether the ground does (the plane itself only).
 */
export type ShotPlaneRead = { readonly drawable: OccurrenceKey; readonly steps: ReadonlySet<number>; readonly ground: boolean };

/** `plane`'s masks: the same every moment. */
const shotMasksOf = ({ plane }: Pick<ShotPlaneLayInput, 'plane'>): ShotMaskAt[] =>
  plane.masks.map(({ drawable, invert }) => ({ drawable, invert: invert ?? false }));

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
 * A painted plane at one moment, planned: its steps, each film's reveals by sheet (under the poses its marks were
 * solved by), its faded spans (outermost first), its ground, pieces rigs, masks, what others' masks read of it, its
 * visibility, whether it glows and whether anything travels over the shutter. `key` names all the lay reads.
 */
export type ShotPlaneLayPlan = {
  readonly key: string;
  readonly steps: readonly (ShotStepFrame | null)[];
  readonly reveals: readonly StampFilmRevealLinks[];
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
 * How much of what a pieces rig's `steps` lay shows, as a plane lay fades the same nodes: a film by its layer's
 * visibility unless faded apart; a card's films counted by their visibility below its owner (1 when not laid); a span
 * for each node in `apart`, over the places its steps take. Null when all shows.
 */
function shotPiecesLevels(compiled: PaintingSelectionCompiled, steps: readonly number[], visibilityOf: (node: NodeKey) => number, apart: ReadonlyMap<NodeKey, number>): StampSheetCompositeShown | null {
  const { tree, sheets } = compiled, laid = sheets.map(({ layers }) => layers.map(() => false));
  const opacity = steps.map((index) => {
    const step = compiled.steps[index], node = paintingStepNode(compiled, step);
    if (step.kind === 'card') return 1;
    laid[step.sheet][step.film] = true;
    return apart.has(node) ? 1 : visibilityOf(node);
  });
  const counted = sheets.map(({ layers }, s) => layers.map((layer, f) => (laid[s][f] ? shotLayerMarkKeys(tree, layer).reduce((product, key) => product * visibilityOf(key), 1) : 1)));
  // A node's steps are contiguous in the compile's, so the places of those the rig lays are contiguous too.
  const fades = [...apart].flatMap(([node, visibility]) => {
    const inside = new Set(paintingNodeSteps(compiled, node)), places = steps.flatMap((index, place) => (inside.has(index) ? [place] : []));
    return places.length ? [{ first: places[0], last: places.at(-1)!, visibility }] : [];
  }).toSorted((a, b) => a.first - b.first || b.last - a.last);
  const whole = opacity.every((each) => each === 1) && counted.every((films) => films.every((each) => each === 1)) && !fades.length;
  return whole ? null : { opacity, counted, fades };
}

/**
 * `input`'s pieces rig, as found, at `moment`, its plane there (`planeAt`) and at the shutter's ends (`planeEnds`). A
 * node inside it at 0 lays nothing; one between 0 and 1 fades in its picture (shotPiecesLevels).
 */
function shotPiecesPlan(input: ShotPlaneLayInput, found: ShotRigFound, { at, shutter: ends }: ShotMomentAt, planeAt: ShotPlaneAt, planeEnds: ShotShutterAt<ShotPlaneAt>): ShotPiecesPlan {
  const { shot, plane, compiled, rigs: { read } } = input, { rig } = found, { tree } = compiled;
  const sheet = compiled.sheets.find(({ sheet: { owner } }) => owner === rig.group)!.sheet;
  const poseAt = (m: PaintMoment, planeAtM: ShotPlaneAt): ShotPiecesPose => ({ posed: shotRigPosedAt(found, read, m, true), place: shotSheetPlaceAt(tree, sheet, planeAtM) });
  const atPose = poseAt(at, planeAt), shutter = ends && planeEnds && { open: poseAt(ends.open, planeEnds.open), close: poseAt(ends.close, planeEnds.close) };
  const inside = plane.occurrences.filter(({ groups }) => groups.includes(rig.occurrence));
  const levels = new Map(inside.map(({ key, node }) => [node, shotVisibilityAt(shot, plane.id, key, at)])), visibilityOf = (node: NodeKey) => levels.get(node) ?? 1;
  const owners = new Set(compiled.sheets.flatMap(({ sheet: { owner } }) => (owner === null ? [] : [owner])));
  const apart = new Map([...shotFadedApart(inside, visibilityOf, owners)].filter(([, visibility]) => visibility > 0));
  const unseen = new Set([...levels].flatMap(([node, visibility]) => (visibility === 0 ? paintingNodeSteps(compiled, node) : [])));
  const shown = rig.parts.map(({ id }) => atPose.posed.shown.get(id)!), showing = new Set(shown.flatMap((cel) => rig.celLayers.get(cel)!));
  const steps = compiled.steps.flatMap((step, index) => {
    if (!paintingSheetInGroup(tree, compiled.sheets[step.sheet].sheet, rig.group) || unseen.has(index)) return [];
    return step.kind === 'card' || showing.has(paintingStepNode(compiled, step)) ? [index] : [];
  });
  return {
    rig, shown, steps, levels: shotPiecesLevels(compiled, steps, visibilityOf, apart), at: atPose, shutter,
    travels: !!shutter && piecesPoseText(shutter.open) !== piecesPoseText(shutter.close),
  };
}

/**
 * `input`'s plane as it lies at `moment`: its sheets where their owners and its place put them, its pieces rigs posed,
 * its fades, glows, ground and masks. Throws on a callback's visibility outside 0..1 or glow that can't be drawn, or
 * its lay of the back short of what the frame reads.
 */
export function shotPlaneLayPlan(input: ShotPlaneLayInput, moment: ShotMomentAt): ShotPlaneLayPlan {
  const { at, shutter } = moment;
  const { shot, plane, selection, compiled, films, solved, rigs: frameRigs, stage } = input, { motion } = shot, { found: rigs, read } = frameRigs;
  const planeAt = (m: PaintMoment): ShotPlaneAt => ({ place: shotPlanePlaceAt(plane, motion, m), poses: shotPlanePosesAt(plane, motion, frameRigs, m, true) });
  const atMoment = planeAt(at), shutterAt: ShotShutterAt<ShotPlaneAt> = shutter && { open: planeAt(shutter.open), close: planeAt(shutter.close) };
  const visibilityOf = (key: NodeKey) => shotVisibilityAt(shot, plane.id, shotOccurrenceKey(plane.id, key), at);
  const piecesRigs = rigs.filter(({ rig }) => rig.pieces);
  const pieces = piecesRigs.map((found) => shotPiecesPlan(input, found, moment, atMoment, shutterAt));

  // What's inside a pieces rig fades in its picture (shotPiecesLevels), so it isn't composited apart here.
  const fadable =plane.occurrences.filter((occurrence) => !piecesRigs.some(({ rig }) => occurrence.groups.includes(rig.occurrence)));
  const owners = new Set(compiled.sheets.flatMap(({ sheet: { owner } }) => (owner === null ? [] : [owner])));
  const apart = shotFadedApart(fadable, visibilityOf, owners), fades = shotFadeSpans(compiled, apart);

  const hidden = new Set(rigs.filter(({ rig }) => !rig.pieces).flatMap(({ rig }) => shotRigHiddenCels(rig, read(rig, at).pose)));
  const filmBoxes = films.map((sheet) => sheet.map(({ box }): StampBox | null => box && { x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h }));
  const lays = shotSelectionStepLays({
    compiled, filmBoxes, solved, at: atMoment, shutter: shutterAt, pieces: new Map(piecesRigs.map(({ rig }) => [rig.group, rig.occurrence])), hidden, visibilityOf,
  });
  // A glow is read once a moment on the node stating it, however many layers share it.
  const glows = new Map<string, StampGroupGlow | null>();
  const glowOf = (layer: NodeKey) => {
    const nearest = motion.nearest.get(shotOccurrenceKey(plane.id, layer)), glow = nearest === undefined ? null : motion.nodes.get(nearest)!.glow;
    if (!glow) return null;
    if (!glows.has(glow.from)) glows.set(glow.from, shotNodeGlowAt(motion, glow, at));
    return glows.get(glow.from)!;
  };
  const steps = lays.map((lay): ShotStepFrame | null => {
    if (!lay) return null;
    if (lay.kind !== 'film') return { lay, opacity: 1, glow: null };
    return { lay, opacity: apart.has(lay.layer) ? 1 : visibilityOf(lay.layer), glow: glowOf(lay.layer) };
  });

  const { widthPx, heightPx } = selection.painting.document, groundKind = selection.ground ?? (plane.opaqueBack ? 'paper' : 'transparent');
  const short = shotBackFrameProblem(shot, plane, at, shutter);
  if (short) throw new Error(`shot: ${paintingProblemText(paintingProblem('error', plane.id, 'lay', short))}`);
  let ground: ShotGroundLay = null;
  if (groundKind === 'paper') {
    if (plane.opaqueBack && paintingPoseText(atMoment.place) === PAINTING_REST_POSE && !shutterAt) ground = { kind: 'stage' };
    else {
      const box = plane.opaqueBack ? shotBackGroundBox(stage, plane, motion, at) : { x0: 0, y0: 0, x1: widthPx, y1: heightPx };
      ground = { kind: 'placed', box, lattice: shotGroundLattice(box, atMoment, shutterAt) };
    }
  }

  const reveals = paintingRevealLinksOf(compiled, solved, selection.at);
  const masks = shotMasksOf(input), reads = shotPlaneReads(input);
  const visibility = plane.opaqueBack ? 1 : shotVisibilityAt(shot, plane.id, plane.id, at), emits = steps.some((step) => step?.glow && step.opacity > 0);
  const travels = !!shutter && ((ground?.kind === 'placed' && latticeTravels(ground.lattice)) || steps.some((step) => step && step.lay.kind !== 'pieces' && latticeTravels(step.lay.lattice)) || pieces.some((each) => each.travels));
  // All the lay reads: the compile and its films, every pose at the moment and the shutter's ends, how much shows of
  // what, the ground, the pieces, the masks and the drawables read. The stage's own store keeps the pictures. Reveals
  // are the compile's, so only the time each shows at and where it lies are new.
  const key = JSON.stringify([
    plane.id, plane.opaqueBack, compileId(compiled), films.map((sheet) => sheet.map((film) => film.key)), posesText(solved), planeAtText(atMoment),
    reveals.map((sheet) => sheet.map((film) => film.map(({ toRest, at: shownAt }) => [toRest, shownAt]))),
    shutterAt && [planeAtText(shutterAt.open), planeAtText(shutterAt.close)], [...hidden], steps.map((step) => step && [step.opacity, step.glow, step.lay.kind === 'card' && step.lay.films]), fades,
    ground && (ground.kind === 'stage' ? 'stage' : ground.box), pieces.map((each) => [
      each.rig.occurrence, each.shown, each.steps, each.levels, piecesPoseText(each.at),each.shutter && [piecesPoseText(each.shutter.open), piecesPoseText(each.shutter.close)],
    ]), masks.map((mask) => [mask.drawable, mask.invert]), reads.map(({ drawable }) => drawable), visibility, emits, travels,
  ]);
  return { key, steps, reveals, fades, ground, pieces, masks, reads, visibility, emits, travels };
}

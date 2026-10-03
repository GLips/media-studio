// shot-sheet-lays.ts: how a painted plane lays its selection's sheets at one moment (ENGINE 5.3, 5.4, 6.2), purely.
// Poses split at each sheet's owner: the owner's node and those enclosing it, then the plane's place, carry the sheet
// whole, paper and all; the nodes below it posed its marks before the solve, and a lattice carries the solved paint
// to where they pose it at this moment. Each composite step becomes a lattice: a card over its sheet's edge, a film
// over its paint; a sheet a rig draws as pieces gives way to its pieces at its card. A group faded below 1 composites
// its span of steps on its own and is mixed back by its visibility.

import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import type { PaintingSelectionCompiled } from '#lib/paint/document/models/painting-document-compile.ts';
import { paintingNodeBox } from '#lib/paint/document/models/painting-footprint.ts';
import { paintingPoseAfter, paintingSimilarityPose, type PaintingNodePose, type PaintingPoses } from '#lib/paint/document/models/painting-pose.ts';
import type { PaintingSheet, PaintingTree } from '#lib/paint/document/models/painting-tree.ts';
import { PAINT_SIMILARITY_IDENTITY, paintSimilarityApply, paintSimilarityInverse, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { shotFilmLattice, shotPlacedLattice, type ShotLattice, type ShotShutterAt } from './shot-lattice.ts';

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

/** Whether `sheet` lies in a group drawn as pieces: owned by it or by a node under it. The group's key, or undefined. */
function piecesGroupOf(tree: PaintingTree, sheet: PaintingSheet, pieces: ReadonlyMap<NodeKey, string>): NodeKey | undefined {
  if (sheet.owner === null) return undefined;
  return [...tree.byKey.get(sheet.owner)!.groups, sheet.owner].find((key) => pieces.has(key));
}

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
    const { sheet } = sheets[step.sheet], group = piecesGroupOf(tree, sheet, pieces);
    const key = step.kind === 'card' ? sheet.owner! : tree.layers[sheets[step.sheet].layers[step.film]].node.key;
    if ([key, ...tree.byKey.get(key)!.groups].some((each) => hidden.has(each))) return null;
    if (group !== undefined) return step.kind === 'card' && sheet.owner === group ? { kind: 'pieces', rig: pieces.get(group)! } : null;
    const placed = placeOf(step.sheet);
    if (step.kind === 'card') {
      const edge = filmBoxes[step.sheet].reduce<StampBox | null>((union, box) => (box && union ? { x0: Math.min(union.x0, box.x0), y0: Math.min(union.y0, box.y0), x1: Math.max(union.x1, box.x1), y1: Math.max(union.y1, box.y1) } : box ?? union), null);
      return edge && { kind: 'card', sheet: step.sheet, edge, lattice: shotPlacedLattice(edge, placed.at, placed.shutter) };
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

/** A faded group's span of steps, `first` to `last` inclusive, and how visible it is. */
export type ShotFadeSpan = { readonly group: NodeKey; readonly first: number; readonly last: number; readonly visibility: number };

/**
 * The spans of steps `faded` groups (document keys, each below 1) composite apart: each one's cards of sheets owned in
 * it and films of layers under it, contiguous in document order. Outermost first where spans nest; none for a group
 * the selection lays nothing of.
 */
export function shotFadeSpans(compiled: PaintingSelectionCompiled, faded: ReadonlyMap<NodeKey, number>): ShotFadeSpan[] {
  const { tree, sheets, steps } = compiled, spans: ShotFadeSpan[] = [];
  const under = (key: NodeKey, group: NodeKey) => key === group || tree.byKey.get(key)!.groups.includes(group);
  for (const [group, visibility] of faded) {
    const inside = steps.flatMap((step, index) => {
      const key = step.kind === 'card' ? sheets[step.sheet].sheet.owner! : tree.layers[sheets[step.sheet].layers[step.film]].node.key;
      return under(key, group) ? [index] : [];
    });
    if (inside.length) spans.push({ group, first: inside[0], last: inside.at(-1)!, visibility });
  }
  return spans.toSorted((a, b) => a.first - b.first || b.last - a.last);
}

/**
 * The document px the back's ground must cover: the stage (plane px, its margin round the frame) taken back through
 * the plane's `lay`, grown by `reach`, the most its node moves a point.
 */
export function shotBackGroundBox({ frame, margin }: Pick<StampStage, 'frame' | 'margin'>, lay: PaintSimilarity, reach: number): StampBox {
  const back = paintSimilarityInverse(lay);
  const corners = [[-margin, -margin], [frame.width + margin, -margin], [-margin, frame.height + margin], [frame.width + margin, frame.height + margin]].map(([x, y]) => paintSimilarityApply(back, { x, y }));
  const xs = corners.map(({ x }) => x), ys = corners.map(({ y }) => y), by = reach + 1;
  return { x0: Math.min(...xs) - by, y0: Math.min(...ys) - by, x1: Math.max(...xs) + by, y1: Math.max(...ys) + by };
}

/** The ground's lattice: its paper over `box` (document px) laid where its plane lies, at `at` and over the shutter. */
export const shotGroundLattice = (box: StampBox, at: ShotPlaneAt, shutter: ShotShutterAt<ShotPlaneAt>): ShotLattice =>
  shotPlacedLattice(box, at.place, shutter && { open: shutter.open.place, close: shutter.close.place });

// painting-tree.ts: the tree of a PaintingDocument resolved: each layer and group with the groups enclosing it, the
// medium it paints in and the sheet it lies on, and the document's sheets. A sheet is one painting (one paper, one cut
// edge); the root's covers the document, an own sheet's lies as far as its layers' paint does. The checks read media
// from here; each sheet's order, the compiler and the solver read its layers, groups and sheets.

import type { DryingScale, GroupKey, Key, Layer, LayerGroup, LayerNode, MediumName, Paper, PaintingDocument } from './painting-document.ts';

/**
 * A resolved sheet: the node that declared it (null for the root's: no key can name it), its paper, its edge
 * (`document`, the whole document rectangle, the root's; `union`, as far as its layers' paint lies), `water`, the
 * medium its water dries by (its owner's), and the scale its clock runs at, its own, never an enclosing sheet's.
 */
export type PaintingSheet = {
  readonly owner: Key | null;
  readonly paper: Paper;
  readonly edge: 'document' | 'union';
  readonly water: MediumName;
  readonly dryingScale: DryingScale;
};

type PaintingNodePlaceCommon = {
  /** Where it sits in the document, `layers[1].children[0]`. */
  readonly path: string;
  /** The groups enclosing it, outermost first. */
  readonly groups: readonly GroupKey[];
  readonly medium: MediumName;
  readonly sheet: PaintingSheet;
};

/** A layer or group where the tree puts it. */
export type PaintingNodePlace =
  | (PaintingNodePlaceCommon & { readonly kind: 'layer'; readonly node: Layer })
  | (PaintingNodePlaceCommon & { readonly kind: 'group'; readonly node: LayerGroup });

export type PaintingLayerPlace = Extract<PaintingNodePlace, { readonly kind: 'layer' }>;
export type PaintingGroupPlace = Extract<PaintingNodePlace, { readonly kind: 'group' }>;

/**
 * A document's tree: every sheet, the root's first and then each own sheet in document order; every node in document
 * order, and by key; its layers (back to front) and its groups, each in document order. An ordinal of a layer or a
 * group indexes `layers` or `groups`.
 */
export type PaintingTree = {
  readonly sheets: readonly PaintingSheet[];
  readonly nodes: readonly PaintingNodePlace[];
  readonly byKey: ReadonlyMap<Key, PaintingNodePlace>;
  readonly layers: readonly PaintingLayerPlace[];
  readonly groups: readonly PaintingGroupPlace[];
};

/** The sheet `node` lies on: its parent's, the root's for `scene`, or a new one of its own. */
function paintingNodeSheet(node: LayerNode, medium: MediumName, parent: PaintingSheet, root: PaintingSheet): PaintingSheet {
  if (!node.sheet) return parent;
  if (node.sheet.kind === 'scene') return root;
  return { owner: node.key, paper: node.sheet.paper, edge: 'union', water: medium, dryingScale: node.sheet.dryingScale ?? 1 };
}

/** A sheet as problems and summaries name it: "the root's sheet", "heron's own sheet". */
export const paintingSheetName = (sheet: PaintingSheet) => (sheet.owner === null ? "the root's sheet" : `${sheet.owner}'s own sheet`);

/** Whether `node` is a group: what it holds says, as the types do. */
export const isPaintingGroup = (node: LayerNode): node is LayerGroup => Array.isArray(node.children);

/**
 * `document`'s tree resolved, root first. A node's `sheet` left out takes its parent's; `own` makes a sheet it owns,
 * edged by its layers' paint, drying by its medium at its own scale; `scene` takes the root's, past any own sheet
 * enclosing it.
 * Medium is inherited likewise.
 * Expects a tree whose shape and keys are checked (painting-document-check.ts).
 */
export function paintingTree(paintingDocument: PaintingDocument): PaintingTree {
  const root: PaintingSheet = { owner: null, paper: paintingDocument.paper, edge: 'document', water: paintingDocument.medium, dryingScale: paintingDocument.dryingScale ?? 1 };
  const sheets: PaintingSheet[] = [root];
  const nodes: PaintingNodePlace[] = [];
  const visit = (node: LayerNode, path: string, groups: readonly GroupKey[], medium: MediumName, parent: PaintingSheet) => {
    const own = node.medium ?? medium;
    const sheet = paintingNodeSheet(node, own, parent, root);
    if (sheet !== parent && sheet !== root) sheets.push(sheet);
    const common = { path, groups, medium: own, sheet };
    if (!isPaintingGroup(node)) {
      nodes.push({ ...common, kind: 'layer', node });
      return;
    }
    nodes.push({ ...common, kind: 'group', node });
    node.children.forEach((child, i) => visit(child, `${path}.children[${i}]`, [...groups, node.key], common.medium, sheet));
  };
  paintingDocument.layers.forEach((node, i) => visit(node, `layers[${i}]`, [], paintingDocument.medium, root));
  return {
    sheets,
    nodes,
    byKey: new Map(nodes.map((place) => [place.node.key, place])),
    layers: nodes.filter((place): place is PaintingLayerPlace => place.kind === 'layer'),
    groups: nodes.filter((place): place is PaintingGroupPlace => place.kind === 'group'),
  };
}

/** The layers `place` holds: itself for a layer; every layer below it for a group. */
export function paintingLayersUnder(tree: PaintingTree, place: PaintingNodePlace): PaintingLayerPlace[] {
  if (place.kind === 'layer') return [place];
  return tree.layers.filter(({ groups }) => groups.includes(place.node.key));
}

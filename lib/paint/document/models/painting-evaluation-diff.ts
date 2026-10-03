// painting-evaluation-diff.ts: what changed between two evaluations of a painting (two property values, or a source
// before and after an edit), read over each sheet's order as a solve would: the document fields that differ, then
// each wash `same`, changed in its own `content`, or `upstream` of a change earlier on its sheet. It's how an author
// learns what a property costs before warming it. It compares documents: posed marks and reseeds aren't in it.

import type { AnyApplication, LayerKey, LayerNode, PaintingDocument, Wash, WashKey } from './painting-document.ts';
import { paintingFirstDifference, type PaintingDatum } from './painting-document-difference.ts';
import { paintingApplicationOwner } from './painting-problem.ts';
import { paintingSheetOrders, paintingSheetWashes, type PaintingSheetEntry, type PaintingSheetOrder } from './painting-sheet-program.ts';
import { isPaintingGroup, paintingSheetName, type PaintingSheets } from './painting-sheets.ts';
import type { PaintingEvaluation } from './painting-source.ts';

/** A wash's change: none; in its own applications or fields (the first differing path); or after a change on its sheet. */
export type PaintingWashChange =
  | { readonly kind: 'same' }
  | { readonly kind: 'content'; readonly path: string }
  | { readonly kind: 'upstream'; readonly from: string };

/**
 * `document`: the paths outside any wash that differ, first per field (paper colour is here and re-solves nothing).
 * `washes`: the second evaluation's washes in each sheet's order, the root's sheet first.
 */
export type PaintingEvaluationDiff = {
  readonly document: readonly string[];
  readonly washes: readonly { readonly layer: LayerKey; readonly wash: WashKey; readonly change: PaintingWashChange }[];
};

/** What a node is outside its washes and keys: what it is, its medium and sheet, and what it holds. */
const nodeFrame = (node: LayerNode): PaintingDatum => ({
  kind: isPaintingGroup(node) ? 'group' : 'layer', medium: node.medium, sheet: node.sheet,
  holds: isPaintingGroup(node) ? node.children.length : node.washes.length,
});

/** The first differing path of each field outside the washes, keys left out: keys never reach a solve. */
function documentChanges(a: PaintingDocument, b: PaintingDocument): string[] {
  const changes: string[] = [];
  const compare = (x: PaintingDatum, y: PaintingDatum, path: string) => {
    const found = paintingFirstDifference(x, y, path, 'identity');
    if (found !== null) changes.push(found);
  };
  for (const field of ['widthPx', 'heightPx', 'medium', 'paper'] as const) compare(a[field], b[field], field);
  const visit = (x: readonly LayerNode[], y: readonly LayerNode[], path: string) => y.forEach((node, i) => {
    const at = `${path}[${i}]`, before = x.at(i);
    compare(before ? nodeFrame(before) : null, nodeFrame(node), at);
    if (before && isPaintingGroup(before) && isPaintingGroup(node)) visit(before.children, node.children, `${at}.children`);
  });
  visit(a.layers, b.layers, 'layers');
  return changes;
}

/** What a sheet's every solve starts from: the document's size, the paper's solve half, its water and its clock. */
const sheetHead = (paintingDocument: PaintingDocument, order: PaintingSheetOrder): PaintingDatum => ({
  widthPx: paintingDocument.widthPx, heightPx: paintingDocument.heightPx, grain: order.sheet.paper.grain, absorbency: order.sheet.paper.absorbency,
  water: order.sheet.water, clock: order.clock, edge: order.sheet.edge,
});

/**
 * What an entry brings to its solve: its application and wash without keys (a `clipTo` by the clipped wash's place),
 * where it stands in its sheet's order (its layer by its place among the sheet's layers) and its layer's medium.
 */
function entryDatum(sheets: PaintingSheets, layers: readonly number[], entry: PaintingSheetEntry): PaintingDatum {
  const place = sheets.layers[entry.layer], wash: Wash = place.node.washes[entry.wash];
  const application: AnyApplication = wash.applications[entry.application];
  const clipTo = wash.clipTo === undefined ? undefined : place.node.washes.findIndex(({ key }) => key === wash.clipTo);
  return {
    application: { ...application, key: undefined },
    wash: { ...wash, key: undefined, clipTo, applications: wash.applications.length },
    place: { layer: layers.indexOf(entry.layer), wash: entry.wash, application: entry.application, chain: entry.chain, orderTime: entry.orderTime, medium: place.medium },
  };
}

/** The layers `order` paints, by their index in `PaintingSheets.layers`, in the order they first come. */
const orderLayers = (order: PaintingSheetOrder) => [...new Set(order.entries.map(({ layer }) => layer))];

/** `path` within an entry's datum, named from its owner: `hill-flood.area…`, `hill.clock…`. */
function ownedPath(sheets: PaintingSheets, entry: PaintingSheetEntry, path: string): string {
  const wash = sheets.layers[entry.layer].node.washes[entry.wash];
  const owner = paintingApplicationOwner(wash, wash.applications[entry.application], entry.application);
  const [part, ...rest] = path.split('.');
  const inner = rest.join('.');
  if (part === 'wash') return inner ? `${wash.key}.${inner}` : wash.key;
  if (part === 'place') return `${owner}.${inner}`;
  return inner ? `${owner}.${inner}` : owner;
}

/** A wash's change from the first path that differs in it, or else the change upstream of it on its sheet. */
function washChange(path: string | undefined, cause: string | undefined): PaintingWashChange {
  if (path !== undefined) return { kind: 'content', path };
  return cause === undefined ? { kind: 'same' } : { kind: 'upstream', from: cause };
}

/**
 * What changed from `a` to `b`. Entries pair by their place in each sheet's order, so an entry added or removed
 * changes every later one. Functions (a hand's pressure curve) compare by identity: a recreated one reads `content`,
 * conservative, never a missed change.
 */
export function paintingEvaluationDiff(a: PaintingEvaluation, b: PaintingEvaluation): PaintingEvaluationDiff {
  const before = paintingSheetOrders(a.sheets), after = paintingSheetOrders(b.sheets);
  const washes = after.flatMap((order, s) => {
    const earlier = before.at(s), layersBefore = earlier ? orderLayers(earlier) : [], layersAfter = orderLayers(order);
    const headSame = earlier && paintingFirstDifference(sheetHead(a.document, earlier), sheetHead(b.document, order), '', 'identity') === null;
    let from = headSame ? null : paintingSheetName(order.sheet);
    const content = new Map<string, string>(), upstream = new Map<string, string>();
    order.entries.forEach((entry, k) => {
      const id = `${entry.layer}/${entry.wash}`, then = earlier?.entries.at(k);
      if (from !== null && !upstream.has(id)) upstream.set(id, from);
      const path = then ? paintingFirstDifference(entryDatum(a.sheets, layersBefore, then), entryDatum(b.sheets, layersAfter, entry), '', 'identity') : 'application';
      if (path === null) return;
      if (!content.has(id)) content.set(id, ownedPath(b.sheets, entry, path));
      from ??= ownedPath(b.sheets, entry, 'application');
    });
    return paintingSheetWashes(b.sheets, order.entries).map(({ layer, wash, node }) => {
      const id = `${layer}/${wash}`, path = content.get(id), cause = upstream.get(id);
      return { layer: b.sheets.layers[layer].node.key, wash: node.key, change: washChange(path, cause) };
    });
  });
  return { document: documentChanges(a.document, b.document), washes };
}

/** A wash's change as `studio paint diff` prints it. */
function washChangeText(change: PaintingWashChange): string {
  if (change.kind === 'content') return `content, first at ${change.path}`;
  return change.kind === 'upstream' ? `upstream, after ${change.from}` : 'same';
}

/** `diff` as `studio paint diff` prints it, a line each: the document's changed fields, then each wash. */
export function paintingEvaluationDiffLines(diff: PaintingEvaluationDiff): string[] {
  return [...diff.document.map((path) => `document: ${path} differs`), ...diff.washes.map(({ layer, wash, change }) => `${layer}/${wash}: ${washChangeText(change)}`)];
}

// painting-evaluation-diff.ts: what changed between two evaluations of a painting (two property values, or a source
// before and after an edit), read over each sheet's order as a solve would: the document fields that differ, then
// each wash `same`, changed in its own `content`, or `upstream` of a change earlier on its sheet. It's how an author
// learns what a property costs before warming it. It compares documents: posed marks and reseeds aren't in it.

import type { AnyApplication, LayerKey, LayerNode, PaintingDocument, Wash, WashKey } from './painting-document.ts';
import { paintingFirstDifference, type PaintingDatum } from './painting-document-difference.ts';
import { paintingApplicationOwner } from './painting-problem.ts';
import { paintingSheetOrders, paintingSheetWashes, type PaintingSheetOrder } from './painting-sheet-program.ts';
import type { PaintingEvaluation } from './painting-source.ts';
import { isPaintingGroup, paintingSheetName, type PaintingTree } from './painting-tree.ts';

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
  const visit = (x: readonly LayerNode[], y: readonly LayerNode[], path: string) => {
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const at = `${path}[${i}]`, before = x.at(i), after = y.at(i);
      compare(before ? nodeFrame(before) : null, after ? nodeFrame(after) : null, at);
      if (before && after && isPaintingGroup(before) && isPaintingGroup(after)) visit(before.children, after.children, `${at}.children`);
    }
  };
  visit(a.layers, b.layers, 'layers');
  return changes;
}

/**
 * What a sheet's every solve starts from (ENGINE 4.2's K₀): the document's size, the paper's solve half, its water
 * and its clock. Neither its edge nor its paper's colour is solved.
 */
const sheetHead = (paintingDocument: PaintingDocument, order: PaintingSheetOrder): PaintingDatum => ({
  widthPx: paintingDocument.widthPx, heightPx: paintingDocument.heightPx, grain: order.sheet.paper.grain, absorbency: order.sheet.paper.absorbency,
  water: order.sheet.water, clock: order.clock,
});

/** An entry as its solve reads it, and the owners its datum's first parts name in a path. */
type EntryRead = { readonly datum: PaintingDatum; readonly owners: Readonly<Record<'layer' | 'wash' | 'application', string>> };

/**
 * What each entry of `order` brings to its solve, keys left out (a `clipTo` by the clipped wash's place): its layer's
 * film at the layer's first entry, its wash's fields at the wash's first, then its application and where it stands.
 * `lastOfWash` makes an application added or dropped at a wash's end read.
 */
function entryReads(tree: PaintingTree, order: PaintingSheetOrder): EntryRead[] {
  const seen = new Set<string>();
  return order.entries.map((entry, k) => {
    const { slots, layer: ordinal } = order.layers[entry.layer], place = tree.layers[ordinal], wash: Wash = place.node.washes[entry.wash];
    const application: AnyApplication = wash.applications[entry.application];
    const washId = `${entry.layer}/${entry.wash}`, firstOfLayer = !seen.has(`${entry.layer}`), firstOfWash = !seen.has(washId);
    seen.add(`${entry.layer}`).add(washId);
    const clipTo = wash.clipTo === undefined ? undefined : place.node.washes.findIndex(({ key }) => key === wash.clipTo);
    const datum = {
      layer: firstOfLayer ? { slots } : undefined,
      wash: firstOfWash ? { ...wash, key: undefined, clipTo, applications: undefined } : undefined,
      application: { ...application, key: undefined },
      place: {
        layer: entry.layer, wash: entry.wash, application: entry.application, chain: entry.chain, orderTime: entry.orderTime, medium: place.medium,
        lastOfWash: order.entries.findIndex((other, j) => j > k && other.layer === entry.layer && other.wash === entry.wash) < 0,
      },
    };
    return { datum, owners: { layer: place.node.key, wash: wash.key, application: paintingApplicationOwner(wash, application, entry.application) } };
  });
}

/** Where `path`, a path within an entry's datum, lies by its owner: `water.slots.palette[1]`, `hill-flood.area…`. */
function ownedPath({ owners }: EntryRead, path: string): { readonly owner: string; readonly path: string } {
  const [part, ...rest] = path.split('.'), inner = rest.join('.');
  const owner = part === 'layer' || part === 'wash' ? owners[part] : owners.application;
  return { owner, path: inner ? `${owner}.${inner}` : owner };
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
  const before = paintingSheetOrders(a.tree), after = paintingSheetOrders(b.tree);
  const washes = after.flatMap((order, s) => {
    const earlier = before.at(s), then = earlier ? entryReads(a.tree, earlier) : [], now = entryReads(b.tree, order);
    const headSame = earlier && paintingFirstDifference(sheetHead(a.document, earlier), sheetHead(b.document, order), '', 'identity') === null;
    let from = headSame ? null : paintingSheetName(order.sheet);
    const content = new Map<string, string>(), upstream = new Map<string, string>();
    order.entries.forEach((entry, k) => {
      const id = `${entry.layer}/${entry.wash}`, paired = then.at(k);
      if (from !== null && !upstream.has(id)) upstream.set(id, from);
      const path = paired ? paintingFirstDifference(paired.datum, now[k].datum, '', 'identity') : 'application';
      if (path === null) return;
      const owned = ownedPath(now[k], path);
      if (!content.has(id)) content.set(id, owned.path);
      from ??= owned.owner;
    });
    return paintingSheetWashes(b.tree, order).map(({ layer, wash, place, node }) => {
      const id = `${layer}/${wash}`;
      return { layer: place.node.key, wash: node.key, change: washChange(content.get(id), upstream.get(id)) };
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

// painting-evaluation-diff.ts: what changed between two evaluations of a painting (two property values, or a source
// before and after an edit), read over each sheet's order as a solve would: the document fields that differ, then
// each wash `same`, changed in its own `content`, or `upstream` of a change earlier on its sheet; and the reveals that
// differ, which only recompose. It's how an author learns what a property costs before warming it. It compares
// documents at rest: posed marks and reseeds aren't in it. A wrapped sheet's halo is in its K₀, so it's compared too,
// read through the brushes it compiles with.

import { stampSheetWrapHalo } from '#lib/paint/painting/models/stamp-sheet-wrap.ts';
import { compilePaintingSelection } from './painting-document-compile.ts';
import type { PaintingBrushOf } from './painting-deposit-compile.ts';
import type { LayerKey, LayerNode, PaintingDocument, WashKey } from './painting-document.ts';
import { paintingFirstDifference, type PaintingDatum } from './painting-document-difference.ts';
import { paintingEntryReads, paintingSheetHead, type PaintingEntryRead } from './painting-entry-reads.ts';
import { paintingSheetOrders, paintingSheetWashes } from './painting-sheet-program.ts';
import type { PaintingEvaluation } from './painting-source.ts';
import { isPaintingGroup, paintingSheetName, type PaintingSheet } from './painting-tree.ts';

/** A wash's change: none; in its own applications or fields (the first differing path); or after a change on its sheet. */
export type PaintingWashChange =
  | { readonly kind: 'same' }
  | { readonly kind: 'content'; readonly path: string }
  | { readonly kind: 'upstream'; readonly from: string };

/**
 * `document`: the paths outside any wash that differ, first per field (paper colour is here and re-solves nothing).
 * `washes`: the second evaluation's washes in each sheet's order, the root's sheet first. `reveals`: each node whose
 * reveal differs, at its first differing path (`ink.reveal.strokes[2].to`): recomposed, solving nothing.
 */
export type PaintingEvaluationDiff = {
  readonly document: readonly string[];
  readonly washes: readonly { readonly layer: LayerKey; readonly wash: WashKey; readonly change: PaintingWashChange }[];
  readonly reveals: readonly string[];
};

/** What a node is outside its washes, reveal and keys: what it is, its medium and sheet, and what it holds. */
const nodeFrame = (node: LayerNode): PaintingDatum => ({
  kind: isPaintingGroup(node) ? 'group' : 'layer', medium: node.medium, sheet: node.sheet,
  holds: isPaintingGroup(node) ? node.children.length : node.washes.length,
});

/** `x` and `y`'s first differing path under `path`, pushed onto `into` when they differ. */
function pushFirstDifference(into: string[], x: PaintingDatum, y: PaintingDatum, path: string) {
  const found = paintingFirstDifference(x, y, path, 'identity');
  if (found !== null) into.push(found);
}

/**
 * The first differing path of each field outside the washes, keys left out (keys never reach a solve); and of each
 * node's reveal, named by the second's key, which recomposes only.
 */
function documentChanges(a: PaintingDocument, b: PaintingDocument): { readonly document: string[]; readonly reveals: string[] } {
  const changes: string[] = [], reveals: string[] = [];
  for (const field of ['widthPx', 'heightPx', 'medium', 'paper', 'dryingScale', 'wrap'] as const) pushFirstDifference(changes, a[field], b[field], field);
  const visit = (x: readonly LayerNode[], y: readonly LayerNode[], path: string) => {
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const at = `${path}[${i}]`, before = x.at(i), after = y.at(i);
      pushFirstDifference(changes, before ? nodeFrame(before) : null, after ? nodeFrame(after) : null, at);
      if (before && after) pushFirstDifference(reveals, before.reveal, after.reveal, `${after.key}.reveal`);
      if (before && after && isPaintingGroup(before) && isPaintingGroup(after)) visit(before.children, after.children, `${at}.children`);
    }
  };
  visit(a.layers, b.layers, 'layers');
  return { document: changes, reveals };
}

/** Where `path`, a path within an entry's datum, lies by its owner: `water.slots.palette[1]`, `hill-flood.area…`. */
function ownedPath({ owners }: PaintingEntryRead, path: string): { readonly owner: string; readonly path: string } {
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
 * Each of `evaluation`'s sheets' halo as its solve keys it (stampSheetWrapHalo), or null for a document that doesn't
 * wrap or a sheet holding nothing. Throws for a wrapped document without `brushOf`.
 */
function paintingSheetHalos(evaluation: PaintingEvaluation, brushOf: PaintingBrushOf | null): (sheet: PaintingSheet) => number | null {
  if (evaluation.document.wrap === undefined) return () => null;
  if (!brushOf) throw new Error("a wrapped document's diff reads its halos through its brushes, and none were given");
  const { sheets } = compilePaintingSelection(evaluation, brushOf);
  return (sheet) => {
    const compiled = sheets.find((each) => each.sheet === sheet);
    return compiled ? stampSheetWrapHalo(compiled.program) : null;
  };
}

/**
 * What changed from `a` to `b`. Entries pair by their place in each sheet's order, so an entry added or removed
 * changes every later one. Functions (a hand's pressure curve) compare by identity: a recreated one reads `content`,
 * never a missed change. `brushOf`: a wrapped document's brushes (null when neither wraps), its halos read through.
 */
export function paintingEvaluationDiff(a: PaintingEvaluation, b: PaintingEvaluation, brushOf: PaintingBrushOf | null): PaintingEvaluationDiff {
  const before = paintingSheetOrders(a.tree), after = paintingSheetOrders(b.tree);
  const halosBefore = paintingSheetHalos(a, brushOf), halosAfter = paintingSheetHalos(b, brushOf);
  const washes = after.flatMap((order, s) => {
    const earlier = before.at(s), then = earlier ? paintingEntryReads(a.tree, earlier) : [], now = paintingEntryReads(b.tree, order);
    const headSame = earlier && halosBefore(earlier.sheet) === halosAfter(order.sheet)
      && paintingFirstDifference(paintingSheetHead(a.document, earlier), paintingSheetHead(b.document, order), '', 'identity') === null;
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
  return { ...documentChanges(a.document, b.document), washes };
}

/** A wash's change as `studio paint diff` prints it. */
function washChangeText(change: PaintingWashChange): string {
  if (change.kind === 'content') return `content, first at ${change.path}`;
  return change.kind === 'upstream' ? `upstream, after ${change.from}` : 'same';
}

/** `diff` as `studio paint diff` prints it, a line each: the document's changed fields, each wash, then each reveal. */
export function paintingEvaluationDiffLines(diff: PaintingEvaluationDiff): string[] {
  return [
    ...diff.document.map((path) => `document: ${path} differs`), ...diff.washes.map(({ layer, wash, change }) => `${layer}/${wash}: ${washChangeText(change)}`),
    ...diff.reveals.map((path) => `${path} differs: recompose only, nothing solves`),
  ];
}

// painting-entry-reads.ts: what a sheet's solve reads of a document, as data: its head (K₀'s part, ENGINE 4.2) and each
// entry's datum in the sheet's order. The compiler keys entries by it (with their compiled marks) and the evaluation
// diff compares it, so both read one account of what an entry depends on.

import type { AnyApplication, PaintingDocument, Wash } from './painting-document.ts';
import type { PaintingDatum } from './painting-document-difference.ts';
import { paintingApplicationOwner } from './painting-problem.ts';
import type { PaintingSheetOrder } from './painting-sheet-program.ts';
import type { PaintingTree } from './painting-tree.ts';

/**
 * What a sheet's every solve starts from (ENGINE 4.2's K₀): the document's size and wrap, the paper's solve half, its
 * water and its clock. Neither its edge nor its paper's colour is solved.
 */
export const paintingSheetHead = (paintingDocument: PaintingDocument, order: PaintingSheetOrder): PaintingDatum => ({
  widthPx: paintingDocument.widthPx, heightPx: paintingDocument.heightPx, grain: order.sheet.paper.grain, absorbency: order.sheet.paper.absorbency,
  water: order.sheet.water, clock: order.clock, wrap: paintingDocument.wrap,
});

/** An entry as its solve reads it, and the owners its datum's first parts name in a path. */
export type PaintingEntryRead = { readonly datum: PaintingDatum; readonly owners: Readonly<Record<'layer' | 'wash' | 'application', string>> };

/**
 * What each entry of `order` brings to its solve (a `clipTo` by its wash's place): its layer's key and film at its
 * first entry, its wash's fields at the wash's first, its application and where it stands. Keys seed deposits; state
 * keys chain, so each is read once. Not its node chain: ordinals shift; it's keyed as its pose's text.
 */
export function paintingEntryReads(tree: PaintingTree, order: PaintingSheetOrder): PaintingEntryRead[] {
  const seen = new Set<string>();
  return order.entries.map((entry, k) => {
    const { slots, layer: ordinal } = order.layers[entry.layer], place = tree.layers[ordinal], wash: Wash = place.node.washes[entry.wash];
    const application: AnyApplication = wash.applications[entry.application];
    const washId = `${entry.layer}/${entry.wash}`, firstOfLayer = !seen.has(`${entry.layer}`), firstOfWash = !seen.has(washId);
    seen.add(`${entry.layer}`).add(washId);
    const clipTo = wash.clipTo === undefined ? undefined : place.node.washes.findIndex(({ key }) => key === wash.clipTo);
    const datum = {
      layer: firstOfLayer ? { key: place.node.key, slots } : undefined,
      wash: firstOfWash ? { ...wash, clipTo, applications: undefined } : undefined,
      application,
      place: {
        layer: entry.layer, wash: entry.wash, application: entry.application, orderTime: entry.orderTime, medium: place.medium,
        lastOfWash: order.entries.findIndex((other, j) => j > k && other.layer === entry.layer && other.wash === entry.wash) < 0,
      },
    };
    return { datum, owners: { layer: place.node.key, wash: wash.key, application: paintingApplicationOwner(wash, application, entry.application) } };
  });
}

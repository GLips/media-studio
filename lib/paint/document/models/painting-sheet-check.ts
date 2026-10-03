// painting-sheet-check.ts: the rules a sheet's order decides, the last stage of a document's check: a wet wash only
// on a sheet whose water keeps a wet history, no wash after a wet one under a `never` clock, and the `on`s that can
// never hold, judged over every layer on the sheet, since water is the sheet's and layers dry nothing.

import { PAINT_MEDIA, paintMediumCan } from '#lib/paint/materials/models/paint-medium.ts';
import { stampDepositWetness } from '#lib/paint/painting/models/stamp-paint-action.ts';
import { stampPaintFieldEnds } from '#lib/paint/painting/models/stamp-paint-field.ts';
import type { AnyApplication, Prewet, Wash } from './painting-document.ts';
import { paintingGeometryBox } from './painting-footprint.ts';
import { paintingApplicationOwner, type PaintingProblemList } from './painting-problem.ts';
import { paintingSheetWashes, type PaintingSheetClock, type PaintingSheetOrder } from './painting-sheet-program.ts';
import { paintingBrushMedia, type PaintingStyleCatalogue } from './painting-styles.ts';
import { paintingSheetName, type PaintingTree } from './painting-tree.ts';

/** The most water a prewet lays: its amount, or a field's wetter end. */
function prewetWater({ water = 1 }: Prewet): number {
  if (typeof water === 'number') return water;
  const { first, second } = stampPaintFieldEnds(water);
  return Math.max(first, second);
}

/**
 * Each wet wash on a sheet that keeps a wet history, and, where the sheet's clock is `never`, no wash after a wet one
 * in its layer: nothing on the sheet dries, its unclocked work included, so it never starts.
 */
function checkSheetWashes(list: PaintingProblemList, tree: PaintingTree, order: PaintingSheetOrder): void {
  const water = PAINT_MEDIA[order.sheet.water], name = paintingSheetName(order.sheet);
  const washes = paintingSheetWashes(tree, order).map(({ node }) => node);
  for (const wash of washes) {
    if (wash.wetHistory !== false && !paintMediumCan(water, 'wet-history')) {
      list.error(wash.key, 'applications', `lays water on ${name}, whose medium ${water.name} keeps no wet history`);
    }
  }
  if (order.clock.kind !== 'never') return;
  for (const { layer } of order.layers) {
    const layerWashes = tree.layers[layer].node.washes;
    layerWashes.forEach((wash, w) => {
      const wet = layerWashes.slice(0, w).findLast((earlier) => earlier.wetHistory !== false);
      if (wet) list.error(wash.key, 'clock', `follows ${wet.key} on ${name}, which never dries`);
    });
  }
}

/**
 * Why an `on` in `wash` can never hold on a sheet keeping `clock`, given the wettest water laid before it that it
 * could wait on, or null.
 */
function unreachableOnReason(on: 'wet' | 'damp', wash: Wash, clock: PaintingSheetClock, wettest: number, shiny: number, sheetName: string): string | null {
  if (wash.clock && clock.kind === 'instant') return `on '${on}' on ${sheetName}, whose clock is instant: everything before it has set when it lands`;
  if (wettest <= 0) return `on '${on}' follows no water on ${sheetName}`;
  return on === 'wet' && wettest <= shiny ? `on 'wet' follows only applications at or below shiny ${shiny}` : null;
}

/**
 * Warnings for each `on: 'wet'` or `'damp'` that can never hold, from the water stated before it in its sheet's
 * order. A layer's earlier washes have set when a later one starts, so their water doesn't count; another layer's
 * might still be wet, so it does.
 */
function checkSheetWaits(list: PaintingProblemList, tree: PaintingTree, order: PaintingSheetOrder, styles: PaintingStyleCatalogue | undefined): void {
  const water = PAINT_MEDIA[order.sheet.water], name = paintingSheetName(order.sheet), { shiny } = water.wetting.sheen;
  const laid = new Map<string, { readonly layer: number; readonly wash: number; readonly water: number }>();
  const lay = (layer: number, wash: number, amount: number) => {
    const id = `${layer}/${wash}`;
    laid.set(id, { layer, wash, water: Math.max(laid.get(id)?.water ?? 0, amount) });
  };
  for (const entry of order.entries) {
    const place = tree.layers[order.layers[entry.layer].layer], wash: Wash = place.node.washes[entry.wash];
    if (wash.wetHistory === false) continue;
    const application: AnyApplication = wash.applications[entry.application];
    if (entry.application === 0 && wash.prewet) lay(entry.layer, entry.wash, prewetWater(wash.prewet));
    const on = 'on' in application ? application.on : undefined;
    if (on === 'wet' || on === 'damp') {
      const wettest = Math.max(0, ...[...laid.values()].filter((w) => w.layer !== entry.layer || w.wash >= entry.wash).map((w) => w.water));
      const why = unreachableOnReason(on, wash, order.clock, wettest, shiny, name);
      const owner = paintingApplicationOwner(wash, application, entry.application);
      if (why) list.warn(owner, 'on', `${why}: it can never hold`, paintingGeometryBox(application, application.diameterPx));
    }
    // The water it leaves, judged from what it states: what a later `on` can wait for.
    lay(entry.layer, entry.wash, stampDepositWetness(application.charge, paintingBrushMedia(styles, application.brush), PAINT_MEDIA[place.medium]));
  }
}

/** The sheet rules over every sheet's order, warnings only where the sheet's water can wait at all. */
export function checkPaintingSheetOrders(list: PaintingProblemList, tree: PaintingTree, orders: readonly PaintingSheetOrder[], styles?: PaintingStyleCatalogue): void {
  for (const order of orders) {
    checkSheetWashes(list, tree, order);
    if (paintMediumCan(PAINT_MEDIA[order.sheet.water], 'wet-conditions')) checkSheetWaits(list, tree, order, styles);
  }
}

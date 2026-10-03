// painting-sheet-check.ts: the rules a sheet's order decides, the last stage of a document's check: a wet wash only
// on a sheet whose water keeps a wet history, one clock per sheet, no wash after a wet one under a `never` clock, and
// the `on`s that can never hold, judged over every layer on the sheet, since water is the sheet's and layers dry
// nothing.

import { PAINT_MEDIA, paintMediumCan, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { paintingGeometryBox } from './painting-application-check.ts';
import type { AnyApplication, Prewet, Wash } from './painting-document.ts';
import { paintingApplicationOwner, type PaintingProblemList } from './painting-problem.ts';
import { isPaintingClockedWetWash, paintingSheetWashes, type PaintingSheetOrder } from './painting-sheet-program.ts';
import { paintingSheetName, type PaintingSheets } from './painting-sheets.ts';
import type { PaintingStyleCatalogue } from './painting-styles.ts';

/** The water an application leaves on its sheet, judged from what it states: what a later `on` can wait for. */
function waterLaid(application: AnyApplication, medium: PaintMedium, styles: PaintingStyleCatalogue | undefined): number {
  const { charge } = application;
  if (charge.kind === 'water') return charge.water;
  if (charge.kind === 'lift') return 0;
  const dry = styles?.get(application.brush.style)?.brushes.get(application.brush.brush) === 'dry';
  return dry ? 0 : charge.water ?? medium.wetting.defaultWater;
}

/** The most water a prewet lays: its amount, or a field's wetter end. */
function prewetWater({ water = 1 }: Prewet): number {
  if (typeof water === 'number') return water;
  if (water.kind === 'constant') return water.value;
  if (water.kind === 'linear') return Math.max(water.from.value, water.to.value);
  return water.kind === 'radial' ? Math.max(water.inner, water.outer) : Math.max(water.a, water.b);
}

/**
 * Each wet wash on a sheet that keeps a wet history, every clocked one at the sheet's first clocked wash's scale, and,
 * where that clock is `never`, no wash after a wet one in its layer: nothing on the sheet dries, so it never starts.
 */
function checkSheetWashes(list: PaintingProblemList, sheets: PaintingSheets, order: PaintingSheetOrder): void {
  const water = PAINT_MEDIA[order.sheet.water], name = paintingSheetName(order.sheet);
  const washes = paintingSheetWashes(sheets, order.entries).map(({ node }) => node);
  for (const wash of washes) {
    if (wash.wetHistory !== false && !paintMediumCan(water, 'wet-history')) {
      list.error(wash.key, 'applications', `lays water on ${name}, whose medium ${water.name} keeps no wet history`);
    }
  }
  const [first, ...later] = washes.filter(isPaintingClockedWetWash);
  for (const wash of later) {
    if (wash.clock?.dryingScale === first.clock?.dryingScale) continue;
    list.error(wash.key, 'clock', `paints ${name} at dryingScale ${wash.clock?.dryingScale} and ${first.key} at ${first.clock?.dryingScale}: a sheet keeps one clock`);
  }
  if (order.clock.kind !== 'never') return;
  for (const layer of new Set(order.entries.map((entry) => entry.layer))) {
    const layerWashes = sheets.layers[layer].node.washes;
    layerWashes.forEach((wash, w) => {
      const wet = layerWashes.slice(0, w).findLast((earlier) => earlier.wetHistory !== false);
      if (wet) list.error(wash.key, 'clock', `follows ${wet.key} on ${name}, whose clock never dries`);
    });
  }
}

/** Why an `on` can never hold, given the wettest water laid before it that it could wait on, or null. */
function unreachableOnReason(on: 'wet' | 'damp', wash: Wash, wettest: number, shiny: number, sheetName: string): string | null {
  if (wash.clock?.dryingScale === 'instant') return `on '${on}' in an instant wash: everything before it has set when it lands`;
  if (wettest <= 0) return `on '${on}' follows no water on ${sheetName}`;
  return on === 'wet' && wettest <= shiny ? `on 'wet' follows only applications at or below shiny ${shiny}` : null;
}

/**
 * Warnings for each `on: 'wet'` or `'damp'` that can never hold, from the water stated before it in its sheet's
 * order. A layer's earlier washes have set when a later one starts, so their water doesn't count; another layer's
 * might still be wet, so it does.
 */
function checkSheetWaits(list: PaintingProblemList, sheets: PaintingSheets, order: PaintingSheetOrder, styles: PaintingStyleCatalogue | undefined): void {
  const water = PAINT_MEDIA[order.sheet.water], name = paintingSheetName(order.sheet), { shiny } = water.wetting.sheen;
  const laid = new Map<string, { readonly layer: number; readonly wash: number; readonly water: number }>();
  const lay = (layer: number, wash: number, amount: number) => {
    const id = `${layer}/${wash}`;
    laid.set(id, { layer, wash, water: Math.max(laid.get(id)?.water ?? 0, amount) });
  };
  for (const entry of order.entries) {
    const place = sheets.layers[entry.layer], wash: Wash = place.node.washes[entry.wash];
    if (wash.wetHistory === false) continue;
    const application: AnyApplication = wash.applications[entry.application];
    if (entry.application === 0 && wash.prewet) lay(entry.layer, entry.wash, prewetWater(wash.prewet));
    const on = 'on' in application ? application.on : undefined;
    if (on === 'wet' || on === 'damp') {
      const wettest = Math.max(0, ...[...laid.values()].filter((w) => w.layer !== entry.layer || w.wash >= entry.wash).map((w) => w.water));
      const why = unreachableOnReason(on, wash, wettest, shiny, name);
      const owner = paintingApplicationOwner(wash, application, entry.application);
      if (why) list.warn(owner, 'on', `${why}: it can never hold`, paintingGeometryBox(application, application.diameterPx));
    }
    lay(entry.layer, entry.wash, waterLaid(application, PAINT_MEDIA[place.medium], styles));
  }
}

/** The sheet rules over every sheet's order, warnings only where the sheet's water can wait at all. */
export function checkPaintingSheetOrders(list: PaintingProblemList, sheets: PaintingSheets, orders: readonly PaintingSheetOrder[], styles?: PaintingStyleCatalogue): void {
  for (const order of orders) {
    checkSheetWashes(list, sheets, order);
    if (paintMediumCan(PAINT_MEDIA[order.sheet.water], 'wet-conditions')) checkSheetWaits(list, sheets, order, styles);
  }
}

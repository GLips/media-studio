// painting-sheet-program.ts: each sheet's order (docs/painting-authoring.md, Sheets), the one physical history every
// application on a sheet takes part in, whichever layer it paints: the unclocked run in document order, then the
// clocked run sorted by order time, ties in document order. A pure function of the document, so validation,
// comparison and the compiler read one order. Entries name layers, washes and groups by ordinal: keys never reach a
// solve.

import type { AnyApplication, Layer, Wash } from './painting-document.ts';
import type { PaintingSheet, PaintingSheets } from './painting-sheets.ts';

/** A clocked wash's start and each application's order time, in scene seconds; both null in an unclocked wash. */
export type PaintingWashOrderTimes = { readonly start: number | null; readonly times: readonly (number | null)[] };

/**
 * One application in its sheet's order: its layer (an index into `PaintingSheets.layers`), wash and application
 * ordinals, `chain`, the groups between the sheet's owner and its layer (ordinals among the document's groups,
 * outermost first), whose poses move its marks before painting, and its order time (null in the unclocked run).
 */
export type PaintingSheetEntry = {
  readonly layer: number;
  readonly wash: number;
  readonly application: number;
  readonly chain: readonly number[];
  readonly orderTime: number | null;
};

/**
 * The one clock a sheet's clocked wet washes share: `scale` maps model time to scene time from `origin`, the earliest
 * of their numeric origins; `none` when no clocked wet wash paints the sheet.
 */
export type PaintingSheetClock = { readonly kind: 'none' } | { readonly kind: 'scale'; readonly scale: number; readonly origin: number } | { readonly kind: 'instant' } | { readonly kind: 'never' };

export type PaintingSheetOrder = { readonly sheet: PaintingSheet; readonly clock: PaintingSheetClock; readonly entries: readonly PaintingSheetEntry[] };

/** Whether `wash` reads and writes its sheet's water and keeps a clock with it. */
export const isPaintingClockedWetWash = (wash: Wash) => wash.clock !== undefined && wash.wetHistory !== false;

/**
 * Each wash of `layer` with its order times: a clocked wash starts at its numeric origin, or under `'set'` at the
 * latest order time of the layer's earlier clocked washes (null if it has none, which validation refuses); each
 * application takes its fixed `at`, else its predecessor's time, the first the wash's start.
 */
export function paintingWashOrderTimes(layer: Layer): PaintingWashOrderTimes[] {
  let latest: number | null = null;
  return layer.washes.map((wash) => {
    const applications: readonly AnyApplication[] = wash.applications;
    if (!wash.clock) return { start: null, times: applications.map(() => null) };
    const start = wash.clock.origin === 'set' ? latest : wash.clock.origin;
    let previous = start;
    const times = applications.map(({ at }) => (previous = at ?? previous));
    for (const time of times) if (time !== null) latest = Math.max(latest ?? time, time);
    return { start, times };
  });
}

/** The clock of the sheet whose clocked wet washes, in its order, are `washes`: the first one's. */
function paintingSheetClock(washes: readonly Wash[]): PaintingSheetClock {
  const first = washes[0]?.clock;
  if (!first) return { kind: 'none' };
  if (first.dryingScale === 'instant' || first.dryingScale === 'never') return { kind: first.dryingScale };
  const origins = washes.flatMap(({ clock }) => (typeof clock?.origin === 'number' ? [clock.origin] : []));
  return { kind: 'scale', scale: first.dryingScale, origin: Math.min(...origins) };
}

/** The washes `order` paints, each once, in the order their first applications come. */
export function paintingSheetWashes(sheets: PaintingSheets, order: readonly PaintingSheetEntry[]): { readonly layer: number; readonly wash: number; readonly node: Wash }[] {
  const seen = new Set<string>();
  return order.flatMap(({ layer, wash }) => {
    const id = `${layer}/${wash}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ layer, wash, node: sheets.layers[layer].node.washes[wash] }];
  });
}

/** Every sheet's order and clock, the root's first. Expects a document whose washes and clocks are checked. */
export function paintingSheetOrders(sheets: PaintingSheets): PaintingSheetOrder[] {
  const groups = sheets.nodes.flatMap(({ kind, node }) => (kind === 'group' ? [node.key] : []));
  return sheets.sheets.map((sheet) => {
    const unclocked: PaintingSheetEntry[] = [], clocked: PaintingSheetEntry[] = [];
    sheets.layers.forEach((place, layer) => {
      if (place.sheet !== sheet) return;
      const below = sheet.owner === null ? 0 : place.groups.indexOf(sheet.owner) + 1;
      const chain = sheet.owner === place.node.key ? [] : place.groups.slice(below).map((key) => groups.indexOf(key));
      paintingWashOrderTimes(place.node).forEach(({ times }, wash) => times.forEach((orderTime, application) => {
        (orderTime === null ? unclocked : clocked).push({ layer, wash, application, chain, orderTime });
      }));
    });
    // toSorted is stable: ties keep document order.
    const entries = [...unclocked, ...clocked.toSorted((a, b) => (a.orderTime ?? 0) - (b.orderTime ?? 0))];
    const wet = paintingSheetWashes(sheets, entries).map(({ node }) => node).filter(isPaintingClockedWetWash);
    return { sheet, clock: paintingSheetClock(wet), entries };
  });
}

// painting-sheet-program.ts: each sheet's order (docs/painting-authoring.md, Sheets), the one physical history every
// application on a sheet takes part in, whichever layer it paints: the unclocked run in document order, then the
// clocked run sorted by order time, ties in document order. A pure function of the document, so validation,
// comparison and the compiler read one order. Entries name layers, washes and groups by ordinal: keys never reach a
// solve.

import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import type { StampSheetClock } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import type { AnyApplication, Layer, MediumName, Wash } from './painting-document.ts';
import { paintingLayerSlots, type PaintingPigmentSlots } from './painting-pigment-slots.ts';
import type { PaintingLayerPlace, PaintingSheet, PaintingTree } from './painting-tree.ts';

/** A clocked wash's start and each application's order time, in scene seconds; both null in an unclocked wash. */
export type PaintingWashOrderTimes = { readonly start: number | null; readonly times: readonly (number | null)[] };

/**
 * One layer a sheet's order paints, back to front: `layer`, its ordinal in `PaintingTree.layers`; the medium its paint
 * lands by; its film's layout.
 */
export type PaintingSheetLayer = { readonly layer: number; readonly medium: MediumName; readonly slots: PaintingPigmentSlots };

/**
 * One application in its sheet's order: its layer (an index into its order's `layers`), wash and application
 * ordinals; `chain`, the nodes below the sheet's owner down to its layer, the layer too unless it owns the sheet
 * (indexes into `PaintingTree.nodes`, outermost first), whose poses move its marks before painting; and its order
 * time (null in the unclocked run).
 */
export type PaintingSheetEntry = {
  readonly layer: number;
  readonly wash: number;
  readonly application: number;
  readonly chain: readonly number[];
  readonly orderTime: number | null;
};

/**
 * A sheet's order: its record, its clock, the layers on it back to front, and its entries; `ownerChain`, the nodes
 * whose poses move the finished sheet, paper and all (ENGINE 5.3): its owner and every group enclosing it, as node
 * ordinals outermost first, none for the root's.
 */
export type PaintingSheetOrder = {
  readonly sheet: PaintingSheet;
  readonly clock: StampSheetClock;
  readonly ownerChain: readonly number[];
  readonly layers: readonly PaintingSheetLayer[];
  readonly entries: readonly PaintingSheetEntry[];
};

/** Whether `wash` reads and writes its sheet's water and keeps a clock with it. */
export const isPaintingClockedWetWash = (wash: Wash) => wash.clock !== undefined && wash.wetHistory !== false;

/**
 * Each wash of `layer` with its order times: a clocked wash starts at its numeric origin, or under `'set'` at the
 * latest start or order time of the layer's earlier clocked washes (null if it has none, which validation refuses);
 * each application takes its fixed `at`, else its predecessor's time, the first the wash's start.
 */
export function paintingWashOrderTimes(layer: Layer): PaintingWashOrderTimes[] {
  let latest: number | null = null;
  const reach = (time: number | null) => {
    if (time !== null) latest = Math.max(latest ?? time, time);
  };
  return layer.washes.map((wash) => {
    const applications: readonly AnyApplication[] = wash.applications;
    if (!wash.clock) return { start: null, times: applications.map(() => null) };
    const start = wash.clock.origin === 'set' ? latest : wash.clock.origin;
    let previous = start;
    const times = applications.map(({ at }) => (previous = at ?? previous));
    // An empty clocked wash still starts, and a later `'set'` wash waits for it.
    [start, ...times].forEach(reach);
    return { start, times };
  });
}

/**
 * The clock of `sheet` if `timed`, some clocked wet wash paints it: at its scale, run from `origin`, the earliest start
 * among the sheet's clocked washes.
 */
function paintingSheetClock(sheet: PaintingSheet, timed: boolean, origin: number): StampSheetClock {
  if (!timed) return { kind: 'none' };
  const scale = sheet.dryingScale;
  return scale === 'instant' || scale === 'never' ? { kind: scale } : { kind: 'scale', scale, origin };
}

/** A wash an order paints: its layer and wash ordinals as its entries give them, its layer's place, and itself. */
export type PaintingSheetWash = { readonly layer: number; readonly wash: number; readonly place: PaintingLayerPlace; readonly node: Wash };

/** The washes `order` paints, each once, in the order their first applications come. */
export function paintingSheetWashes(tree: PaintingTree, order: Pick<PaintingSheetOrder, 'layers' | 'entries'>): PaintingSheetWash[] {
  const seen = new Set<string>();
  return order.entries.flatMap(({ layer, wash }) => {
    const id = `${layer}/${wash}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const place = tree.layers[order.layers[layer].layer];
    return [{ layer, wash, place, node: place.node.washes[wash] }];
  });
}

const nodeOrdinals = (tree: PaintingTree, keys: readonly string[]) => keys.map((key) => tree.nodes.indexOf(tree.byKey.get(key)!));

/**
 * The nodes posing `place`'s marks on `sheet` before painting, as node ordinals outermost first: those below the
 * sheet's owner (below the document's top for the root's) down to the layer itself. Everything from the owner up
 * moves the finished sheet instead (paintingSheetOwnerChain).
 */
function paintingSheetChain(tree: PaintingTree, sheet: PaintingSheet, place: PaintingLayerPlace): number[] {
  if (sheet.owner === place.node.key) return [];
  const below = sheet.owner === null ? 0 : place.groups.indexOf(sheet.owner) + 1;
  return nodeOrdinals(tree, [...place.groups.slice(below), place.node.key]);
}

/** The nodes moving `sheet` whole: its owner and every group enclosing it, node ordinals outermost first. */
function paintingSheetOwnerChain(tree: PaintingTree, sheet: PaintingSheet): number[] {
  return sheet.owner === null ? [] : nodeOrdinals(tree, [...tree.byKey.get(sheet.owner)!.groups, sheet.owner]);
}

/**
 * Every sheet's order and clock, the root's first, over the layers `selected` (ordinals in `PaintingTree.layers`; all
 * of them when left out): a plane painting some of a sheet's layers paints them as a painting of their own. Expects a
 * document whose washes, clocks and mixes are checked.
 */
export function paintingSheetOrders(tree: PaintingTree, selected?: ReadonlySet<number>): PaintingSheetOrder[] {
  return tree.sheets.map((sheet) => {
    const layers: PaintingSheetLayer[] = [], unclocked: PaintingSheetEntry[] = [], clocked: PaintingSheetEntry[] = [], starts: number[] = [];
    tree.layers.forEach((place, ordinal) => {
      if (place.sheet !== sheet || (selected && !selected.has(ordinal))) return;
      const layer = layers.push({ layer: ordinal, medium: place.medium, slots: paintingLayerSlots(place.node, PAINT_MEDIA[place.medium]) }) - 1;
      const chain = paintingSheetChain(tree, sheet, place);
      paintingWashOrderTimes(place.node).forEach(({ start, times }, wash) => {
        if (start !== null && times.length > 0) starts.push(start);
        times.forEach((orderTime, application) => (orderTime === null ? unclocked : clocked).push({ layer, wash, application, chain, orderTime }));
      });
    });
    // toSorted is stable: ties keep document order.
    const order = { sheet, ownerChain: paintingSheetOwnerChain(tree, sheet), layers, entries: [...unclocked, ...clocked.toSorted((a, b) => (a.orderTime ?? 0) - (b.orderTime ?? 0))] };
    const timed = paintingSheetWashes(tree, order).some(({ node }) => isPaintingClockedWetWash(node));
    return { ...order, clock: paintingSheetClock(sheet, timed, Math.min(...starts)) };
  });
}

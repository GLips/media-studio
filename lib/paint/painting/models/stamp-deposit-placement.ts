// stamp-deposit-placement.ts: a deposit's marks (its stamps, its dual's and a flood's body) placed from its geometry,
// brush, diameter and seed alone. A painting recompiled each frame places mostly the same marks again (a sky staying
// put under a moving cloud), so placements are remembered by those inputs' content and shared by every painting that
// asks for them. Shared, a placement owns all it holds and is frozen, so no painting can change another's marks.
//
// Content, not identity: inputs built afresh each frame, or edited in place, get what they place now. A function in
// them (a hand's pressure curve) is keyed by identity, as its content can't be read: it must answer alike each time.

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { placeAuthoredStamps, placeStrokeStamps, stampExpectedTint, stampFrozenMarks, type FrozenStampMarks, type PlacedStamp, type StampPlacementBrush, type StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';
import { handStampStroke, type StampPressureCurve } from '#lib/paint/brush/models/stamp-stroke-hand.ts';
import { STAMP_ACCUMULATIONS } from './stamp-deposit-stages.ts';
import { placeStampFlood, stampFillStrokePath, stampFloodBodyLevels, stampFloodFront, stampFloodProbe, type StampFillApplication } from './stamp-fill.ts';
import { stampPaintFieldAt, type StampPaintField } from './stamp-paint-field.ts';
import type { CompiledStampFlood, StampDepositGeometry } from './stamp-paint-recipe.ts';

/** Where a deposit goes, a fill's application settled (its brush's media's when the author left it out). */
export type StampPlacingGeometry = Exclude<StampDepositGeometry, { kind: 'fill' }> | (Extract<StampDepositGeometry, { kind: 'fill' }> & { application: StampFillApplication });

/** A deposit's marks, `M`: every stamp in reveal order, its dual's, and a flood's body and front. */
type StampDepositMarks<M> = { stamps: M; dualStamps: M } & ({ kind: 'stroke' | 'stamps' } | { kind: 'flood'; flood: CompiledStampFlood });
/** A deposit's marks as compiled paintings share them, frozen. */
export type StampDepositPlacement = StampDepositMarks<FrozenStampMarks>;

/**
 * The most bytes the remembered placements hold, least recently asked for given up first: three or four paintings of
 * a full 720p landscape (60 to 75 thousand stamps each, about 400 bytes a stamp). One larger is placed, not kept.
 */
export const STAMP_PLACEMENTS_KEPT_BYTES = 80 * 2 ** 20;

/**
 * What a placement holds, in bytes, roughly: its stamps (each about 320, and 80 more for what loading works out from
 * it, kept as long as it is: stamp-mark-load.ts), a flood's grid and outline, and its key.
 */
const STAMP_BYTES = 400, POINT_BYTES = 64, ENTRY_BYTES = 1024;
const bytesOf = ({ stamps, dualStamps, ...placement }: StampDepositPlacement, key: string) => ENTRY_BYTES + 2 * key.length + STAMP_BYTES * (stamps.length + dualStamps.length)
  + (placement.kind === 'flood' ? placement.flood.thickness.values.byteLength + POINT_BYTES * placement.flood.polygon.length : 0);

const kept = new Map<string, { placement: StampDepositPlacement; bytes: number }>();
let keptBytes = 0;

/** `geometry` placed by `brush` at `diameter`, seeded by `seed`: remembered by their content, or placed now. */
export function placeStampDeposit(geometry: StampPlacingGeometry, brush: StampBrush, diameter: number, seed: string): StampDepositPlacement {
  const key = `${stampContentKey(brush)}\n${diameter}\n${seed}\n${stampContentKey(geometry)}`;
  const found = kept.get(key);
  if (found) {
    // Asked for again: the most recent, given up last.
    kept.delete(key);
    kept.set(key, found);
    return found.placement;
  }
  const placement = frozenPlacement(placeNow(geometry, brush, diameter, seed));
  const bytes = bytesOf(placement, key);
  if (bytes > STAMP_PLACEMENTS_KEPT_BYTES) return placement;
  kept.set(key, { placement, bytes });
  keptBytes += bytes;
  for (const [oldest, entry] of kept) {
    if (keptBytes <= STAMP_PLACEMENTS_KEPT_BYTES) break;
    kept.delete(oldest);
    keptBytes -= entry.bytes;
  }
  return placement;
}

/**
 * `placement` frozen, through every stamp and a flood's body and tint, its outline and load copied from the caller's
 * region and field. Its thickness grid's values stay writable: a typed array with elements can't be frozen.
 */
function frozenPlacement(placement: StampDepositMarks<PlacedStamp[]>): StampDepositPlacement {
  const stamps = stampFrozenMarks(placement.stamps), dualStamps = stampFrozenMarks(placement.dualStamps);
  if (placement.kind !== 'flood') return Object.freeze({ kind: placement.kind, stamps, dualStamps });
  const { flood } = placement, { load, front } = flood;
  const owned = Object.freeze({
    ...flood,
    polygon: Object.freeze(flood.polygon.map(({ x, y }) => Object.freeze({ x, y }))),
    load: Object.freeze(ownedLoad(load)),
    front: Object.freeze({ ...front, normal: Object.freeze(front.normal) }),
    box: Object.freeze({ ...flood.box }), levels: Object.freeze({ ...flood.levels }), tint: Object.freeze({ ...flood.tint }), thickness: Object.freeze({ ...flood.thickness }),
  });
  return Object.freeze({ kind: 'flood', flood: owned, stamps, dualStamps });
}

/** A copy of the caller's `load`, its points frozen with it. */
function ownedLoad(load: StampPaintField<number>): StampPaintField<number> {
  if (load.kind === 'constant') return { ...load };
  if (load.kind === 'linear') return { ...load, from: Object.freeze({ ...load.from }), to: Object.freeze({ ...load.to }) };
  return { ...load, center: Object.freeze({ ...load.center }) };
}

function placeNow(geometry: StampPlacingGeometry, brush: StampBrush, diameter: number, seed: string): StampDepositMarks<PlacedStamp[]> {
  if (geometry.kind === 'fill') {
    const { region, application, direction = 0, load = { kind: 'constant', value: 1 } } = geometry;
    if (application.kind === 'flood') {
      const { body, stamps, dualStamps } = placeStampFlood(region, brush, diameter, direction, seed);
      const levels = stampFloodBodyLevels(STAMP_ACCUMULATIONS[brush.accumulation.kind].towardFull, stampFloodProbe(brush, diameter, `${seed}|probe`));
      const flood = { ...body, load, levels, tint: stampExpectedTint(brush.color), front: stampFloodFront(body.polygon, [...stamps, ...dualStamps], direction, diameter) };
      return { kind: 'flood', flood, stamps, dualStamps };
    }
    const strokes = stampFillStrokePath(region, diameter, direction, application, seed);
    const place = (stamping: StampPlacementBrush, scale: number, placing: string) => (strokes.length ? placeStrokeStamps(strokes, stamping, diameter * scale, placing) : []);
    const stamps = place(brush, 1, seed);
    for (const stamp of stamps) stamp.opacity *= stampPaintFieldAt(load, stamp.x, stamp.y);
    return { kind: 'stroke', stamps, dualStamps: brush.dual ? place(brush.dual, brush.dual.scale, `${seed}|dual`) : [] };
  }
  // The hand's path is worked out once, so the main stamps and the dual's follow the same wobble.
  let path: readonly StampStrokePoint[] = [];
  if (geometry.kind === 'stroke') path = geometry.hand ? handStampStroke(geometry.path, geometry.hand, diameter, `${seed}|hand`) : geometry.path;
  const place = (stamping: StampPlacementBrush, scale: number, placing: string) => geometry.kind === 'stroke'
    ? placeStrokeStamps(path, stamping, diameter * scale, placing)
    : placeAuthoredStamps(geometry.at.map((at) => (at.diameter === undefined ? at : { ...at, diameter: at.diameter * scale })), stamping, diameter * scale, placing);
  return { kind: geometry.kind, stamps: place(brush, 1, seed), dualStamps: brush.dual ? place(brush.dual, brush.dual.scale, `${seed}|dual`) : [] };
}

/**
 * A field of a placement's inputs as JSON meets it: data, or a hand's pressure curve, the one function a deposit's
 * geometry or brush holds.
 */
type StampInputField = string | number | boolean | null | undefined | readonly StampInputField[] | { readonly [field: string]: StampInputField } | StampPressureCurve;

const isStampPressureCurve = (field: StampInputField): field is StampPressureCurve => typeof field === 'function';
/** A number JSON would write as another: -0 as 0, and NaN and the infinities as null. */
const isMisreadNumber = (field: StampInputField): field is number => typeof field === 'number' && (!Number.isFinite(field) || Object.is(field, -0));

const functionIds = new WeakMap<StampPressureCurve, number>();
let nextFunctionId = 0;

/**
 * `value`'s content as a string two values share only if placing reads them alike: JSON, but a function by its
 * identity, and -0 and the non-finite numbers by name, where JSON would fold them into 0 and null.
 */
const stampContentKey = (value: StampInputField): string => JSON.stringify(value, (_name, field: StampInputField) => {
  if (isStampPressureCurve(field)) {
    let id = functionIds.get(field);
    if (id === undefined) functionIds.set(field, (id = nextFunctionId++));
    return `ƒ${id}`;
  }
  return isMisreadNumber(field) ? `#${Object.is(field, -0) ? '-0' : field}` : field;
});


// stamp-deposit-placement.ts: a deposit's marks placed (its stamps, its dual's and a flood's body) from where it goes,
// its brush, its diameter and its seed, and nothing else. A painting recompiled each frame places mostly the same
// marks again (a sky that stays put under a cloud that moves), so placements are remembered by those inputs' content
// and shared by every compiled painting that asks for them. Shared, they are never written to once placed.
//
// Content, not identity: a scene that builds its regions and brushes afresh each frame still reuses what's unchanged.
// A function in the inputs (a hand's pressure curve) is keyed by identity, as its content can't be read.

import type { StampBrush } from './stamp-brush.ts';
import { placeAuthoredStamps, placeStrokeStamps, stampExpectedTint, type PlacedStamp, type StampPlacementBrush, type StampStrokePoint } from './stamp-placement.ts';
import { handStampStroke, type StampPressureCurve } from './stamp-stroke-hand.ts';
import { STAMP_ACCUMULATIONS } from './stamp-deposit-stages.ts';
import { placeStampFlood, stampFillStrokePath, stampFloodBodyLevels, stampFloodFront, stampFloodProbe, type StampFillApplication } from './stamp-fill.ts';
import { stampPaintFieldAt } from './stamp-paint-field.ts';
import type { CompiledStampFlood, StampDepositGeometry } from './stamp-paint-recipe.ts';

/** Where a deposit goes, a fill's application settled (its brush's media's when the author left it out). */
export type StampPlacingGeometry = Exclude<StampDepositGeometry, { kind: 'fill' }> | (Extract<StampDepositGeometry, { kind: 'fill' }> & { application: StampFillApplication });

/** A deposit's marks: every stamp in reveal order, its dual's, and a flood's body and front. */
export type StampDepositPlacement = { stamps: readonly PlacedStamp[]; dualStamps: readonly PlacedStamp[] } & ({ kind: 'stroke' | 'stamps' } | { kind: 'flood'; flood: CompiledStampFlood });

/**
 * The most stamps the remembered placements hold, main and dual together, least recently asked for given up first:
 * about five paintings of a full 720p landscape (60 to 75 thousand each), some 80 MB.
 */
export const STAMP_PLACEMENTS_KEPT = 400_000;

const kept = new Map<string, StampDepositPlacement>();
let keptStamps = 0;
const stampCount = ({ stamps, dualStamps }: StampDepositPlacement) => stamps.length + dualStamps.length;

/** `geometry` placed by `brush` at `diameter`, seeded by `seed`: remembered by their content, or placed now. */
export function placeStampDeposit(geometry: StampPlacingGeometry, brush: StampBrush, diameter: number, seed: string): StampDepositPlacement {
  const key = `${stampBrushKey(brush)}\n${diameter}\n${seed}\n${stampContentKey(geometry)}`;
  const found = kept.get(key);
  if (found) {
    // Asked for again: the most recent, given up last.
    kept.delete(key);
    kept.set(key, found);
    return found;
  }
  const placed = placeNow(geometry, brush, diameter, seed);
  kept.set(key, placed);
  keptStamps += stampCount(placed);
  for (const [oldest, placement] of kept) {
    if (keptStamps <= STAMP_PLACEMENTS_KEPT || oldest === key) break;
    kept.delete(oldest);
    keptStamps -= stampCount(placement);
  }
  return placed;
}

function placeNow(geometry: StampPlacingGeometry, brush: StampBrush, diameter: number, seed: string): StampDepositPlacement {
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
const stampContentKey = (value: StampBrush | StampPlacingGeometry): string => JSON.stringify(value, (_name, field: StampInputField) => {
  if (isStampPressureCurve(field)) {
    let id = functionIds.get(field);
    if (id === undefined) functionIds.set(field, (id = nextFunctionId++));
    return `ƒ${id}`;
  }
  return isMisreadNumber(field) ? `#${Object.is(field, -0) ? '-0' : field}` : field;
});

const brushKeys = new WeakMap<StampBrush, string>();
/** A brush's content key, worked out once per object: a style's brushes are the same objects frame after frame. */
function stampBrushKey(brush: StampBrush): string {
  let key = brushKeys.get(brush);
  if (key === undefined) brushKeys.set(brush, (key = stampContentKey(brush)));
  return key;
}

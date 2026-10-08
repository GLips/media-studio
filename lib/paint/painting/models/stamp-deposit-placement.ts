// stamp-deposit-placement.ts: a deposit's marks (its stamps, its dual's and a flood's barrier) placed from its geometry,
// brush, diameter and seed alone. A painting recompiled each frame places mostly the same marks again (a sky staying
// put under a moving cloud), so placements are remembered by those inputs' content and shared by every painting that
// asks for them. Shared, a placement owns all it holds and is frozen, so no painting can change another's marks.
//
// Content, not identity: inputs built afresh each frame, or edited in place, get what they place now. A function in
// them (a hand's pressure curve) is keyed by identity, as its content can't be read: it must answer alike each time.

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { placeStrokeStamps, stampFrozenMarks, type FrozenStampMarks, type PlacedStamp, type StampPlacementBrush } from '#lib/paint/brush/models/stamp-placement.ts';
import type { StampPressureCurve } from '#lib/paint/brush/models/stamp-stroke-hand.ts';
import { stampBrushEdgeOffsetMean, stampBrushMeasuredProfile } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import type { CompiledStampArea } from './stamp-area.ts';
import { placeStampFlood, stampBrushFillEdge, stampFloodBarrier, stampFloodEdgeOf, stampFloodLaidPast, type StampFillApplication } from './stamp-fill.ts';
import { stampFillStrokePath } from './stamp-fill-strokes.ts';
import { createKeptByBytes, type StampKeptHeld } from './stamp-kept-memo.ts';
import { registerStampCanonicalList } from './stamp-canonical.ts';
import { stampMarkStamps } from './stamp-marks.ts';
import { stampPaintFieldAt, type StampSeededPaintField } from './stamp-paint-field.ts';
import type { CompiledStampFlood } from './stamp-paint-recipe-compile.ts';
import { stampGrownPolygon, stampRegionPolygon, type StampPoint } from './stamp-region.ts';
import type { StampResolvedGeometry } from './stamp-paint-recipe-types.ts';

/**
 * Where a deposit goes, a fill's application settled (its brush's media's when the author left it out) and its load
 * seeded (stampSeededPaintField).
 */
export type StampPlacingGeometry = Exclude<StampResolvedGeometry, { kind: 'fill' }> | (Extract<StampResolvedGeometry, { kind: 'fill' }> & { application: StampFillApplication; load: StampSeededPaintField<number> });

/** A deposit's marks, `M`: every stamp in the order laid, its dual's, and a flood's barrier. */
type StampDepositMarks<M> = { stamps: M; dualStamps: M } & ({ kind: 'stroke' | 'stamps' } | { kind: 'flood'; flood: CompiledStampFlood });
/** A deposit's marks as compiled paintings share them, frozen. */
export type StampDepositPlacement = StampDepositMarks<FrozenStampMarks>;

/**
 * The most bytes the remembered placements hold, least recently asked for given up first: a whole 1080p scene's (the
 * lake's are 1.6 GB), as a key drawing recompiles each painting, and one too small misses every one in turn. They're
 * mostly the marks compiled paintings hold anyway, so this adds only what those gave up. One larger is placed again.
 */
export const STAMP_PLACEMENTS_KEPT_BYTES = 2048 * 2 ** 20;

/**
 * What a kept stamp holds, in bytes, roughly: about 320, and 80 more for what loading works out from it, kept as long
 * as it is (stamp-mark-load.ts).
 */
export const STAMP_KEPT_BYTES = 400;

/** What a placement holds, in bytes, roughly: its stamps, a flood's outline, and its key. */
const POINT_BYTES = 64, ENTRY_BYTES = 1024;
const bytesOf = ({ stamps, dualStamps, ...placement }: StampDepositPlacement, key: string) => ENTRY_BYTES + 2 * key.length + STAMP_KEPT_BYTES * (stamps.length + dualStamps.length)
  + (placement.kind === 'flood' ? POINT_BYTES * placement.flood.barrier.polygon.length : 0);

const kept = createKeptByBytes<string, StampDepositPlacement>(STAMP_PLACEMENTS_KEPT_BYTES);

/** What the placements kept hold now: how many, and their bytes, roughly. */
export const stampPlacementsKept = (): StampKeptHeld => kept.held();

/** `geometry` placed by `brush` at `diameter`, seeded by `seed`: remembered by their content, or placed now. */
export function placeStampDeposit(geometry: StampPlacingGeometry, brush: StampBrush, diameter: number, seed: string): StampDepositPlacement {
  // A measured profile is its key's: its samples, thousands of numbers, would be the key's bulk.
  const keyed = brush.profile.kind === 'measured' ? { ...brush, profile: brush.profile.key } : brush;
  const brushKey = stampContentKey(keyed), geometryKey = stampContentKey(geometry);
  const key = `${brushKey.text}\n${diameter}\n${seed}\n${geometryKey.text}`;
  const found = kept.get(key);
  if (found) return found;
  const placement = frozenPlacement(placeNow(geometry, brush, diameter, seed));
  // Frozen through every stamp, its marks' digests can be remembered. A key with no function names them in any page,
  // so it is their digest; a function is named by identity, in this page only, so their content is hashed, once a key.
  const callable = brushKey.callable || geometryKey.callable;
  const identity = (marks: string) => (callable ? { content: `${key}\n${marks}` } : { inputs: `${key}\n${marks}` });
  registerStampCanonicalList(placement.stamps, identity('stamps'));
  registerStampCanonicalList(placement.dualStamps, identity('duals'));
  kept.set(key, placement, bytesOf(placement, key));
  return placement;
}

/**
 * `placement` frozen, through every stamp and a flood's barrier, its outline and load copied from the caller's
 * region and field.
 */
function frozenPlacement(placement: StampDepositMarks<PlacedStamp[]>): StampDepositPlacement {
  const stamps = stampFrozenMarks(placement.stamps), dualStamps = stampFrozenMarks(placement.dualStamps);
  if (placement.kind !== 'flood') return Object.freeze({ kind: placement.kind, stamps, dualStamps });
  const { flood } = placement, { load } = flood, polygon = frozenPoints(flood.barrier.polygon);
  const area = (owned: CompiledStampArea) => Object.freeze({ ...owned, polygon, ...(owned.edge && { edge: Object.freeze({ ...owned.edge }) }) });
  const owned = Object.freeze({
    ...flood,
    edge: Object.freeze({ ...flood.edge }),
    barrier: area(flood.barrier),
    load: Object.freeze(ownedLoad(load)),
    scale: Object.freeze({ ...flood.scale }),
  });
  return Object.freeze({ kind: 'flood', flood: owned, stamps, dualStamps });
}

/** A frozen copy of `points`. */
const frozenPoints = (points: readonly StampPoint[]) => Object.freeze(points.map(({ x, y }) => Object.freeze({ x, y })));

/** A copy of the caller's `load`, its points frozen with it. */
function ownedLoad(load: StampSeededPaintField<number>): StampSeededPaintField<number> {
  if (load.kind === 'constant' || load.kind === 'noise') return { ...load };
  if (load.kind === 'linear') return { ...load, from: Object.freeze({ ...load.from }), to: Object.freeze({ ...load.to }) };
  return { ...load, center: Object.freeze({ ...load.center }) };
}

function placeNow(geometry: StampPlacingGeometry, brush: StampBrush, diameter: number, seed: string): StampDepositMarks<PlacedStamp[]> {
  if (geometry.kind === 'fill') {
    const { region, application, direction = 0, load } = geometry;
    if (application.kind === 'flood') {
      const polygon = stampRegionPolygon(region), edge = stampFloodEdgeOf(application), barrier = stampFloodBarrier(polygon, edge, seed);
      const past = stampFloodLaidPast(barrier), laid = past > 0 ? { kind: 'polygon' as const, points: stampGrownPolygon(polygon, past) } : region;
      const { scale, stamps, dualStamps } = placeStampFlood(laid, brush, diameter, direction, seed);
      const flood = { edge, barrier, scale, load };
      return { kind: 'flood', flood, stamps, dualStamps };
    }
    const offset = stampBrushEdgeOffsetMean(stampBrushMeasuredProfile(brush), diameter, brush.name);
    const strokes = stampFillStrokePath(region, { diameter, offset, edge: stampBrushFillEdge(brush, diameter) }, direction, application, seed);
    const place = (stamping: StampPlacementBrush, scale: number, placing: string) => (strokes.length ? placeStrokeStamps(strokes, stamping, diameter * scale, placing) : []);
    const stamps = place(brush, 1, seed);
    for (const stamp of stamps) stamp.opacity *= stampPaintFieldAt(load, stamp.x, stamp.y);
    return { kind: 'stroke', stamps, dualStamps: brush.dual ? place(brush.dual, brush.dual.scale, `${seed}|dual`) : [] };
  }
  const { stamps, dualStamps } = stampMarkStamps({ brush, diameter, geometry }, seed);
  return { kind: geometry.kind, stamps, dualStamps };
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
 * identity, and -0 and the non-finite numbers by name, where JSON would fold them into 0 and null; and whether it held
 * a function.
 */
function stampContentKey(value: StampInputField): { readonly text: string; readonly callable: boolean } {
  let callable = false;
  const text = JSON.stringify(value, (_name, field: StampInputField) => {
    if (isStampPressureCurve(field)) {
      callable = true;
      let id = functionIds.get(field);
      if (id === undefined) functionIds.set(field, (id = nextFunctionId++));
      return `ƒ${id}`;
    }
    return isMisreadNumber(field) ? `#${Object.is(field, -0) ? '-0' : field}` : field;
  });
  return { text, callable };
}

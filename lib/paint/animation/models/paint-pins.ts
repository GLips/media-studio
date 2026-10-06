// paint-pins.ts: the handles a pose moves. A pin is compiled once into the geometry its weight is read from, every
// default resolved, and the canonical text of that geometry, which every key naming a bend by this pin carries, so two
// pins of one text weigh paint alike. How a moved pin bends paint is paint-deform.ts's.

import { stampDistanceGrid, stampGridAt, stampPolygonBox, stampRegionPolygon, type StampPoint, type StampRegion } from '#lib/paint/painting/models/stamp-region.ts';

/**
 * A pin whose paint within `reach` px of `at` follows it, all of it at `at`, falling smoothly to none at `reach`. It
 * folds space past a scale of about 2.4, or a move of about two thirds of its reach.
 */
export type PaintRadialPin = { readonly at: StampPoint; readonly reach: number };
/**
 * A pin owning `part` (a region of rest space): paint inside follows it wholly, turning and scaling about `at` (its
 * centroid when left out); paint outside less with distance (PART_TAIL_POWER), to none `feather` px out (four times
 * the part's radius when left out: the frog's sac puffed 1.9 about its chin folds at three).
 */
export type PaintPartPin = { readonly part: StampRegion; readonly at?: StampPoint; readonly feather?: number };
export type PaintPin = PaintRadialPin | PaintPartPin;

/** A group's pins by name. */
export type PaintPinRig<P extends string> = Readonly<Record<P, PaintPin>>;

/**
 * A move from rest about a point (a pin, a node's pivot): `x`, `y` px, `rotation` radians and `scale` (2 = twice as
 * big) about it, a part left out at rest. A pin's and a node's placement alike.
 */
export type PaintPlacementMove = { readonly x?: number; readonly y?: number; readonly rotation?: number; readonly scale?: number };

/** A pin's geometry with every default resolved: what its weight is a function of, and nothing else. */
export type PaintPinGeometry =
  | { readonly kind: 'radial'; readonly at: StampPoint; readonly reach: number }
  | { readonly kind: 'part'; readonly outline: readonly StampPoint[]; readonly at: StampPoint; readonly feather: number };

/**
 * A pin made ready to weigh paint: its geometry, its canonical text (equal text, equal geometry), where it turns and
 * scales about, and how much of it follows the pin at a rest point.
 */
export type CompiledPaintPin = { readonly geometry: PaintPinGeometry; readonly text: string; readonly pivot: StampPoint; readonly weight: (rest: StampPoint) => number };

/** 1 at 0, easing to 0 at 1 and beyond. */
function smoothFalloff(u: number): number {
  if (u >= 1) return 0;
  return u <= 0 ? 1 : 1 - u * u * (3 - 2 * u);
}

/**
 * A part pin's weight outside its part is (e/r)^1.5: r from the pivot, e from the pivot to the edge. Scaling by s moves
 * paint at r by (s − 1)·r·weight, growing with r for any power under 2: no radial fold below s = 3.
 * The spike's 1/d² (power 2) folds a 1.9 puff once its tail is cut off.
 */
const PART_TAIL_POWER = 1.5;

/** How finely the distance to a part's edge is sampled, px. */
const PART_DISTANCE_CELL = 2;

function polygonCentroid(points: readonly StampPoint[]): { centroid: StampPoint; area: number } {
  let twiceArea = 0, cx = 0, cy = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length], cross = a.x * b.y - b.x * a.y;
    twiceArea += cross; cx += (a.x + b.x) * cross; cy += (a.y + b.y) * cross;
  });
  return { centroid: { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) }, area: Math.abs(twiceArea) / 2 };
}

/** Numbers as key text: String round-trips a double exactly, so equal text is equal numbers. */
export const paintKeyNumbers = (...values: readonly number[]) => values.map(String).join(',');
const pointText = (p: StampPoint) => paintKeyNumbers(p.x, p.y);

/** `pin` made ready: a part's distance to its edge sampled once, over its box grown by its feather. */
export function compilePaintPin(pin: PaintPin): CompiledPaintPin {
  if ('reach' in pin) {
    const { at, reach } = pin;
    return { geometry: { kind: 'radial', at, reach }, text: `radial(${pointText(at)};${reach})`, pivot: at, weight: (p) => smoothFalloff(Math.hypot(p.x - at.x, p.y - at.y) / reach) };
  }
  const outline = stampRegionPolygon(pin.part);
  const { centroid, area } = polygonCentroid(outline);
  const feather = pin.feather ?? 4 * Math.sqrt(area / Math.PI), pivot = pin.at ?? centroid;
  const box = stampPolygonBox(outline, feather + 2 * PART_DISTANCE_CELL);
  const inside = stampDistanceGrid(outline, box, PART_DISTANCE_CELL);
  return {
    geometry: { kind: 'part', outline, at: pivot, feather },
    text: `part(${pointText(pivot)};${feather};${outline.map(pointText).join(' ')})`,
    pivot,
    weight: (p) => {
      if (p.x < box.x0 || p.x > box.x1 || p.y < box.y0 || p.y > box.y1) return 0;
      const out = -stampGridAt(inside, p.x, p.y);
      if (out <= 0) return 1;
      const r = Math.hypot(p.x - pivot.x, p.y - pivot.y), edge = Math.max(r - out, 0);
      // A pivot outside its part, as a hinge can be, has no paint following at the pivot itself.
      return r > 0 ? (edge / r) ** PART_TAIL_POWER * smoothFalloff(out / feather) : 0;
    },
  };
}

/** Why `pin` can't weigh paint, or null. */
export function paintPinProblem(pin: PaintPin): string | null {
  if ('reach' in pin) return pin.reach > 0 && Number.isFinite(pin.at.x) && Number.isFinite(pin.at.y) ? null : `its reach is ${pin.reach} px; a radial pin needs a positive reach at a finite point`;
  if (pin.feather !== undefined && !(pin.feather > 0)) return `its feather is ${pin.feather} px, not positive`;
  return stampRegionPolygon(pin.part).length >= 3 ? null : 'its part has no area';
}

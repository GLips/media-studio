// paint-pins.ts: the handles a pose moves, and the bend they make of a group's rest space. Pins' displacements add,
// each its weight times its own move. Why not a normalised blend (stampWarpHandles): a part-owned pin must scale its
// part exactly, and a blend scales the sac by less wherever a breathing chest pin also reaches.
//
// No falloff rules out a fold for every move, so a pose is checked (paintWarpWorstFold), and a fold is an error
// naming its pin.

import type { StampGroupPlacement } from '#lib/paint/painting/models/stamp-group-motion.ts';
import { stampGroupSceneFromLayer } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { StampWarpMap } from '#lib/paint/painting/models/stamp-group-warp.ts';
import { stampDistanceGrid, stampGridAt, stampPolygonBox, stampRegionPolygon, type StampBox, type StampPoint, type StampRegion } from '#lib/paint/painting/models/stamp-region.ts';

/**
 * A pin whose paint within `reach` px of `at` follows it, all of it at `at`, falling smoothly to none at `reach`. It
 * folds space past a scale of about 2.4, or a move of about two thirds of its reach.
 */
export type PaintRadialPin = { at: StampPoint; reach: number };
/**
 * A pin owning `part` (a region of rest space): paint inside follows it wholly, turning and scaling about `at` (its
 * centroid when left out); paint outside less with distance (PART_TAIL_POWER), to none `feather` px out (four times
 * the part's radius when left out: the frog's sac puffed 1.9 about its chin folds at three).
 */
export type PaintPartPin = { part: StampRegion; at?: StampPoint; feather?: number };
export type PaintPin = PaintRadialPin | PaintPartPin;

/** A group's pins by name. */
export type PaintPinRig<P extends string> = Readonly<Record<P, PaintPin>>;

/** How a pin moves from rest: `x`, `y` px, `rotation` radians about the pin, `scale` about the pin (2 = twice as big). */
export type PaintPinMove = { x?: number; y?: number; rotation?: number; scale?: number };

/** A pin made ready to weigh paint: where it turns and scales about, and how much of it follows the pin at a rest point. */
export type CompiledPaintPin = { readonly pivot: StampPoint; readonly weight: (rest: StampPoint) => number };

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

/** `pin` made ready: a part's distance to its edge sampled once, over its box grown by its feather. */
export function compilePaintPin(pin: PaintPin): CompiledPaintPin {
  if ('reach' in pin) {
    const { at, reach } = pin;
    return { pivot: at, weight: (p) => smoothFalloff(Math.hypot(p.x - at.x, p.y - at.y) / reach) };
  }
  const polygon = stampRegionPolygon(pin.part);
  const { centroid, area } = polygonCentroid(polygon);
  const radius = Math.sqrt(area / Math.PI), feather = pin.feather ?? 4 * radius;
  const box = stampPolygonBox(polygon, feather + 2 * PART_DISTANCE_CELL);
  const inside = stampDistanceGrid(polygon, box, PART_DISTANCE_CELL);
  const pivot = pin.at ?? centroid;
  return {
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

/** Steps a pose's numbers are rounded to, so its key names its map exactly: 1/1000 px, a millionth of a radian and of scale. */
const PX_STEP = 1e-3, RATIO_STEP = 1e-6;
const rounded = (value: number, step: number) => Math.round(value / step) * step;

/** `move` whole and rounded to the steps its key is written in: the placement its map is built from. */
export function paintPinPlacement(move: PaintPinMove): StampGroupPlacement {
  return { x: rounded(move.x ?? 0, PX_STEP), y: rounded(move.y ?? 0, PX_STEP), rotation: rounded(move.rotation ?? 0, RATIO_STEP), scale: rounded(move.scale ?? 1, RATIO_STEP) };
}

export const paintPlacementIsRest = ({ x, y, rotation, scale }: StampGroupPlacement) => x === 0 && y === 0 && rotation === 0 && scale === 1;

/** A placement as key text: its rounded numbers in their steps, so equal text is equal numbers. */
export const paintPlacementKey = ({ x, y, rotation, scale }: StampGroupPlacement) =>
  `${Math.round(x / PX_STEP)},${Math.round(y / PX_STEP)},${Math.round(rotation / RATIO_STEP)},${Math.round(scale / RATIO_STEP)}`;

/**
 * The map moving each rest point by every moved pin, by its weight there: `moves` are placements from
 * paintPinPlacement. A pin at rest adds nothing, so leaving it out gives the same map.
 */
export function paintPinWarp(handles: readonly { pin: CompiledPaintPin; move: StampGroupPlacement }[]): StampWarpMap {
  return (rest) => {
    let x = rest.x, y = rest.y;
    for (const { pin, move } of handles) {
      const w = pin.weight(rest);
      if (w <= 0) continue;
      const moved = stampGroupSceneFromLayer(move, rest, pin.pivot);
      x += (moved.x - rest.x) * w;
      y += (moved.y - rest.y) * w;
    }
    return { x, y };
  };
}

/** How far each pin moves the paint at `rest`: px, by name, for naming the pin a fold comes from. */
export const paintPinShifts = (handles: readonly { name: string; pin: CompiledPaintPin; move: StampGroupPlacement }[], rest: StampPoint) =>
  handles.map(({ name, pin, move }) => {
    const moved = stampGroupSceneFromLayer(move, rest, pin.pivot);
    return { name, shift: Math.hypot(moved.x - rest.x, moved.y - rest.y) * pin.weight(rest) };
  });

/** Twice the signed area of triangle a, b, c. */
const doubledArea = (a: StampPoint, b: StampPoint, c: StampPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/**
 * Where `map` squeezes `box` most, over a lattice of `cell` px laid as the renderer lays it (two triangles a cell):
 * the rest point and the ratio of a triangle's area after to before. At or below 0 the map folds there: paint
 * passes over paint, and the lattice shows a seam.
 */
export function paintWarpWorstFold(map: StampWarpMap, box: StampBox, cell = 8): { at: StampPoint; det: number } {
  const columns = Math.max(1, Math.ceil((box.x1 - box.x0) / cell)), rows = Math.max(1, Math.ceil((box.y1 - box.y0) / cell));
  const dx = (box.x1 - box.x0) / columns, dy = (box.y1 - box.y0) / rows;
  const scene: StampPoint[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= columns; i++) scene.push(map({ x: box.x0 + i * dx, y: box.y0 + j * dy }));
  const node = (i: number, j: number) => scene[j * (columns + 1) + i];
  // Each rest triangle is half a cell, its doubled area dx·dy, and turns the same way as the scene's unfolded.
  let worst = { at: { x: box.x0, y: box.y0 }, det: Infinity };
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const a = node(i, j), b = node(i + 1, j), c = node(i, j + 1), d = node(i + 1, j + 1);
    const det = Math.min(doubledArea(a, b, c), doubledArea(b, d, c)) / (dx * dy);
    if (det < worst.det) worst = { at: { x: box.x0 + (i + 0.5) * dx, y: box.y0 + (j + 0.5) * dy }, det };
  }
  return worst;
}

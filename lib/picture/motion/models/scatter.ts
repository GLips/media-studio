// scatter.ts: things strewn over an area at least a spacing apart (stars, a crowd, trees on a hill), the same on
// every render. Coordinate-neutral: the caller's bounds and inside test say where, in frame or ground px alike.

import { seededRandom } from './random.ts';

/** Where a scatter may place: points of `bounds` for which `inside` holds (all of it when left out). */
export type SeededScatterArea = {
  bounds: { x0: number; y0: number; x1: number; y1: number };
  inside?: (x: number, y: number) => boolean;
};

/**
 * `count` items wanted, `spacing` the least distance between any two, `seed` the stream; `weight` (0..1, 1 when left
 * out) makes a place likelier where it's higher.
 */
export type SeededScatterOptions = SeededScatterArea & {
  count: number;
  spacing: number;
  seed: number | string;
  weight?: (x: number, y: number) => number;
};

/** A scattered item: `key` is its draw index, `r` a seeded value in [0, 1) for its own variation (size, tint). */
export type SeededScatterItem = { key: number; x: number; y: number; r: number };

/** Tries each item gets to find a free place before it's left out (Bridson's usual 30). */
export const SEEDED_SCATTER_ATTEMPTS = 30;

/**
 * Poisson-disc scatter by dart throwing in key order: item k draws from `${seed}|${k}` alone and is tested only
 * against earlier items, so raising `count` keeps every earlier item. An item that finds no free place in
 * SEEDED_SCATTER_ATTEMPTS tries is left out (its key skipped), so a spacing too wide for the area returns fewer.
 */
export function seededScatter({ bounds, inside, count, spacing, seed, weight }: SeededScatterOptions): SeededScatterItem[] {
  const { x0, y0, x1, y1 } = bounds;
  if (!(x1 > x0 && y1 > y0)) throw new Error(`seededScatter: bounds ${x0},${y0} to ${x1},${y1} hold no area`);
  if (!(spacing >= 0)) throw new Error(`seededScatter: a spacing of ${spacing}, and spacing runs from 0`);
  // Cells a spacing wide, so a near neighbour can only sit in the 3×3 cells around a candidate.
  const cell = spacing > 0 ? spacing : Infinity;
  const grid = new Map<string, SeededScatterItem[]>();
  const cellOf = (x: number, y: number, dx = 0, dy = 0) => `${Math.floor((x - x0) / cell) + dx},${Math.floor((y - y0) / cell) + dy}`;
  const free = (x: number, y: number) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const other of grid.get(cellOf(x, y, dx, dy)) ?? []) if (Math.hypot(other.x - x, other.y - y) < spacing) return false;
    return true;
  };

  const items: SeededScatterItem[] = [];
  for (let key = 0; key < count; key++) {
    const random = seededRandom(`${seed}|${key}`);
    // r first: an item keeps its variation when only where it may go changes.
    const r = random();
    for (let attempt = 0; attempt < SEEDED_SCATTER_ATTEMPTS; attempt++) {
      const x = x0 + (x1 - x0) * random(), y = y0 + (y1 - y0) * random(), chance = random();
      if ((inside && !inside(x, y)) || (weight && chance >= weight(x, y)) || !free(x, y)) continue;
      const item = { key, x, y, r };
      items.push(item);
      const at = cellOf(x, y);
      grid.set(at, [...(grid.get(at) ?? []), item]);
      break;
    }
  }
  return items;
}

// paint-figure-trace.ts: the back half every figure source shares. A source samples a signed field per part (positive
// inside) on a grid, and this turns it into drawn outlines: marching squares with crossings placed along each cell
// side (stampGridContours, so an outline is sub-pixel and as fine as the field, not stair-stepped), then
// Douglas–Peucker, then Chaikin rounds so a corner the grid cut reads drawn.
//
// Negative space: holes are dropped. A StampRegion is one loop, so a piece is its outer loop with any hole filled; a
// part seen through a hole is painted after, over it.

import { stampGridContours, stampRingArea, type StampGrid, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';

/** How a traced outline is cleaned: points within `tolerance` px of a straight run are dropped, then `smoothing` Chaikin rounds. */
export type PaintFigureTraceSettings = { readonly tolerance: number; readonly smoothing: number };

export const PAINT_FIGURE_TRACE_DEFAULTS: PaintFigureTraceSettings = { tolerance: 0.3, smoothing: 1 };

function simplifyRun(points: readonly StampPoint[], tolerance: number): StampPoint[] {
  if (points.length < 3) return [...points];
  const a = points[0], b = points[points.length - 1], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  let worst = -1, index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const off = length > 0 ? Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / length : Math.hypot(p.x - a.x, p.y - a.y);
    if (off > worst) { worst = off; index = i; }
  }
  if (worst <= tolerance) return [a, b];
  return [...simplifyRun(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplifyRun(points.slice(index), tolerance)];
}

/** Douglas–Peucker on a closed loop, split at the point farthest from its first so both halves are real runs. */
export function simplifyPaintFigureLoop(loop: readonly StampPoint[], tolerance: number): StampPoint[] {
  if (loop.length < 4) return [...loop];
  const first = loop[0];
  let far = 0;
  for (let i = 1; i < loop.length; i++) if (Math.hypot(loop[i].x - first.x, loop[i].y - first.y) > Math.hypot(loop[far].x - first.x, loop[far].y - first.y)) far = i;
  const out = simplifyRun(loop.slice(0, far + 1), tolerance), back = simplifyRun([...loop.slice(far), first], tolerance);
  return [...out.slice(0, -1), ...back.slice(0, -1)];
}

/** Chaikin corner cutting on a closed loop, `rounds` times: each round doubles the points and rounds every corner. */
export function smoothPaintFigureLoop(loop: readonly StampPoint[], rounds: number): StampPoint[] {
  let points = [...loop];
  for (let round = 0; round < rounds; round++) {
    points = points.flatMap((p, i) => {
      const q = points[(i + 1) % points.length];
      return [{ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y }, { x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y }];
    });
  }
  return points;
}

/** `grid` cut to the cells round where it is above 0, a sample of border kept below 0; undefined when nothing is. */
function cropToInside(grid: StampGrid): StampGrid | undefined {
  let i0 = grid.columns, i1 = -1, j0 = grid.rows, j1 = -1;
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.columns; i++) {
      if (grid.values[j * grid.columns + i] <= 0) continue;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
    }
  }
  if (i1 < 0) return undefined;
  i0 = Math.max(0, i0 - 1); j0 = Math.max(0, j0 - 1); i1 = Math.min(grid.columns - 1, i1 + 1); j1 = Math.min(grid.rows - 1, j1 + 1);
  const columns = i1 - i0 + 1, rows = j1 - j0 + 1, values = new Float32Array(columns * rows);
  for (let j = 0; j < rows; j++) values.set(grid.values.subarray((j0 + j) * grid.columns + i0, (j0 + j) * grid.columns + i1 + 1), j * columns);
  return { x0: grid.x0 + i0 * grid.cell, y0: grid.y0 + j0 * grid.cell, cell: grid.cell, columns, rows, values };
}

/**
 * The separate pieces where `grid` is above 0, largest first, each its outer loop simplified and smoothed. The grid's
 * border must lie below 0 (sources pad their grids), or a piece touching it comes back open and is dropped.
 */
export function tracePaintFigurePieces(grid: StampGrid, settings: PaintFigureTraceSettings = PAINT_FIGURE_TRACE_DEFAULTS): StampPoint[][] {
  const cropped = cropToInside(grid);
  if (!cropped) return [];
  // Specks under a cell across are the grid's noise, not a shape anyone drew.
  const smallest = grid.cell * grid.cell;
  return stampGridContours(cropped, 0)
    // An outer loop's area is positive as stampGridContours walks it; a hole's is negative, and dropped here.
    .map((loop) => ({ loop, area: stampRingArea(loop) }))
    .filter(({ area }) => area > smallest)
    .toSorted((a, b) => b.area - a.area)
    .map(({ loop }) => smoothPaintFigureLoop(simplifyPaintFigureLoop(loop, settings.tolerance), settings.smoothing));
}

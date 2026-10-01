// photoshop-stroke-pressure.ts: the pressure Photoshop paints a stroked path at, which a script can't set point by
// point: none, one pressure throughout (a Brush Pose), or simulated pressure. The rig paints every mark one of these
// ways (photoshop-capture-plan.ts), and whatever paints beside a capture reads it from here.

import type { StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';

/**
 * Simulated pressure climbs straight from 0 at each end to full at the middle, read at this many even pieces of each
 * anchor-to-anchor segment. So a two-anchor line peaks at 50/51 (0.98), while the rig's S-curve, 115 short segments,
 * all but reaches full (0.996–0.998). Fitted from the line's peak alone; docs/photoshop-capture.md has the probes.
 */
const SIMULATED_PRESSURE_PIECES = 51;

/** Photoshop's simulated pressure, before it's read at pieces, at share `t` (0..1) of a stroked path's length. */
const simulatedPressureAt = (t: number) => Math.max(0, Math.min(1, 2 * Math.min(t, 1 - t)));

/**
 * How the pen drives a stroked path: `posed` at one pressure, `simulated`, or neither, when Photoshop paints it at
 * pressure 0 (a brush whose size follows pressure leaves next to nothing).
 */
export type PhotoshopStrokePressure = { kind: 'posed'; pressure: number } | { kind: 'simulated' } | { kind: 'none' };

/**
 * `points` with the pressure Photoshop paints each at. Simulated pressure is straight but for its turn at the middle,
 * so only the segment holding the middle gains points: the ends of the piece it falls in, where the reading turns.
 */
export function photoshopPressuredPath(points: readonly (readonly [number, number])[], pressure: PhotoshopStrokePressure): StampStrokePoint[] {
  if (pressure.kind !== 'simulated') {
    const at = pressure.kind === 'posed' ? pressure.pressure : 0;
    return points.map(([x, y]) => ({ x, y, pressure: at }));
  }
  const arcs = points.map(() => 0);
  for (let i = 1; i < points.length; i++) arcs[i] = arcs[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  const length = arcs.at(-1) ?? 0;
  if (length === 0) return points.map(([x, y]) => ({ x, y, pressure: 0 }));
  const middle = length / 2;
  const path: StampStrokePoint[] = [];
  points.forEach(([x, y], i) => {
    if (i > 0 && arcs[i - 1] < middle && middle < arcs[i]) {
      const [px, py] = points[i - 1], share = (middle - arcs[i - 1]) / (arcs[i] - arcs[i - 1]);
      const piece = Math.floor(share * SIMULATED_PRESSURE_PIECES);
      for (const k of [piece / SIMULATED_PRESSURE_PIECES, Math.min(piece + 1, SIMULATED_PRESSURE_PIECES) / SIMULATED_PRESSURE_PIECES]) {
        if (k <= 0 || k >= 1) continue;
        path.push({ x: px + (x - px) * k, y: py + (y - py) * k, pressure: simulatedPressureAt((arcs[i - 1] + (arcs[i] - arcs[i - 1]) * k) / length) });
      }
    }
    path.push({ x, y, pressure: simulatedPressureAt(arcs[i] / length) });
  });
  return path;
}

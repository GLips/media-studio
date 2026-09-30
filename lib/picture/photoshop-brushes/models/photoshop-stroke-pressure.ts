// photoshop-stroke-pressure.ts: the pressure Photoshop paints a stroked path at, which a script can't set point by
// point: none, one pressure throughout (a Brush Pose), or simulated pressure. The rig paints every mark one of these
// ways (photoshop-capture-plan.ts), and whatever paints beside a capture reads it from here.

import type { StampStrokePoint } from '#lib/picture/stamp-paint/models/stamp-placement.ts';

/** The share of the path over which simulated pressure rises from 0 to full, and falls again at the end. */
const SIMULATED_PRESSURE_RAMP = 0.46;

/**
 * Simulated pressure's height, just short of full: opacity on pen pressure peaks at 0.98 along it, and count 4 on pen
 * pressure keeps at most 3 stamps a step and count 2 one, where a Brush Pose at 1 reaches 1 and keeps them all
 * (vid-97's pressure and count probes).
 */
const SIMULATED_PRESSURE_PEAK = 0.98;

/** Photoshop's simulated pressure at share `t` (0..1) of a stroked path's length. */
export const photoshopSimulatedPressure = (t: number) => SIMULATED_PRESSURE_PEAK * Math.max(0, Math.min(1, Math.min(t, 1 - t) / SIMULATED_PRESSURE_RAMP));

/**
 * How the pen drives a stroked path: `posed` at one pressure, `simulated`, or neither, when Photoshop paints it at
 * pressure 0 (a brush whose size follows pressure leaves next to nothing).
 */
export type PhotoshopStrokePressure = { kind: 'posed'; pressure: number } | { kind: 'simulated' } | { kind: 'none' };

/**
 * `points` with the pressure Photoshop paints each at. Simulated pressure is set by share of the path's length, with a
 * point added where its ramps turn, so a stroke that reads pressure between points (a two-point line) reads it whole.
 */
export function photoshopPressuredPath(points: readonly (readonly [number, number])[], pressure: PhotoshopStrokePressure): StampStrokePoint[] {
  if (pressure.kind !== 'simulated') {
    const at = pressure.kind === 'posed' ? pressure.pressure : 0;
    return points.map(([x, y]) => ({ x, y, pressure: at }));
  }
  const arcs = points.map(() => 0);
  for (let i = 1; i < points.length; i++) arcs[i] = arcs[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  const length = arcs.at(-1) ?? 0;
  if (length === 0) return points.map(([x, y]) => ({ x, y, pressure: photoshopSimulatedPressure(0) }));
  const knees = [SIMULATED_PRESSURE_RAMP, 1 - SIMULATED_PRESSURE_RAMP].map((t) => t * length);
  const path: StampStrokePoint[] = [];
  points.forEach(([x, y], i) => {
    if (i > 0) {
      for (const arc of knees.filter((k) => k > arcs[i - 1] && k < arcs[i])) {
        const k = (arc - arcs[i - 1]) / (arcs[i] - arcs[i - 1]), [px, py] = points[i - 1];
        path.push({ x: px + (x - px) * k, y: py + (y - py) * k, pressure: photoshopSimulatedPressure(arc / length) });
      }
    }
    path.push({ x, y, pressure: photoshopSimulatedPressure(arcs[i] / length) });
  });
  return path;
}

// photoshop-reference-stroke.ts: a brush painted as the Photoshop rig paints its reference S-curve (vid-100), so the
// brush fidelity sheet sets like beside like: the rig's own polyline, in the Procreate preview's frame the reference is
// cropped to, under Photoshop's simulated pressure, at the reference's diameter.
//
// Simulated pressure, from vid-97's pressure probes and references: it rises straight from 0 at the path's start,
// holds just short of full over its middle and falls straight to 0 at its end, by the share of the path's length (a
// line and the S-curve agree by share, not by pixel). It drives the brush's pen-pressure dynamics, count included, as
// a pen would: a brush with none paints it untapered. How the pen drove the brush there (a pose's overrides lingering
// from a posed line before it) is the stroke's PhotoshopPressureContext, which the brush is read under.

import { photoshopMarkStrokes, type PhotoshopBox } from '#lib/picture/photoshop-brushes/models/photoshop-capture-plan.ts';
import { PROCREATE_PREVIEW_SIZE } from '#lib/picture/procreate-brushes/models/procreate-preview-stroke.ts';
import type { PhotoshopPressureContext } from '#lib/picture/photoshop-brushes/models/photoshop-brush.ts';
import type { StampBrush } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type CompiledStampPaint } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import type { StampStrokePoint } from '#lib/picture/stamp-paint/models/stamp-placement.ts';

/**
 * Where a brush's S-curve sits among a pack's reference sheets, its diameter in the preview's pixels once cropped, and
 * how the pen drove the brush as Photoshop painted it: a Brush Pose's overrides linger when it's after a posed cell of
 * the same brush on the same sheet; applying a brush, as the rig does for each sheet, clears them (vid-97's pressure
 * check).
 */
export type PhotoshopReferenceStroke = { sheet: string; box: PhotoshopBox; diameter: number; pressure: PhotoshopPressureContext };

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

/** The rig's S-curve in the preview's pixels, each point carrying the simulated pressure at its share of the length. */
export function photoshopReferenceStrokePath(): StampStrokePoint[] {
  const [points] = photoshopMarkStrokes('sCurve', { x: 0, y: 0, ...PROCREATE_PREVIEW_SIZE }, 0);
  const arcs = points.map(() => 0);
  for (let i = 1; i < points.length; i++) arcs[i] = arcs[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  const length = arcs.at(-1)!;
  return points.map(([x, y], i) => ({ x, y, pressure: photoshopSimulatedPressure(arcs[i] / length) }));
}

/**
 * `brush` painted along the rig's S-curve at `diameter` (in the preview's pixels), in black, under simulated pressure:
 * the brush as read under its reference stroke's `pressure`. A full glaze, as procreatePreviewPainting, so the
 * painting's darkness is its coverage.
 */
export function photoshopReferencePainting(brush: StampBrush, diameter: number): CompiledStampPaint {
  const material = { kind: 'flat', color: '#000000' } as const;
  return compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('reference', { composite: 'glaze', opacity: 1 }, (group) => group.pass('stroke', {}, (pass) => {
    pass.stroke('stroke', { brush, material, diameter, path: photoshopReferenceStrokePath() });
  }))));
}

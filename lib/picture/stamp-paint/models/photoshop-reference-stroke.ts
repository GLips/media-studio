// photoshop-reference-stroke.ts: a brush painted as the Photoshop rig paints its reference S-curve (vid-100), so the
// brush fidelity sheet sets like beside like: the rig's own polyline, in the Procreate preview's frame the reference is
// cropped to, under Photoshop's simulated pressure, at the reference's diameter.
//
// Simulated pressure, from vid-97's pressure probes and references: it rises straight from 0 at the path's start,
// holds full over its middle and falls straight to 0 at its end, by the share of the path's length (a line and the
// S-curve, 819 and 798 px, agree by share, not by pixel). It drives the brush's own pen-pressure dynamics, as a pen
// would: a brush with none paints it untapered. But the rig paints most S-curves just after a line under a Brush Pose,
// and the pose's overrides outlast it: size and opacity then follow the pressure wholly, whatever the brush's dynamics.
//
// Negative space: under the overrides, a size minimum on pen pressure counts once more (m + (1 − m)(m + (1 − m)p)
// fits the probes); here it counts not at all, as a stroke carries one pressure for every response.

import { photoshopMarkStrokes } from '#lib/picture/photoshop-capture/models/photoshop-capture-plan.ts';
import { PROCREATE_PREVIEW_SIZE } from './procreate-preview-stroke.ts';
import type { StampBrush } from './stamp-brush.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type CompiledStampPaint } from './stamp-paint-recipe.ts';
import type { StampStrokePoint } from './stamp-placement.ts';

/** The share of the path over which simulated pressure rises from 0 to full, and falls again at the end. */
const SIMULATED_PRESSURE_RAMP = 0.46;

/** Photoshop's simulated pressure at share `t` (0..1) of a stroked path's length. */
export const photoshopSimulatedPressure = (t: number) => Math.max(0, Math.min(1, Math.min(t, 1 - t) / SIMULATED_PRESSURE_RAMP));

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
 * through the brush's own dynamics, or with size and opacity following it wholly under a pose's `poseOverrides`. A full
 * glaze, as procreatePreviewPainting, so the painting's darkness is its coverage.
 */
export function photoshopReferencePainting(brush: StampBrush, diameter: number, poseOverrides: boolean): CompiledStampPaint {
  const painted: StampBrush = poseOverrides ? { ...brush, pressure: { ...brush.pressure, size: 1, opacity: 1 } } : brush;
  const material = { kind: 'flat', color: '#000000' } as const;
  return compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('reference', { composite: 'glaze', opacity: 1 }, (group) => group.pass('stroke', {}, (pass) => {
    pass.stroke('stroke', { brush: painted, material, diameter, path: photoshopReferenceStrokePath() });
  }))));
}

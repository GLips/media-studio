// photoshop-reference-stroke.ts: a brush painted as the Photoshop rig paints its reference S-curve, so the fidelity
// sheet sets like beside like: the rig's own polyline, in the Procreate preview's frame the reference is cropped to,
// under Photoshop's simulated pressure, at the reference's diameter.
//
// Simulated pressure (photoshop-stroke-pressure.ts) drives pen-pressure dynamics, count included, as a pen would; a
// brush with none paints untapered.

import { photoshopMarkStrokes, type PhotoshopBox } from '#lib/picture/photoshop-brushes/models/photoshop-capture-plan.ts';
import { PROCREATE_PREVIEW_SIZE } from '#lib/picture/procreate-brushes/models/procreate-preview-stroke.ts';
import type { PhotoshopPressureContext } from '#lib/picture/photoshop-brushes/models/photoshop-brush.ts';
import { photoshopPressuredPath } from '#lib/picture/photoshop-brushes/models/photoshop-stroke-pressure.ts';
import type { StampBrush } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type CompiledStampPaint } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import type { StampStrokePoint } from '#lib/picture/stamp-paint/models/stamp-placement.ts';

/**
 * Where a brush's S-curve sits among a pack's reference sheets, its diameter in preview pixels once cropped, and how
 * the pen drove it: a Brush Pose's overrides linger after a posed cell of the same brush on the same sheet; applying a
 * brush, as the rig does per sheet, clears them.
 */
export type PhotoshopReferenceStroke = { sheet: string; box: PhotoshopBox; diameter: number; pressure: PhotoshopPressureContext };

/** The rig's S-curve in the preview's pixels, each point carrying the simulated pressure at its share of the length. */
export function photoshopReferenceStrokePath(): StampStrokePoint[] {
  const [points] = photoshopMarkStrokes('sCurve', { x: 0, y: 0, ...PROCREATE_PREVIEW_SIZE }, 0);
  return photoshopPressuredPath(points, { kind: 'simulated' });
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

// procreate-preview-painting.ts: a StampBrush painted as Procreate paints its library preview, along the preview's
// stroke (procreate-preview-stroke.ts), so the fidelity sheet measures the two alike.

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { compileStampPaintRecipe, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { PROCREATE_PREVIEW_SIZE, procreatePreviewStrokePath } from '#lib/paint/procreate-brushes/models/procreate-preview-stroke.ts';

/**
 * `brush` painted once along Procreate's preview stroke at `diameter`, in black, on a painting the preview's size; or,
 * for a brush Procreate previews as one stamp, a single stamp at the stroke's middle. A full glaze, so the painting's
 * darkness is the brush's coverage: an opaque group raises coverage to cover what's under it.
 */
export function procreatePreviewPainting(brush: StampBrush, diameter: number, preview: 'stroke' | 'stamp'): CompiledStampPaint {
  const material = { kind: 'color', color: '#000000' } as const;
  return compileStampPaintRecipe(stampPaintRecipe({ paper: { color: '#ffffff' }, mixing: { kind: 'flat' } }, (paint) => paint.group('preview', { composite: 'glaze', opacity: 1 }, (group) => group.passage('stroke', {}, (pass) => {
    if (preview === 'stamp') pass.stamps('stamp', { brush, well: { paint: material }, size: diameter, at: [{ x: PROCREATE_PREVIEW_SIZE.width / 2, y: PROCREATE_PREVIEW_SIZE.height / 2 }] });
    else pass.stroke('stroke', { brush, well: { paint: material }, size: diameter, path: procreatePreviewStrokePath() });
  }))));
}

// brush-fidelity-target.ts: what a brush is measured against, and how it's painted to be. A Procreate brush's target
// is its library preview, painted along the preview's stroke at the diameter whose thickness matches it; a Photoshop
// brush's is its reference capture, painted as the rig painted it at the reference's own diameter; a brush with
// neither is painted at its source's own size, unscored.

import { procreatePreviewPainting } from '#lib/picture/procreate-brushes/models/procreate-preview-stroke.ts';
import type { StampBrush } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import type { CompiledStampPaint } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import { photoshopReferencePainting, type PhotoshopForeignPaint, type PhotoshopReferenceStroke } from './photoshop-reference-stroke.ts';

/** `image` is the preview's file in its pack's folder. */
export type BrushFidelityTarget =
  | { kind: 'procreatePreview'; image: string; shows: 'stroke' | 'stamp' }
  | { kind: 'photoshopReference'; stroke: PhotoshopReferenceStroke }
  | { kind: 'none'; diameter: number };

/** A target there's an image of to measure: a preview or a reference. */
export type BrushFidelityMeasurableTarget = Exclude<BrushFidelityTarget, { kind: 'none' }>;

export const BRUSH_FIDELITY_TARGET_LABELS = { procreatePreview: 'Procreate preview', photoshopReference: 'Photoshop reference', none: 'no target' } as const;
export type BrushFidelityTargetLabel = (typeof BRUSH_FIDELITY_TARGET_LABELS)[BrushFidelityTarget['kind']];

/** What a brush that paints nothing scores against a target: as far off as the worst brushes the sheet has seen. */
export const BRUSH_FIDELITY_NOTHING_PAINTED = 2;

/** The diameter a preview's brush is first painted at, before it's fitted: about a mid-sized preview's thickness. */
const FIRST_PREVIEW_DIAMETER = 120;
/** The diameters a brush without a target may be painted at: its source's own, clamped to what the row shows whole. */
const UNTARGETED_DIAMETER = { min: 16, max: 240 };

/** The target of a brush with neither a preview nor a reference, at its source's `diameter` if it has one. */
export const untargetedBrushFidelity = (diameter: number | undefined): BrushFidelityTarget => ({
  kind: 'none',
  diameter: diameter ? Math.min(UNTARGETED_DIAMETER.max, Math.max(UNTARGETED_DIAMETER.min, diameter)) : FIRST_PREVIEW_DIAMETER,
});

/** The diameter a brush is painted at for `target`; a preview's is only where fitting its thickness starts. */
export function brushFidelityDiameter(target: BrushFidelityTarget): number {
  switch (target.kind) {
    case 'procreatePreview': return FIRST_PREVIEW_DIAMETER;
    case 'photoshopReference': return target.stroke.diameter;
    case 'none': return target.diameter;
  }
}

/** Other cells' paint that may lie in `target`'s frame, cleared from it and ours alike: a reference's alone. */
export const brushFidelityForeignPaint = (target: BrushFidelityTarget): PhotoshopForeignPaint =>
  (target.kind === 'photoshopReference' ? target.stroke.foreign : { strokes: [], ownCore: 0 });

/** Whether the diameter is fitted to the target's thickness: only a preview's, whose size Procreate doesn't say. */
export const brushFidelityFitsDiameter = (target: BrushFidelityTarget) => target.kind === 'procreatePreview';

/**
 * `brush` painted in black at `diameter` as `target` was: a full glaze, so the painting's darkness is its coverage.
 * `brush` is read as its app drove it for `target` (BrushReadingApp's `read`).
 */
export function brushFidelityPainting(brush: StampBrush, target: BrushFidelityTarget, diameter: number): CompiledStampPaint {
  switch (target.kind) {
    case 'photoshopReference': return photoshopReferencePainting(brush, diameter, target.stroke.opacity);
    case 'procreatePreview': return procreatePreviewPainting(brush, diameter, target.shows);
    case 'none': return procreatePreviewPainting(brush, diameter, 'stroke');
  }
}

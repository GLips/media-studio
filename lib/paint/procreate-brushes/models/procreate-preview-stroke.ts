// procreate-preview-stroke.ts: the stroke Procreate draws each brush's library preview with (QuickLook/Thumbnail.png,
// kept by the importer), so a StampBrush can be painted along the same stroke (procreate-preview-painting.ts in
// lib/paint/brush-fidelity/) and measured beside it.
//
// The path and its pressure were measured off Smooth Ink Pen's preview, whose size follows pressure one for one and
// which has no taper, so its thickness is its pressure. Every VVDS preview follows the same centreline.
//
// Negative space: a preview's size isn't modelled. Procreate sizes it by `previewSize` against the brush's own size
// range by a rule it doesn't document; the sheet fits the diameter to the preview's thickness instead.

import type { StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';

/** A Procreate brush preview's size, in pixels. */
export const PROCREATE_PREVIEW_SIZE = { width: 1060, height: 324 } as const;

/** [x, y, pressure] along the preview's stroke, left to right, in the preview's pixels. */
const PREVIEW_STROKE: readonly (readonly [number, number, number])[] = [
  [115, 183, 0.12], [150, 192, 0.16], [200, 200, 0.25], [250, 205, 0.34], [300, 207, 0.5], [350, 206, 0.69], [400, 202, 0.88],
  [450, 196, 0.93], [500, 188, 0.96], [550, 181, 1], [600, 173, 0.9], [650, 165, 0.8], [700, 158, 0.72], [750, 153, 0.53],
  [800, 151, 0.35], [850, 151, 0.24], [900, 155, 0.16], [935, 158, 0.12],
];

/** Procreate's preview stroke, with its pressure, in the preview's pixels. */
export const procreatePreviewStrokePath = (): StampStrokePoint[] => PREVIEW_STROKE.map(([x, y, pressure]) => ({ x, y, pressure }));

// picture-readback-span.ts: how a page traces sending a frame (studio/picture-root.tsx), so `studio profile`
// (lib/output/render/engine/frame-profiling.ts) can read the steps apart.

/** The kind of a frame's readback span, whose `frame` names the frame. */
export const PICTURE_READBACK_SPAN_KIND = 'picture-readback';

/**
 * Its steps, each's ms a quantity on the span, in order: settle waits out the frame's other holds (its drawing), paint
 * waits for the canvas's paint event, read draws the page into the canvas and reads it back, send posts it to Node.
 */
export const PICTURE_READBACK_STEPS = ['settle', 'paint', 'read', 'send'] as const;

export type PictureReadbackStep = (typeof PICTURE_READBACK_STEPS)[number];

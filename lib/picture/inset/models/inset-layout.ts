// inset-layout.ts: where an inset picture sits as it moves between filling the frame and its place in a corner: a
// speaker full-frame who shrinks into a bubble over their screen, and grows back. Pure geometry, so a scene can
// time the move however it likes and a still can freeze any point of it.
import type { FrameSize } from '#lib/picture/frame/models/frame.ts';
import type { Rect } from '#lib/picture/frame/models/geometry.ts';
import { lerp } from '#lib/picture/motion/models/motion.ts';

export type InsetCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** An inset's resting place: its corner, its size (width) and margin in frame pixels, and its height over width. */
export type InsetPlacement = { corner: InsetCorner; size: number; margin: number; aspect: number; shape: 'circle' | 'rounded' };

export const DEFAULT_INSET_PLACEMENT: InsetPlacement = { corner: 'bottom-right', size: 300, margin: 48, aspect: 1, shape: 'circle' };

/** The inset's box and its corner radius at `k`: 0 fills the frame, square-cornered; 1 rests in its corner. */
export function insetBoxAt(frame: FrameSize, placement: InsetPlacement, k: number): Rect & { radius: number } {
  const { corner, size, margin, aspect, shape } = placement, h = size * aspect;
  const x = corner.endsWith('left') ? margin : frame.width - margin - size;
  const y = corner.startsWith('top') ? margin : frame.height - margin - h;
  const rest = shape === 'circle' ? Math.min(size, h) / 2 : Math.min(size, h) * 0.12;
  return { x: lerp(0, x, k), y: lerp(0, y, k), w: lerp(frame.width, size, k), h: lerp(frame.height, h, k), radius: lerp(0, rest, k) };
}

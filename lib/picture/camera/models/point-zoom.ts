// point-zoom.ts: a picture zoomed in on a point of it, in a box: the picture covers the box at zoom 1, and at any zoom
// the point sits as near the box's centre as the picture's edges allow, so the box never shows past them.
import type { Point } from '#lib/picture/frame/models/geometry.ts';
import { clamp } from '#lib/picture/motion/models/motion.ts';

/** Box pixels per picture pixel, and where the picture's top left lands in the box. */
export type PointZoom = { scale: number; x: number; y: number };

type Size = { w: number; h: number };

/** `picture` (its pixel size) in `box`, zoomed `zoom` times past covering it, aimed at `focus` (picture pixels). */
export function pointZoomOf(picture: Size, box: Size, focus: Point, zoom: number): PointZoom {
  const scale = Math.max(box.w / picture.w, box.h / picture.h) * Math.max(1, zoom);
  const x = clamp(box.w / 2 - focus.x * scale, box.w - picture.w * scale, 0);
  const y = clamp(box.h / 2 - focus.y * scale, box.h - picture.h * scale, 0);
  return { scale, x, y };
}

// geometry.ts: points, rects and 2D affine transforms, the plain shapes every picture, camera and measurement lays
// out in. Pure; a camera's view over a capture is lib/picture/camera/models/camera.ts.

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export const centerOf = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const union = (...rects: Rect[]): Rect => {
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
};
/** A rect grown by `pad` on every side. */
export const inflate = (r: Rect, pad: number): Rect => ({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 });

/** A 2D affine transform in SVG's `matrix(a b c d e f)` order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type AffineMatrix = [number, number, number, number, number, number];
/** `m` after `n`: the one transform that applies `n`, then `m`. */
export const multiplyAffine = ([a, b, c, d, e, f]: AffineMatrix, [g, h, i, j, k, l]: AffineMatrix): AffineMatrix =>
  [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
export const applyAffine = ([a, b, c, d, e, f]: AffineMatrix, p: Point): Point => ({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f });

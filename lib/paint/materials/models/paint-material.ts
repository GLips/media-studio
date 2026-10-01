// paint-material.ts: what a deposit is made of, as a painting names it: a flat colour, or pigments mixed in
// proportion (paint-mixture.ts). A colour is an sRGB hex, the one way a painting, a pack's palette and a paper name one.

import type { PaintMixture } from './paint-mixture.ts';

export type StampPaintColor = `#${string}`;

/**
 * What a deposit is made of. A `color` is flat colour, laid by its blend as Photoshop lays it; in a style that paints
 * in pigment it's fitted as a pigment of its own. A `mixture` is pigments in proportion at a strength
 * (paint-mixture.ts), which only a style that paints in pigment can lay.
 */
export type PaintMaterial = { kind: 'color'; color: StampPaintColor } | ({ kind: 'mixture' } & PaintMixture);

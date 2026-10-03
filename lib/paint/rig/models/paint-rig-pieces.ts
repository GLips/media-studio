// paint-rig-pieces.ts: what a posed rig is drawn from, purely: pieces, each a premultiplied picture through posed
// triangles (a layer's skin group through its mesh, a part's cel through its lattice). The GPU draws them
// (paint-rig-piece-meshes.ts) in order, each over those before it; the posing is the CPU's, done once for the
// renderer and the measures alike.

import type { StampWarpMap } from '#lib/paint/painting/models/stamp-group-warp.ts';
import type { PaintRigCutLayer, PaintRigTexelBox } from './paint-rig-cuts.ts';
import type { PaintRigSkinGroup } from './paint-rig-skin.ts';

/**
 * Premultiplied linear-light RGBA (alpha = coverage) over `w` × `h` texels, texel (i, j) centred on plane point
 * (x0 + i + ½, y0 + j + ½), x0 and y0 whole. Premultiplied, so a bilinear read never fringes a matte's edge.
 */
export type PaintRigPicture = { readonly x0: number; readonly y0: number; readonly w: number; readonly h: number; readonly rgba: Float32Array };

/**
 * A picture drawn through `triangles`: three vertices each of (posed x, posed y, rest x, rest y), plane px, the
 * layout paintRigSkinTriangles writes. A piece keeps its vertices in one order from moment to moment, so a vertex's
 * motion over the shutter is its own.
 */
export type PaintRigPiece = { readonly picture: PaintRigPicture; readonly triangles: Float32Array };

/** A part's lattice's spacing, px: a cel is drawn through cells this size, enough for a bend to curve. */
export const PAINT_RIG_LATTICE_CELL = 16;

/**
 * The lattice over `box` (a cel's, plane px) mapped by `map`, two triangles a cell, row by row: always in this order,
 * unlike a painting's warp (stampWarpTriangles), which reorders its cells as they move.
 */
export function paintRigLatticeTriangles(map: StampWarpMap, { x0, y0, w, h }: PaintRigTexelBox, cell = PAINT_RIG_LATTICE_CELL): Float32Array {
  const columns = Math.max(1, Math.ceil(w / cell)), rows = Math.max(1, Math.ceil(h / cell));
  const nodes: { x: number; y: number; rx: number; ry: number }[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= columns; i++) {
    const rest = { x: x0 + (w * i) / columns, y: y0 + (h * j) / rows }, posed = map(rest);
    nodes.push({ x: posed.x, y: posed.y, rx: rest.x, ry: rest.y });
  }
  const out = new Float32Array(columns * rows * 24), node = (i: number, j: number) => nodes[j * (columns + 1) + i];
  let at = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    for (const { x, y, rx, ry } of [node(i, j), node(i + 1, j), node(i, j + 1), node(i + 1, j), node(i + 1, j + 1), node(i, j + 1)]) {
      out.set([x, y, rx, ry], at);
      at += 4;
    }
  }
  return out;
}

/**
 * `picture`'s texels (a layer's, on the same whole-px lattice as its cuts) that `group` moves and whose part `shows`,
 * over the cuts' box with a clear texel round it so a bilinear read fades to nothing at its edge.
 */
export function paintRigSkinGroupPicture(picture: PaintRigPicture, cuts: PaintRigCutLayer, group: PaintRigSkinGroup, shows: (part: number) => boolean): PaintRigPicture {
  const { box } = cuts, w = box.w + 2, h = box.h + 2, rgba = new Float32Array(w * h * 4);
  for (let j = 0; j < box.h; j++) {
    const row = box.y0 + j - picture.y0;
    if (row < 0 || row >= picture.h) continue;
    for (let i = 0; i < box.w; i++) {
      const mover = group.mover[j * box.w + i], column = box.x0 + i - picture.x0;
      if (mover < 0 || !shows(mover) || column < 0 || column >= picture.w) continue;
      const from = 4 * (row * picture.w + column);
      rgba.set(picture.rgba.subarray(from, from + 4), 4 * ((j + 1) * w + i + 1));
    }
  }
  return { x0: box.x0 - 1, y0: box.y0 - 1, w, h, rgba };
}

/** The box of whole texels round where `pieces` are posed, a texel past each side; null for none. */
export function paintRigPiecesBox(pieces: readonly PaintRigPiece[]): { x0: number; y0: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { triangles } of pieces) for (let v = 0; v < triangles.length; v += 4) {
    x0 = Math.min(x0, triangles[v]); x1 = Math.max(x1, triangles[v]); y0 = Math.min(y0, triangles[v + 1]); y1 = Math.max(y1, triangles[v + 1]);
  }
  if (!(x1 >= x0)) return null;
  return { x0: Math.floor(x0) - 1, y0: Math.floor(y0) - 1, w: Math.ceil(x1) - Math.floor(x0) + 2, h: Math.ceil(y1) - Math.floor(y0) + 2 };
}

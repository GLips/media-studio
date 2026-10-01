// stamp-group-warp.ts: a group bent over its scene, its layer carried by a field. The group is painted once where it's
// painted (its rest space), and each frame a lattice over its painted box is mapped to where the field takes it; the
// renderer rasterises that mesh, so each scene pixel learns which rest point it shows, and resamples the layer there.
// Everything in the layer rides along: paint, its wet state, rims and blooms, masks, clips and reserves. A placement
// (stamp-group-motion.ts) is the one-cell case: an affine map needs no more. A warp arrives as frame data
// (stamp-paint-frame-state.ts), never inside the compiled painting.
//
// Negative space: the field is authored on the CPU; the GPU sees only a lattice.

import { stampGroupSceneFromLayer, type StampGroupPlacement } from './stamp-group-motion.ts';
import type { StampPoint } from './stamp-region.ts';

/** Where a point of a group's own layer (its rest space) lies in the scene. */
export type StampWarpMap = (rest: StampPoint) => StampPoint;

/** A warp lattice's spacing in px when its frame state names none: coarser where a box would need more than STAMP_WARP_MOST_CELLS. */
export const STAMP_WARP_CELL = 16;

/** The most cells a lattice has along a side, so a big group's lattice stays a few thousand triangles. */
export const STAMP_WARP_MOST_CELLS = 64;

/** A rigid placement about `pivot` as a map: the affine a one-cell lattice carries exactly. */
export const stampPlacementWarpMap = (placement: StampGroupPlacement, pivot?: StampPoint): StampWarpMap => (rest) => stampGroupSceneFromLayer(placement, rest, pivot);

/**
 * The lattice over `box` (rest pixels) with `columns` × `rows` cells, as triangles to rasterise: six vertices a cell,
 * each (scene x, scene y, rest x, rest y). Cells are drawn least moved first, so where the field folds the paint over
 * itself, what moved most lies on top: a raised arm over the shoulder it folds into.
 */
export function stampWarpTriangles(map: StampWarpMap, box: { x: number; y: number; w: number; h: number }, columns: number, rows: number): Float32Array {
  const nodes: { rest: StampPoint; scene: StampPoint }[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= columns; i++) {
    const rest = { x: box.x + (box.w * i) / columns, y: box.y + (box.h * j) / rows };
    nodes.push({ rest, scene: map(rest) });
  }
  const node = (i: number, j: number) => nodes[j * (columns + 1) + i];
  const cells: { corners: (typeof nodes)[number][]; moved: number }[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const corners = [node(i, j), node(i + 1, j), node(i, j + 1), node(i + 1, j + 1)];
    cells.push({ corners, moved: corners.reduce((sum, { rest, scene }) => sum + Math.hypot(scene.x - rest.x, scene.y - rest.y), 0) });
  }
  // A stable sort: a rigid lattice, every cell moved alike, keeps the order written.
  cells.sort((a, b) => a.moved - b.moved);
  const out = new Float32Array(cells.length * 24);
  cells.forEach(({ corners: [a, b, c, d] }, k) => [a, b, c, b, d, c].forEach(({ rest, scene }, v) => out.set([scene.x, scene.y, rest.x, rest.y], k * 24 + v * 4)));
  return out;
}

/** How many cells a lattice over `w` × `h` rest pixels has along each side at `cell` px apart: at least one, at most STAMP_WARP_MOST_CELLS. */
export const stampWarpCells = (w: number, h: number, cell: number) => ({
  columns: Math.min(STAMP_WARP_MOST_CELLS, Math.max(1, Math.ceil(w / cell))), rows: Math.min(STAMP_WARP_MOST_CELLS, Math.max(1, Math.ceil(h / cell))),
});

/**
 * A handle of a warp: a placement about `pivot`, weighted at each rest point by `weight` (0..1). Pins with falloff, a
 * limb about its joint, a sac about the edge it hangs from: each is a handle and its weight.
 */
export type StampWarpHandle = { placement: StampGroupPlacement; pivot: StampPoint; weight: (rest: StampPoint) => number };

/**
 * The map moving each rest point by its handles' moves, blended by weight (linear blend skinning), the rest of the way
 * held still. Weights summing past 1 at a point are scaled to 1 there.
 */
export function stampWarpHandles(handles: readonly StampWarpHandle[]): StampWarpMap {
  return (rest) => {
    const weights = handles.map(({ weight }) => Math.max(0, weight(rest)));
    const total = weights.reduce((a, b) => a + b, 0), scale = total > 1 ? 1 / total : 1;
    let x = rest.x, y = rest.y;
    handles.forEach(({ placement, pivot }, i) => {
      const moved = stampGroupSceneFromLayer(placement, rest, pivot), w = weights[i] * scale;
      x += (moved.x - rest.x) * w;
      y += (moved.y - rest.y) * w;
    });
    return { x, y };
  };
}

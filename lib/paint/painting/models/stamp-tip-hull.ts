// stamp-tip-hull.ts: the part of a tip's square a stamp needs to draw. Tips paint a third to half their square, and
// a frame's time goes on its pixels, so each stamp is drawn as a polygon around the tip's paint; every texel outside
// it is bare. The painting matches to rounding: interpolating from the polygon's corners moves a few pixels a level
// or two.
//
// A small stamp reads a coarse mip, whose paint has spread, bilinearly, reaching a texel further. So the polygon
// holds every level's paint up to the coarsest used, each texel grown by one. It reads the very bytes the GPU samples
// (stamp-tip-levels.ts): a texel holds paint where it isn't white.

import type { StampTipLevel, StampTipLevels } from '#lib/paint/brush/models/stamp-tip-levels.ts';

/** A convex polygon in the tip's UV square, counter-clockwise, as flat x, y pairs: at most STAMP_TIP_HULL_SIDES corners. */
export type StampTipHull = Float32Array;

/**
 * Sides of the polygon, facing evenly spaced directions. Eight: sixteen hug a round tip closer, but each corner is
 * shaded once a stamp, and on the landscape example they cost as much as they saved.
 */
export const STAMP_TIP_HULL_SIDES = 8;

/**
 * The polygon around the paint of `levels[0..coarsest]`, within the unit square. It's the tightest one whose sides
 * face STAMP_TIP_HULL_SIDES fixed directions (these include the square's own four, so it never leaves the square),
 * which is always convex and never smaller than the paint. A tip with no paint gets the whole square.
 */
export function stampTipHull(levels: StampTipLevels, coarsest: number): StampTipHull {
  const normals = Array.from({ length: STAMP_TIP_HULL_SIDES }, (_, i) => {
    const angle = (i / STAMP_TIP_HULL_SIDES) * 2 * Math.PI;
    return [Math.cos(angle), Math.sin(angle)] as const;
  });
  const reach = normals.map(() => -Infinity);
  const include = (x: number, y: number) => normals.forEach(([nx, ny], i) => { reach[i] = Math.max(reach[i], x * nx + y * ny); });
  for (const level of levels.slice(0, coarsest + 1)) {
    const clampX = (x: number) => Math.min(1, Math.max(0, x / level.width)), clampY = (y: number) => Math.min(1, Math.max(0, y / level.height));
    stampTipPaintRows(level).forEach((span, y) => {
      if (!span) return;
      // The texel's square, grown by a texel for the bilinear sample's reach, within the tip.
      for (const x of [clampX(span[0] - 1), clampX(span[1] + 2)]) for (const v of [clampY(y - 1), clampY(y + 2)]) include(x, v);
    });
  }
  if (reach[0] === -Infinity) return new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  // Each corner is where two neighbouring sides meet: every side touches the paint, so none is redundant.
  const corners = normals.map(([ax, ay], i): [number, number] => {
    const [bx, by] = normals[(i + 1) % STAMP_TIP_HULL_SIDES], det = ax * by - ay * bx;
    return [snapToSquare((reach[i] * by - reach[(i + 1) % STAMP_TIP_HULL_SIDES] * ay) / det), snapToSquare((ax * reach[(i + 1) % STAMP_TIP_HULL_SIDES] - bx * reach[i]) / det)];
  });
  return new Float32Array(strictlyConvex(corners).flat());
}

/** For each of `level`'s rows, the first and last texel holding any paint, or null for a bare row. */
function stampTipPaintRows({ width, height, texels }: StampTipLevel): ([number, number] | null)[] {
  return Array.from({ length: height }, (_, y): [number, number] | null => {
    let first = -1, last = -1;
    for (let x = 0, at = y * width; x < width; x++, at++) {
      if (texels[at] === 255) continue;
      if (first < 0) first = x;
      last = x;
    }
    return first < 0 ? null : [first, last];
  });
}

/**
 * The corners as the GPU gets them (32-bit), less any that repeat another or sit on the line between their
 * neighbours. Sides meeting at a corner of the paint give corners a rounding error apart, which could fold the
 * polygon, and a fan over a folded polygon covers a pixel twice: a build brush would lay there twice.
 */
function strictlyConvex(points: [number, number][]): [number, number][] {
  const sorted = points.map(([x, y]): [number, number] => [Math.fround(x), Math.fround(y)]).toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const chain = (ordered: [number, number][]) => ordered.reduce<[number, number][]>((kept, p) => {
    while (kept.length >= 2 && cross(kept[kept.length - 2], kept[kept.length - 1], p) <= 1e-9) kept.pop();
    kept.push(p);
    return kept;
  }, []);
  const lower = chain(sorted), upper = chain(sorted.toReversed());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * A corner a rounding error off the square's edge, put on it. Past the edge a stamp reads the tip's clamped edge
 * texels, painting where its square never reached. The renderer pushes a side exactly on it out by a sliver only
 * (STAMP_EDGE_SLIVER).
 */
const snapToSquare = (v: number) => (Math.abs(v) < 1e-5 ? 0 : Math.abs(v - 1) < 1e-5 ? 1 : v);

/**
 * The coarsest mip level a stamp `diameter` pixels across (squashed to `roundness` of it) samples of a tip `size`
 * texels across. At level of detail λ a trilinear sample reads levels ⌊λ⌋ and the one above; one more is kept for
 * however a GPU approximates λ.
 */
export function coarsestStampTipLevel(size: { width: number; height: number }, diameter: number, roundness: number, levels: number): number {
  const texelsPerPixel = Math.max(size.width / diameter, size.height / (diameter * Math.min(1, roundness)));
  return Math.min(levels - 1, Math.max(0, Math.floor(Math.log2(texelsPerPixel)) + 2));
}

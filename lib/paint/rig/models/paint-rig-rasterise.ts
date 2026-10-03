// paint-rig-rasterise.ts: posed triangles drawn on the CPU, as the bridge and the paint session draw a rig's pieces.
// A triangle is three vertices of (posed x, posed y, rest x, rest y), the layout paintRigSkinTriangles writes and a
// part's lattice shares; drawing one finds where in the rest picture each covered texel reads from.

import type { PaintRigTexelBox } from './paint-rig-cuts.ts';

/**
 * Each texel centre of `box` a triangle covers, marked in `hit` with its rest point in `rest`. Last triangle wins, so
 * a texel on a shared edge is drawn once, never twice over itself (which would show the lattice as seams).
 */
export function paintRigRasteriseTriangles(triangles: Float32Array, box: PaintRigTexelBox, rest: Float32Array, hit: Uint8Array): void {
  for (let v = 0; v < triangles.length; v += 12) {
    const ax = triangles[v], ay = triangles[v + 1], bx = triangles[v + 4], by = triangles[v + 5], cx = triangles[v + 8], cy = triangles[v + 9];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) continue;
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - box.x0 - 0.5)), i1 = Math.min(box.w - 1, Math.ceil(Math.max(ax, bx, cx) - box.x0 - 0.5));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - box.y0 - 0.5)), j1 = Math.min(box.h - 1, Math.ceil(Math.max(ay, by, cy) - box.y0 - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = box.x0 + i + 0.5, py = box.y0 + j + 0.5;
      const wa = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area, wb = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area, wc = 1 - wa - wb;
      if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
      const k = j * box.w + i;
      rest[2 * k] = wa * triangles[v + 2] + wb * triangles[v + 6] + wc * triangles[v + 10];
      rest[2 * k + 1] = wa * triangles[v + 3] + wb * triangles[v + 7] + wc * triangles[v + 11];
      hit[k] = 1;
    }
  }
}

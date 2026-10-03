// paint-rig-skin.ts: a layer's cut parts posed, purely. Parts joined by skin joints form one group, a triangle mesh
// of 6 px cells over their texels; each vertex's share in a skin joint's child ramps linearly over `blend` px across
// the joint line, and it is posed by rotation-blend skinning: it turns by its share of the joint's angle about the
// joint's rest pivot, so a bend is a circular arc that keeps the limb's width. A hinge child starts its own group, a
// rigid piece with its overlap, drawn above or below by z.
//
// A mesh is data a renderer can take whole: triangles over a vertex grid, and each vertex's share in each joint.

import type { StampWarpMap } from '#lib/paint/painting/models/stamp-group-warp.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { PaintRigCutLayer, PaintRigTexelBox } from './paint-rig-cuts.ts';

/** A skin mesh's cell, px. */
const SKIN_CELL = 6;

/**
 * Parts of a layer drawn as one mesh: `members` (indices into the layer's parts) joined by skin joints under `root`,
 * drawn at its `z`. `mover`: the member each texel moves with (-1 off the group; a hinge root's overlap moves with
 * it); `cover`: the group's picture's coverage of the layer.
 */
export type PaintRigSkinGroup = {
  readonly root: number; readonly members: readonly number[]; readonly z: number; readonly mover: Int16Array; readonly cover: Float32Array;
};

/** A skin joint of a group: its `child` and `parent` (indices into the layer's parts) and the child's rest pivot. */
export type PaintRigSkinJoint = { readonly child: number; readonly parent: number; readonly pivot: StampPoint };

/**
 * A group's mesh at rest: a vertex grid of `cell` px from the layer box's corner, its triangles (three vertex indices
 * each), the group's `root` and skin `joints` (each after its parent's own), each vertex's share in each joint's child
 * (`joints.length` a vertex), and each joint's band, by child: the painted triangles with a vertex part-way across it.
 */
export type PaintRigSkinMesh = {
  readonly box: PaintRigTexelBox; readonly cell: number; readonly columns: number; readonly rows: number; readonly triangles: Uint32Array;
  readonly root: number; readonly joints: readonly PaintRigSkinJoint[]; readonly shares: Float32Array; readonly bands: ReadonlyMap<number, Uint32Array>;
};

/** The layer's groups, back to front by z (ties in the order their roots were cut). */
export function paintRigSkinGroups(layer: PaintRigCutLayer): PaintRigSkinGroup[] {
  const { parts, owner, matte, overlaps } = layer;
  const skinParent = (k: number) => {
    const { joint } = parts[k];
    return joint.kind === 'skin' ? joint.parent : undefined;
  };
  const rootOf = (k: number): number => {
    const up = skinParent(k);
    return up === undefined ? k : rootOf(up);
  };
  const roots = [...new Set(parts.map((_, k) => rootOf(k)))];
  return roots.map((root) => {
    const members = parts.flatMap((_, k) => (rootOf(k) === root ? [k] : []));
    const mover = new Int16Array(owner.length).fill(-1), cover = new Float32Array(owner.length), extra = overlaps.get(root);
    for (let t = 0; t < owner.length; t++) {
      if (owner[t] >= 0 && rootOf(owner[t]) === root) mover[t] = owner[t];
      else if (extra?.[t]) mover[t] = root;
      else continue;
      cover[t] = matte[t];
    }
    return { root, members, z: parts[root].z, mover, cover };
  }).toSorted((a, b) => a.z - b.z);
}

/** The nearest texel centre to (x, y) within `reach` px for which `is` holds, as its distance and texel; none past reach. */
function nearest(box: PaintRigTexelBox, x: number, y: number, reach: number, is: (t: number) => boolean): { distance: number; texel: number } | null {
  let best: { distance: number; texel: number } | null = null;
  const i0 = Math.max(0, Math.floor(x - box.x0 - reach)), i1 = Math.min(box.w - 1, Math.ceil(x - box.x0 + reach));
  const j0 = Math.max(0, Math.floor(y - box.y0 - reach)), j1 = Math.min(box.h - 1, Math.ceil(y - box.y0 + reach));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const t = j * box.w + i;
    if (!is(t)) continue;
    const distance = Math.hypot(box.x0 + i + 0.5 - x, box.y0 + j + 0.5 - y);
    if (distance <= reach && (!best || distance < best.distance)) best = { distance, texel: t };
  }
  return best;
}

/** `group`'s mesh over `layer`: the cells any of whose texels (or their neighbours) it covers, and each vertex's share in each skin joint's child. */
export function paintRigSkinMesh(layer: PaintRigCutLayer, group: PaintRigSkinGroup): PaintRigSkinMesh {
  const { box, parts } = layer, cell = SKIN_CELL, { mover, cover } = group;
  const columns = Math.ceil(box.w / cell), rows = Math.ceil(box.h / cell), stride = columns + 1;
  // A joint's bone: from its pivot toward the middle of its child's texels, as a unit vector.
  const boneOf = (child: number, pivot: StampPoint) => {
    let x = 0, y = 0;
    for (let t = 0; t < mover.length; t++) if (mover[t] === child) { x += box.x0 + (t % box.w) + 0.5 - pivot.x; y += box.y0 + Math.floor(t / box.w) + 0.5 - pivot.y; }
    const length = Math.hypot(x, y);
    if (!(length > 0)) throw new Error(`paint rig: ${parts[child].id} is skinned on ${layer.id} with no paint of its own there, so its joint has no bone`);
    return { x: x / length, y: y / length };
  };
  const skinJoints = group.members.flatMap((child) => {
    const { joint } = parts[child];
    return joint.kind === 'skin' ? [{ child, parent: joint.parent, pivot: joint.pivot, bone: boneOf(child, joint.pivot), blend: joint.blend }] : [];
  });
  const parentOf = new Map(skinJoints.map(({ child, parent }) => [child, parent]));
  const depth = (k: number): number => (parentOf.has(k) ? 1 + depth(parentOf.get(k)!) : 0);
  const within = (k: number, child: number): boolean => k === child || (parentOf.has(k) && within(parentOf.get(k)!, child));
  const joints = skinJoints.toSorted((a, b) => depth(a.child) - depth(b.child));
  const kept: number[] = [];
  for (let cj = 0; cj < rows; cj++) for (let ci = 0; ci < columns; ci++) {
    let any = false;
    for (let j = Math.max(0, cj * cell - 1); j < Math.min(box.h, (cj + 1) * cell + 1) && !any; j++) for (let i = Math.max(0, ci * cell - 1); i < Math.min(box.w, (ci + 1) * cell + 1); i++) {
      if (cover[j * box.w + i] > 0) { any = true; break; }
    }
    if (any) kept.push(cj * columns + ci);
  }
  const triangles = new Uint32Array(kept.length * 6);
  // Whether paint lies under each triangle: a covered texel centre in it (upper where fu ≥ fv in its cell, as below).
  const painted = new Uint8Array(kept.length * 2);
  kept.forEach((c, n) => {
    const v = Math.floor(c / columns) * stride + (c % columns), ci = c % columns, cj = Math.floor(c / columns);
    triangles.set([v, v + 1, v + stride + 1, v, v + stride + 1, v + stride], n * 6);
    for (let j = cj * cell; j < Math.min(box.h, (cj + 1) * cell); j++) for (let i = ci * cell; i < Math.min(box.w, (ci + 1) * cell); i++) {
      if (cover[j * box.w + i] > 0) painted[2 * n + (i - ci * cell >= j - cj * cell ? 0 : 1)] = 1;
    }
  });
  const vertices = (rows + 1) * stride, shares = new Float32Array(vertices * joints.length), blending = new Uint32Array(vertices);
  for (const v of new Set(triangles)) {
    const x = box.x0 + (v % stride) * cell, y = box.y0 + Math.floor(v / stride) * cell;
    // A kept cell holds a covered texel within a texel of it, so every vertex has one within 2 cells.
    const found = nearest(box, x, y, 2 * cell, (t) => mover[t] >= 0)!, own = mover[found.texel];
    joints.forEach(({ child, parent, pivot, bone, blend }, n) => {
      // Across the joint the share is a linear ramp of the distance past the joint line (through the pivot, square to
      // the bone), so the joint's angle accrues evenly along the bone and the bend is a circular arc.
      const past = (x - pivot.x) * bone.x + (y - pivot.y) * bone.y;
      let share = within(own, child) ? 1 : 0;
      if (own === child || own === parent) share = Math.min(1, Math.max(0, past / blend + 0.5));
      shares[v * joints.length + n] = share;
      if (share > 0 && share < 1) blending[v] |= 1 << n;
    });
  }
  const bands = new Map(joints.map(({ child }, n) => {
    const inBand: number[] = [];
    for (let t = 0; t < triangles.length / 3; t++) if (painted[t] && (blending[triangles[3 * t]] | blending[triangles[3 * t + 1]] | blending[triangles[3 * t + 2]]) & (1 << n)) inBand.push(t);
    return [child, Uint32Array.from(inBand)];
  }));
  return { box, cell, columns, rows, triangles, root: group.root, joints: joints.map(({ child, parent, pivot }) => ({ child, parent, pivot })), shares, bands };
}

/**
 * A skin joint's turn this frame: the child's map against its parent's near the rest `pivot`, as rest-space
 * L(v) = pivot + shift + R(angle)·S·(v − pivot), S what's left after the turn (a stretch, the identity for a rigid
 * joint). Exact when the parent's map is affine; a bent or boiled parent is read at the pivot.
 */
type SkinTurn = { pivot: StampPoint; angle: number; stretch: readonly [number, number, number, number]; shift: StampPoint };

function skinTurnOf(parent: StampWarpMap, child: StampWarpMap, pivot: StampPoint): SkinTurn {
  const jacobian = (map: StampWarpMap) => {
    const at = map(pivot), across = map({ x: pivot.x + 1, y: pivot.y }), down = map({ x: pivot.x, y: pivot.y + 1 });
    return { at, a: across.x - at.x, b: down.x - at.x, c: across.y - at.y, d: down.y - at.y };
  };
  const p = jacobian(parent), q = jacobian(child), det = p.a * p.d - p.b * p.c;
  // The parent's linear part undone: m = P⁻¹·Q, shift = P⁻¹·(child(pivot) − parent(pivot)).
  const undo = (x: number, y: number) => ({ x: (p.d * x - p.b * y) / det, y: (p.a * y - p.c * x) / det });
  const first = undo(q.a, q.c), second = undo(q.b, q.d), shift = undo(q.at.x - p.at.x, q.at.y - p.at.y);
  const angle = Math.atan2(first.y - second.x, first.x + second.y), cos = Math.cos(angle), sin = Math.sin(angle);
  // S = R(−angle)·m, symmetric: the polar decomposition's stretch.
  const stretch = [cos * first.x + sin * first.y, cos * second.x + sin * second.y, cos * first.y - sin * first.x, cos * second.y - sin * second.x] as const;
  return { pivot, angle, stretch, shift };
}

/** `v` carried by `share` of `turn`: the shift by share, the angle by share, the stretch eased in by share. */
function skinTurnBy({ pivot, angle, stretch: [a, b, c, d], shift }: SkinTurn, share: number, v: StampPoint): StampPoint {
  const dx = v.x - pivot.x, dy = v.y - pivot.y;
  const sx = dx + share * ((a - 1) * dx + b * dy), sy = dy + share * (c * dx + (d - 1) * dy);
  const cos = Math.cos(share * angle), sin = Math.sin(share * angle);
  return { x: pivot.x + share * shift.x + cos * sx - sin * sy, y: pivot.y + share * shift.y + sin * sx + cos * sy };
}

/**
 * `mesh` posed by each part's rest-to-posed map, by index: a vertex by the map of the deepest part it lies wholly
 * within, after its share of each joint below that it straddles, deepest first, so one wholly in a part goes exactly
 * by its map. Triangles as the rasteriser takes them: posed x, y, rest x, y a vertex.
 */
export function paintRigSkinTriangles(mesh: PaintRigSkinMesh, mapOf: (part: number) => StampWarpMap): Float32Array {
  const { box, cell, columns, triangles, root, joints, shares } = mesh, stride = columns + 1;
  const turns = joints.map(({ child, parent, pivot }) => skinTurnOf(mapOf(parent), mapOf(child), pivot));
  const posed = new Map<number, StampPoint>(), out = new Float32Array(triangles.length * 4);
  const pose = (v: number) => {
    const known = posed.get(v);
    if (known) return known;
    let anchor = root, at = { x: box.x0 + (v % stride) * cell, y: box.y0 + Math.floor(v / stride) * cell };
    const partial: number[] = [];
    // Joints run root first, so a vertex wholly past a joint has its anchor at the joint's parent by then.
    joints.forEach(({ child, parent }, n) => {
      const share = shares[v * joints.length + n];
      if (share >= 1 && parent === anchor) anchor = child;
      else if (share > 0) partial.push(n);
    });
    for (const n of partial.toReversed()) at = skinTurnBy(turns[n], shares[v * joints.length + n], at);
    const point = mapOf(anchor)(at);
    posed.set(v, point);
    return point;
  };
  triangles.forEach((v, n) => {
    const at = pose(v);
    out.set([at.x, at.y, box.x0 + (v % stride) * cell, box.y0 + Math.floor(v / stride) * cell], n * 4);
  });
  return out;
}

/**
 * `mesh` as posed by `triangles` (paintRigSkinTriangles' for it): a rest point carried to where the mesh put it,
 * through the triangle of its cell it lies in. Null off the mesh.
 */
export function paintRigSkinRestMap(mesh: PaintRigSkinMesh, triangles: Float32Array): (rest: StampPoint) => StampPoint | null {
  const { box, cell, columns, rows } = mesh, first = new Int32Array(columns * rows).fill(-1), stride = columns + 1;
  // Each kept cell's two triangles sit together, its first leading with the cell's top-left vertex.
  for (let t = 0; t < mesh.triangles.length / 3; t += 2) {
    const v = mesh.triangles[3 * t];
    first[Math.floor(v / stride) * columns + (v % stride)] = t;
  }
  return ({ x, y }) => {
    const gu = (x - box.x0) / cell, gv = (y - box.y0) / cell, ci = Math.min(columns - 1, Math.floor(gu)), cj = Math.min(rows - 1, Math.floor(gv));
    if (ci < 0 || cj < 0 || first[cj * columns + ci] < 0) return null;
    const t = first[cj * columns + ci], fu = gu - ci, fv = gv - cj;
    // Upper triangle (top-left, top-right, bottom-right) where fu ≥ fv; lower (top-left, bottom-right, bottom-left) else.
    const at = (k: number) => ({ x: triangles[12 * t + 4 * k], y: triangles[12 * t + 4 * k + 1] });
    const [a, b, c] = fu >= fv ? [at(0), at(1), at(2)] : [at(3), at(4), at(5)];
    const [wa, wb, wc] = fu >= fv ? [1 - fu, fu - fv, fv] : [1 - fv, fu, fv - fu];
    return { x: wa * a.x + wb * b.x + wc * c.x, y: wa * a.y + wb * b.y + wc * c.y };
  };
}

/**
 * The worst a skin band does across the joint: the least triangle area ratio (posed ÷ rest), the most, and how many
 * triangles flipped (ratio at or below 0: the paint folds over itself).
 */
export function paintRigBandStretch(triangles: Float32Array, band: Uint32Array): { least: number; most: number; flips: number } {
  let least = Infinity, most = 0, flips = 0;
  for (const t of band) {
    const v = t * 12;
    const rest = (triangles[v + 6] - triangles[v + 2]) * (triangles[v + 11] - triangles[v + 3]) - (triangles[v + 7] - triangles[v + 3]) * (triangles[v + 10] - triangles[v + 2]);
    const posed = (triangles[v + 4] - triangles[v]) * (triangles[v + 9] - triangles[v + 1]) - (triangles[v + 5] - triangles[v + 1]) * (triangles[v + 8] - triangles[v]);
    const ratio = posed / rest;
    least = Math.min(least, ratio); most = Math.max(most, ratio);
    if (ratio <= 0) flips++;
  }
  return { least, most, flips };
}

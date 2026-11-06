// paint-rig-skin.ts: a layer's cut parts posed. Parts joined by skin joints form one group, a triangle mesh of 6 px
// cells over their texels. Each part's paint goes exactly by its own map, except within a band `blend` px wide along
// the seam where a skin joint's two sides meet: there the mesh finds its own shape, as rigid as it can (paint-rig-arap.ts),
// so a bend curves the paint round without shearing or squeezing what lies off the seam. A hinge child starts its own
// group, a rigid piece, above or below by z.
//
// A mesh is data a renderer can take whole: triangles over a vertex grid, each vertex's part, and the factored solve.

import type { StampWarpMap } from '#lib/paint/painting/models/stamp-group-warp.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintRigArapPose, paintRigArapSystem, type PaintRigArapSystem } from './paint-rig-arap.ts';
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

/** A skin joint of a group: its `child` and `parent` (indices into the layer's parts) and its band's width, `blend` px. */
export type PaintRigSkinJoint = { readonly child: number; readonly parent: number; readonly blend: number };

/**
 * A group's mesh at rest: a vertex grid of `cell` px from the layer box's corner, its triangles (three vertex indices
 * each), its skin `joints`, each vertex's part (−1 off the mesh) and whether a band frees it (else its part's map pins it), each
 * joint's band by child (none if the child shows no paint), and the solve.
 */
export type PaintRigSkinMesh = {
  readonly box: PaintRigTexelBox; readonly cell: number; readonly columns: number; readonly rows: number; readonly triangles: Uint32Array;
  readonly joints: readonly PaintRigSkinJoint[]; readonly owners: Int16Array; readonly free: Uint8Array;
  readonly bands: ReadonlyMap<number, Uint32Array>; readonly arap: PaintRigArapSystem;
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

/** A skin mesh before its solve is factored, its rest vertices, and the members its own pose never reaches (`unreached`). */
type PaintRigSkinLayout = Omit<PaintRigSkinMesh, 'arap'> & { readonly rest: Float64Array; readonly unreached: readonly number[] };

/** `group`'s mesh over `layer`, unfactored: the cells any of whose texels (or their neighbours) it covers, each vertex's part, and its bands. */
function paintRigSkinLayout(layer: PaintRigCutLayer, group: PaintRigSkinGroup): PaintRigSkinLayout {
  const { box, parts } = layer, cell = SKIN_CELL, { mover, cover } = group;
  const columns = Math.ceil(box.w / cell), rows = Math.ceil(box.h / cell), stride = columns + 1;
  const joints = group.members.flatMap((child) => {
    const { joint } = parts[child];
    return joint.kind === 'skin' ? [{ child, parent: joint.parent, blend: joint.blend }] : [];
  });
  const parentOf = new Map(joints.map(({ child, parent }) => [child, parent]));
  const within = (k: number, child: number): boolean => k === child || (parentOf.has(k) && within(parentOf.get(k)!, child));
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
  const vertices = (rows + 1) * stride, owners = new Int16Array(vertices).fill(-1);
  const inBandOf = joints.map(() => new Uint8Array(vertices));
  const rest = new Float64Array(vertices * 2);
  for (let v = 0; v < vertices; v++) rest.set([box.x0 + (v % stride) * cell, box.y0 + Math.floor(v / stride) * cell], 2 * v);
  for (const v of new Set(triangles)) {
    const x = rest[2 * v], y = rest[2 * v + 1];
    // A kept cell holds a covered texel within a texel of it, so every vertex has one within 2 cells.
    const own = mover[nearest(box, x, y, 2 * cell, (t) => mover[t] >= 0)!.texel];
    owners[v] = own;
    // In a joint's band: within half its blend of paint on the joint's other side (the child's and what hangs from it,
    // or the rest of the group). Paint of the parent's far from the child's isn't, so it stays put as the child turns.
    joints.forEach(({ child, blend }, n) => {
      const inside = within(own, child);
      if (nearest(box, x, y, blend / 2, (t) => mover[t] >= 0 && within(mover[t], child) !== inside)) inBandOf[n][v] = 1;
    });
  }
  // A triangle spanning a seam is in its band whatever the blend, else a blend under a cell would leave it stretched
  // between two parts' maps with no vertex free to give.
  for (let t = 0; t < triangles.length / 3; t++) joints.forEach(({ child }, n) => {
    const inside = [0, 1, 2].filter((k) => within(owners[triangles[3 * t + k]], child)).length;
    if (inside > 0 && inside < 3) for (let k = 0; k < 3; k++) inBandOf[n][triangles[3 * t + k]] = 1;
  });
  const free = Uint8Array.from(owners, (_, v) => (inBandOf.some((inBand) => inBand[v]) ? 1 : 0));
  // A part's pose reaches its paint only through vertices pinned to it.
  const showing = new Set(mover), pinned = new Set([...owners.keys()].filter((v) => owners[v] >= 0 && !free[v]).map((v) => owners[v]));
  const unreached = group.members.filter((k) => showing.has(k) && !pinned.has(k));
  // A joint whose child shows no paint here has no band.
  const bands = new Map(joints.flatMap(({ child }, n) => {
    const inBand: number[] = [];
    for (let t = 0; t < triangles.length / 3; t++) if (painted[t] && (inBandOf[n][triangles[3 * t]] || inBandOf[n][triangles[3 * t + 1]] || inBandOf[n][triangles[3 * t + 2]])) inBand.push(t);
    return inBand.length ? [[child, Uint32Array.from(inBand)] as const] : [];
  }));
  return { box, cell, columns, rows, triangles, joints, owners, free, bands, rest, unreached };
}

/**
 * Why a skinned part can't be posed by its own paint: it owns none of the layer's texels (`unowned`: its cel is clear,
 * or outweighed wherever it paints), or its paint is narrower than a mesh cell or lies wholly within skin bands, so no
 * vertex pinned to it reaches it (`unreached`).
 */
export type PaintRigSkinProblem = 'unowned' | 'unreached';

/** The skinned parts of `layer` paintRigSkinMesh refuses, by index into its parts and why, for a caller to name before it skins. */
export function paintRigSkinProblems(layer: PaintRigCutLayer): { readonly part: number; readonly problem: PaintRigSkinProblem }[] {
  const owned = new Set(layer.owner);
  const unowned = layer.parts.flatMap(({ joint }, part) => (joint.kind === 'skin' && !owned.has(part) ? [{ part, problem: 'unowned' as const }] : []));
  if (unowned.length) return unowned;
  return paintRigSkinGroups(layer).flatMap((group) => paintRigSkinLayout(layer, group).unreached.map((part) => ({ part, problem: 'unreached' as const })));
}

/** `group`'s mesh over `layer`, its solve factored. Refuses what paintRigSkinProblems names. */
export function paintRigSkinMesh(layer: PaintRigCutLayer, group: PaintRigSkinGroup): PaintRigSkinMesh {
  const owned = new Set(layer.owner), name = (k: number) => layer.parts[k].id;
  const unowned = group.members.filter((k) => layer.parts[k].joint.kind === 'skin' && !owned.has(k));
  if (unowned.length) throw new Error(`paint rig: ${unowned.map(name).join(', ')} skinned on ${layer.id} with no paint of its own there`);
  const { rest, unreached, ...mesh } = paintRigSkinLayout(layer, group);
  if (unreached.length) {
    throw new Error(`paint rig: ${unreached.map(name).join(', ')}'s paint on ${layer.id} is narrower than a ${mesh.cell} px cell or lies wholly within its skin bands, so its own pose never reaches it: widen the part or narrow the blend`);
  }
  return { ...mesh, arap: paintRigArapSystem(rest, mesh.triangles, (v) => mesh.free[v] === 1) };
}

/**
 * `mesh` posed by each part's rest-to-posed map, by index: a vertex out of every band exactly by its part's map, one in
 * a band where the mesh keeps its triangles' shapes best between them. Triangles as the GPU takes them: posed x, y,
 * rest x, y a vertex.
 */
export function paintRigSkinTriangles(mesh: PaintRigSkinMesh, mapOf: (part: number) => StampWarpMap): Float32Array {
  const { triangles, owners, arap } = mesh, { rest } = arap, maps = new Map<number, StampWarpMap>();
  const targets = new Float64Array(rest.length);
  for (let v = 0; v < owners.length; v++) {
    const own = owners[v];
    if (own < 0) continue;
    if (!maps.has(own)) maps.set(own, mapOf(own));
    const at = maps.get(own)!({ x: rest[2 * v], y: rest[2 * v + 1] });
    targets[2 * v] = at.x; targets[2 * v + 1] = at.y;
  }
  const posed = paintRigArapPose(arap, targets), out = new Float32Array(triangles.length * 4);
  triangles.forEach((v, n) => out.set([posed[2 * v], posed[2 * v + 1], rest[2 * v], rest[2 * v + 1]], n * 4));
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

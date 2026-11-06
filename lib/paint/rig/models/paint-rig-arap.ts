// paint-rig-arap.ts: as-rigid-as-possible shape manipulation (Igarashi, Moscovich & Hughes 2005, then the local/global
// iterations of Sorkine & Alexa 2007), purely. Some vertices of a triangle mesh are pinned where they must go; the rest
// are placed so each triangle keeps its rest shape as nearly as it can while turning freely. The systems depend only on
// the rest mesh and which vertices are free, so they're factored once and a pose is a few back-substitutions.
//
// A point here is a complex number x + iy: turning and scaling by one is a multiplication, so a triangle's shape kept
// up to a similarity is linear in its vertices.

/** A symmetric positive-definite band matrix's Cholesky factor: row i holds columns i − band … i. */
type BandedCholesky = { readonly size: number; readonly band: number; readonly values: Float64Array };

/** A band matrix being assembled: add a symmetric entry once, by its lower triangle (j ≤ i), and factor it. */
function bandedMatrix(size: number, band: number) {
  const values = new Float64Array(size * (band + 1));
  return {
    add(i: number, j: number, value: number) {
      if (j <= i) values[i * (band + 1) + j - i + band] += value;
    },
    factor(): BandedCholesky {
      const at = (i: number, j: number) => i * (band + 1) + j - i + band;
      for (let i = 0; i < size; i++) for (let j = Math.max(0, i - band); j <= i; j++) {
        let sum = values[at(i, j)];
        for (let k = Math.max(0, i - band); k < j; k++) sum -= values[at(i, k)] * values[at(j, k)];
        values[at(i, j)] = i === j ? Math.sqrt(sum) : sum / values[at(j, j)];
      }
      return { size, band, values };
    },
  };
}

/** `rhs` solved through `factor` in place. */
function bandedSolve({ size, band, values }: BandedCholesky, rhs: Float64Array): void {
  const at = (i: number, j: number) => i * (band + 1) + j - i + band;
  for (let i = 0; i < size; i++) {
    let sum = rhs[i];
    for (let k = Math.max(0, i - band); k < i; k++) sum -= values[at(i, k)] * rhs[k];
    rhs[i] = sum / values[at(i, i)];
  }
  for (let i = size - 1; i >= 0; i--) {
    let sum = rhs[i];
    for (let k = i + 1; k <= Math.min(size - 1, i + band); k++) sum -= values[at(k, i)] * rhs[k];
    rhs[i] = sum / values[at(i, i)];
  }
}

/**
 * The factored systems for a mesh: its `rest` vertices (x, y each), each vertex's index among the free ones (−1
 * pinned) and theirs in turn, the triangles with a free vertex (no other moves one), each corner's shape against its
 * opposite edge (x along, y across), and the similarity and rigid steps' factors.
 */
export type PaintRigArapSystem = {
  readonly rest: Float64Array; readonly free: Int32Array; readonly freeVertices: Uint32Array; readonly triangles: Uint32Array; readonly shapes: Float64Array;
  readonly similar: BandedCholesky; readonly rigid: BandedCholesky;
};

/**
 * A free vertex's weak pull toward its target, so a patch of free vertices pinned to nothing (an island of paint inside
 * a band) still has one pose. Small beside a triangle's own weight of about 1, so it doesn't bend a band.
 */
const ARAP_TETHER = 1e-4;

/** Rigid steps after the similarity one: each brings the triangles nearer their rest shapes. */
const ARAP_ITERATIONS = 4;

/** The mesh's corners in a triangle seen from the opposite edge: corner `k` of `t`, and that edge's ends. */
const cornersOf = (triangles: Uint32Array, t: number, k: number) => [triangles[3 * t + k], triangles[3 * t + ((k + 1) % 3)], triangles[3 * t + ((k + 2) % 3)]] as const;

/**
 * `triangles` over `rest` (x, y a vertex) made ready to pose with the vertices `isFree` holds for placed by the mesh
 * and every other one pinned.
 */
export function paintRigArapSystem(rest: Float64Array, triangles: Uint32Array, isFree: (vertex: number) => boolean): PaintRigArapSystem {
  const free = new Int32Array(rest.length / 2).fill(-1);
  const freeVertices: number[] = [];
  for (let v = 0; v < free.length; v++) if (isFree(v)) free[v] = freeVertices.push(v) - 1;
  const count = freeVertices.length;
  const active: number[] = [];
  for (let t = 0; t < triangles.length / 3; t++) if (free[triangles[3 * t]] >= 0 || free[triangles[3 * t + 1]] >= 0 || free[triangles[3 * t + 2]] >= 0) active.push(t, t, t);
  const kept = Uint32Array.from(active, (t, n) => triangles[3 * t + (n % 3)]);
  // A corner as a complex multiple of its opposite edge: corner − from = (x + iy)·(to − from).
  const shapes = new Float64Array(kept.length * 2);
  let band = 0;
  for (let t = 0; t < kept.length / 3; t++) for (let k = 0; k < 3; k++) {
    const [corner, from, to] = cornersOf(kept, t, k);
    const ex = rest[2 * to] - rest[2 * from], ey = rest[2 * to + 1] - rest[2 * from + 1];
    const dx = rest[2 * corner] - rest[2 * from], dy = rest[2 * corner + 1] - rest[2 * from + 1], length = ex * ex + ey * ey;
    shapes.set([(dx * ex + dy * ey) / length, (dy * ex - dx * ey) / length], 6 * t + 2 * k);
    if (free[corner] >= 0 && free[from] >= 0) band = Math.max(band, Math.abs(free[corner] - free[from]));
  }
  const similar = bandedMatrix(2 * count, 2 * band + 1), rigid = bandedMatrix(count, band);
  for (let f = 0; f < count; f++) {
    similar.add(2 * f, 2 * f, ARAP_TETHER); similar.add(2 * f + 1, 2 * f + 1, ARAP_TETHER); rigid.add(f, f, ARAP_TETHER);
  }
  for (let t = 0; t < kept.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const vertices = cornersOf(kept, t, k), weights = similarWeights(shapes, t, k);
      // The residual Σ c·p's normal equations: conj(c_a)·c_b, as a real 2 × 2 block [[re, −im], [im, re]].
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        const fa = free[vertices[a]], fb = free[vertices[b]];
        if (fa < 0 || fb < 0) continue;
        const [ar, ai] = weights[a], [br, bi] = weights[b], re = ar * br + ai * bi, im = ar * bi - ai * br;
        similar.add(2 * fa, 2 * fb, re); similar.add(2 * fa, 2 * fb + 1, -im); similar.add(2 * fa + 1, 2 * fb, im); similar.add(2 * fa + 1, 2 * fb + 1, re);
      }
      const [, from, to] = vertices, ff = free[from], ft = free[to];
      // Each edge once a triangle (as the edge opposite corner k): |p_from − p_to − R·(r_from − r_to)|².
      if (ff >= 0) rigid.add(ff, ff, 1);
      if (ft >= 0) rigid.add(ft, ft, 1);
      if (ff >= 0 && ft >= 0) { rigid.add(ff, ft, -1); rigid.add(ft, ff, -1); }
    }
  }
  return { rest, free, freeVertices: Uint32Array.from(freeVertices), triangles: kept, shapes, similar: similar.factor(), rigid: rigid.factor() };
}

/** Corner `k` of triangle `t`'s residual's weights on (corner, from, to), complex: p_corner − p_from − s·(p_to − p_from). */
function similarWeights(shapes: Float64Array, t: number, k: number): readonly (readonly [number, number])[] {
  const x = shapes[6 * t + 2 * k], y = shapes[6 * t + 2 * k + 1];
  return [[1, 0], [x - 1, y], [-x, -y]];
}

/**
 * `system` posed: each pinned vertex at its target (x, y a vertex, all of them), each free one where its triangles
 * keep their rest shapes best. Its targets serve only as a faint tether (ARAP_TETHER).
 */
export function paintRigArapPose(system: PaintRigArapSystem, targets: Float64Array): Float64Array {
  const { rest, free, freeVertices: freeVertex, triangles, shapes, similar, rigid } = system, count = rigid.size, posed = targets.slice();
  // The similarity step: each triangle's corners kept where their opposite edges put them, up to a turn and scale.
  const first = new Float64Array(2 * count);
  for (let f = 0; f < count; f++) { first[2 * f] = ARAP_TETHER * targets[2 * freeVertex[f]]; first[2 * f + 1] = ARAP_TETHER * targets[2 * freeVertex[f] + 1]; }
  for (let t = 0; t < triangles.length / 3; t++) for (let k = 0; k < 3; k++) {
    const vertices = cornersOf(triangles, t, k), weights = similarWeights(shapes, t, k);
    for (let a = 0; a < 3; a++) {
      const fa = free[vertices[a]];
      if (fa < 0) continue;
      for (let b = 0; b < 3; b++) {
        if (free[vertices[b]] >= 0) continue;
        const [ar, ai] = weights[a], [br, bi] = weights[b], re = ar * br + ai * bi, im = ar * bi - ai * br;
        const qx = targets[2 * vertices[b]], qy = targets[2 * vertices[b] + 1];
        first[2 * fa] -= re * qx - im * qy; first[2 * fa + 1] -= im * qx + re * qy;
      }
    }
  }
  bandedSolve(similar, first);
  for (let f = 0; f < count; f++) posed.set([first[2 * f], first[2 * f + 1]], 2 * freeVertex[f]);
  // The rigid steps: each triangle's best turn onto where it lies now, then every free vertex placed to suit them all.
  // A triangle collapsed to a point has no best turn, so it keeps its last, the first none.
  const turns = new Float64Array((triangles.length / 3) * 2).map((_, n) => (n % 2 ? 0 : 1)), xs = new Float64Array(count), ys = new Float64Array(count);
  for (let iteration = 0; iteration < ARAP_ITERATIONS; iteration++) {
    for (let t = 0; t < triangles.length / 3; t++) {
      let re = 0, im = 0;
      for (let k = 0; k < 3; k++) {
        const [, from, to] = cornersOf(triangles, t, k);
        const rx = rest[2 * from] - rest[2 * to], ry = rest[2 * from + 1] - rest[2 * to + 1], px = posed[2 * from] - posed[2 * to], py = posed[2 * from + 1] - posed[2 * to + 1];
        re += rx * px + ry * py; im += rx * py - ry * px;
      }
      const length = Math.hypot(re, im);
      if (length > 0) { turns[2 * t] = re / length; turns[2 * t + 1] = im / length; }
    }
    for (let f = 0; f < count; f++) { xs[f] = ARAP_TETHER * targets[2 * freeVertex[f]]; ys[f] = ARAP_TETHER * targets[2 * freeVertex[f] + 1]; }
    for (let t = 0; t < triangles.length / 3; t++) for (let k = 0; k < 3; k++) {
      const [, from, to] = cornersOf(triangles, t, k), c = turns[2 * t], s = turns[2 * t + 1];
      const rx = rest[2 * from] - rest[2 * to], ry = rest[2 * from + 1] - rest[2 * to + 1], ex = c * rx - s * ry, ey = s * rx + c * ry;
      for (const [a, b, sign] of [[from, to, 1], [to, from, -1]] as const) {
        const fa = free[a];
        if (fa < 0) continue;
        xs[fa] += sign * ex; ys[fa] += sign * ey;
        if (free[b] < 0) { xs[fa] += posed[2 * b]; ys[fa] += posed[2 * b + 1]; }
      }
    }
    bandedSolve(rigid, xs); bandedSolve(rigid, ys);
    for (let f = 0; f < count; f++) posed.set([xs[f], ys[f]], 2 * freeVertex[f]);
  }
  return posed;
}

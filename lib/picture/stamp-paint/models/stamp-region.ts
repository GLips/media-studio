// stamp-region.ts: an area of a painting as the engine measures it, for fills, masks and clips. A region is traced to
// a polygon once; its coverage at a pixel comes from its exact signed distance (positive inside, by even-odd), ramped
// over an edge. A distance grid, coarser than the pixels, gives a fill the contour its edge stroke follows and how
// thick the region is near a point.
//
// The per-pixel formulas are CPU and WGSL twins (STAMP_REGION_FUNCTIONS), held together by the formulas command as
// coverage-formulas.ts's are. The polygon's distance itself is a loop over its edges on both sides (stampPolygonDistance
// here, polygonDistance in the renderer), held together by the deposits command's whole-painting comparison.

import { STAMP_COVERAGE_FUNCTIONS } from './coverage-formulas.ts';

export type StampPoint = { x: number; y: number };

/** An area of the painting, in its pixels. */
export type StampRegion =
  | { kind: 'polygon'; points: readonly StampPoint[] }
  | { kind: 'ellipse'; x: number; y: number; radiusX: number; radiusY: number };

/**
 * How a mask's edge meets the paper: a 1-px antialiased line when left out. `soft`: the width, px, it fades over.
 * `ragged`: its line moved in and out by up to `amount` px, by noise whose features are about `scale` px apart,
 * seeded by the mask's ID, as masking fluid laid with a rough brush.
 */
export type StampEdge = { soft?: number; ragged?: { amount: number; scale: number } };

/** Pixels x0..x1, y0..y1, as reals. */
export type StampBox = { x0: number; y0: number; x1: number; y1: number };

/** How far a traced ellipse's chords may stray from it, px. */
const ELLIPSE_SAGITTA = 0.1;

/** `region` as a closed polygon, its first point not repeated: an ellipse traced so no chord strays 0.1 px from it. */
export function stampRegionPolygon(region: StampRegion): readonly StampPoint[] {
  if (region.kind === 'polygon') return region.points;
  const r = Math.max(region.radiusX, region.radiusY);
  const steps = Math.max(12, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - ELLIPSE_SAGITTA / r))));
  return Array.from({ length: steps }, (_, i) => {
    const turn = (i / steps) * Math.PI * 2;
    return { x: region.x + Math.cos(turn) * region.radiusX, y: region.y + Math.sin(turn) * region.radiusY };
  });
}

/** The box round `polygon`, grown by `pad` px each way. */
export function stampPolygonBox(polygon: readonly StampPoint[], pad = 0): StampBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { x, y } of polygon) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/** How far (x, y) is from `polygon`'s outline, positive inside it (even-odd), negative outside. */
export function stampPolygonDistance(polygon: readonly StampPoint[], x: number, y: number): number {
  let nearest = Infinity, inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    const ex = b.x - a.x, ey = b.y - a.y, px = x - a.x, py = y - a.y;
    const along = Math.min(1, Math.max(0, (px * ex + py * ey) / (ex * ex + ey * ey || 1)));
    nearest = Math.min(nearest, (px - ex * along) ** 2 + (py - ey * along) ** 2);
    if ((a.y > y) !== (b.y > y) && x < a.x + ((y - a.y) / (b.y - a.y)) * ex) inside = !inside;
  }
  return inside ? Math.sqrt(nearest) : -Math.sqrt(nearest);
}

/**
 * A field sampled at the corners of cells `cell` px a side from (x0, y0): `columns` × `rows` values, row by row, the
 * value at column i, row j standing at (x0 + i·cell, y0 + j·cell).
 */
export type StampGrid = { x0: number; y0: number; cell: number; columns: number; rows: number; values: Float32Array };

/** `polygon`'s signed distance over `box`, on a grid of `cell` px. */
export function stampDistanceGrid(polygon: readonly StampPoint[], box: StampBox, cell: number): StampGrid {
  const columns = Math.ceil((box.x1 - box.x0) / cell) + 1, rows = Math.ceil((box.y1 - box.y0) / cell) + 1;
  const values = new Float32Array(columns * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) values[j * columns + i] = stampPolygonDistance(polygon, box.x0 + i * cell, box.y0 + j * cell);
  return { x0: box.x0, y0: box.y0, cell, columns, rows, values };
}

/** `grid`'s value at (x, y), bilinear, held at its border. */
export function stampGridAt(grid: StampGrid, x: number, y: number): number {
  const u = Math.min(grid.columns - 1, Math.max(0, (x - grid.x0) / grid.cell)), v = Math.min(grid.rows - 1, Math.max(0, (y - grid.y0) / grid.cell));
  const i = Math.min(grid.columns - 2, Math.floor(u)), j = Math.min(grid.rows - 2, Math.floor(v));
  const fu = u - i, fv = v - j, at = (di: number, dj: number) => grid.values[(j + dj) * grid.columns + i + di];
  if (grid.columns < 2 || grid.rows < 2) return grid.values[0];
  return (at(0, 0) * (1 - fu) + at(1, 0) * fu) * (1 - fv) + (at(0, 1) * (1 - fu) + at(1, 1) * fu) * fv;
}

/**
 * The largest value of `grid` within `radius` px of each of its points: over a distance grid, how thick the region
 * is near there (the radius of the widest disc inside it, close by), which a wash's body narrows its edge to.
 */
export function stampGridLocalMax(grid: StampGrid, radius: number): StampGrid {
  const { columns, rows, values } = grid, reach = Math.ceil(radius / grid.cell), within = (radius / grid.cell) ** 2;
  // Rows first, then columns over the disc's half-widths: a disc's max as a max of row maxima.
  const out = new Float32Array(values.length);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      let most = -Infinity;
      for (let dj = -reach; dj <= reach; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= rows) continue;
        const half = Math.floor(Math.sqrt(Math.max(0, within - dj * dj)));
        for (let ii = Math.max(0, i - half); ii <= Math.min(columns - 1, i + half); ii++) most = Math.max(most, values[jj * columns + ii]);
      }
      out[j * columns + i] = most;
    }
  }
  return { ...grid, values: out };
}

/**
 * Where `grid` crosses `level`, as closed loops (marching squares, each crossing placed linearly along its cell's
 * side). A loop that runs off the grid's border is left open, so callers pad the grid until its border lies below
 * the level. A saddle cell joins its crossings by the cell's mean, so loops never cross.
 */
export function stampGridContours(grid: StampGrid, level: number): StampPoint[][] {
  const { columns, rows, values, x0, y0, cell } = grid;
  const at = (i: number, j: number) => values[j * columns + i] - level;
  // A crossing on a cell side, keyed by the side: horizontal sides (i, j)–(i+1, j) and vertical (i, j)–(i, j+1).
  const point = (i: number, j: number, horizontal: boolean): StampPoint => {
    const a = at(i, j), b = horizontal ? at(i + 1, j) : at(i, j + 1), t = a / (a - b);
    return horizontal ? { x: x0 + (i + t) * cell, y: y0 + j * cell } : { x: x0 + i * cell, y: y0 + (j + t) * cell };
  };
  const key = (i: number, j: number, horizontal: boolean) => (j * columns + i) * 2 + (horizontal ? 0 : 1);
  // Each segment runs from one side to another, with the inside on its left, so loops chain head to tail.
  const next = new Map<number, number>(), where = new Map<number, [number, number, boolean]>();
  const segment = (from: [number, number, boolean], to: [number, number, boolean]) => {
    const a = key(...from), b = key(...to);
    next.set(a, b);
    where.set(a, from);
    where.set(b, to);
  };
  for (let j = 0; j + 1 < rows; j++) {
    for (let i = 0; i + 1 < columns; i++) {
      const tl = at(i, j) > 0, tr = at(i + 1, j) > 0, br = at(i + 1, j + 1) > 0, bl = at(i, j + 1) > 0;
      const top: [number, number, boolean] = [i, j, true], right: [number, number, boolean] = [i + 1, j, false];
      const bottom: [number, number, boolean] = [i, j + 1, true], left: [number, number, boolean] = [i, j, false];
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      const middle = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 > 0;
      // Inside on the left, walking y down the screen: each case lists its segments.
      switch (code) {
        case 1: segment(left, bottom); break;
        case 2: segment(bottom, right); break;
        case 3: segment(left, right); break;
        case 4: segment(right, top); break;
        case 5: if (middle) { segment(left, top); segment(right, bottom); } else { segment(left, bottom); segment(right, top); } break;
        case 6: segment(bottom, top); break;
        case 7: segment(left, top); break;
        case 8: segment(top, left); break;
        case 9: segment(top, bottom); break;
        case 10: if (middle) { segment(top, right); segment(bottom, left); } else { segment(top, left); segment(bottom, right); } break;
        case 11: segment(top, right); break;
        case 12: segment(right, left); break;
        case 13: segment(right, bottom); break;
        case 14: segment(bottom, left); break;
        default: break;
      }
    }
  }
  const loops: StampPoint[][] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: StampPoint[] = [];
    for (let k: number | undefined = start; k !== undefined && !seen.has(k); k = next.get(k)) {
      seen.add(k);
      const [i, j, horizontal] = where.get(k)!;
      loop.push(point(i, j, horizontal));
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

/**
 * The per-pixel formulas a region is read by, each a CPU function and the WGSL function of the same name.
 */
export const STAMP_REGION_FUNCTIONS = {
  /** Coverage at signed distance `sd` over an edge `width` px wide, centred on the outline: a smoothstep. */
  edgeCoverage: {
    cpu: (sd: number, width: number) => {
      const t = Math.min(1, Math.max(0, sd / width + 0.5));
      return t * t * (3 - 2 * t);
    },
    wgsl: /* wgsl */ `fn edgeCoverage(sd: f32, width: f32) -> f32 { return smoothstep(0.0, 1.0, clamp(sd / width + 0.5, 0.0, 1.0)); }`,
  },
  /**
   * Smooth value noise at (x, y) in lattice units, −1..1, seeded: two octaves of tipNoiseAt's hash at the lattice's
   * corners, eased between them. What a ragged edge moves its outline by.
   */
  edgeNoise: {
    cpu: (x: number, y: number, seed: number) => {
      const octave = (u: number, v: number, salt: number) => {
        const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
        const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
        // Offset so the lattice's u32s stay whole for any painting coordinate.
        const corner = (di: number, dj: number) => STAMP_COVERAGE_FUNCTIONS.tipNoiseAt.cpu((i + di + 32768) >>> 0, (j + dj + 32768) >>> 0, (seed ^ salt) >>> 0) * 2 - 1;
        return (corner(0, 0) * (1 - su) + corner(1, 0) * su) * (1 - sv) + (corner(0, 1) * (1 - su) + corner(1, 1) * su) * sv;
      };
      return (octave(x, y, 0) * 2 + octave(x * 2.3, y * 2.3, 0x5bd1e995)) / 3;
    },
    wgsl: /* wgsl */ `fn edgeNoiseOctave(p: vec2f, seed: u32) -> f32 {
  let i = floor(p);
  let f = p - i;
  let s = f * f * (3.0 - 2.0 * f);
  let c = vec2u(vec2i(i) + 32768);
  let a = tipNoiseAt(c.x, c.y, seed) * 2.0 - 1.0;
  let b = tipNoiseAt(c.x + 1u, c.y, seed) * 2.0 - 1.0;
  let d = tipNoiseAt(c.x, c.y + 1u, seed) * 2.0 - 1.0;
  let e = tipNoiseAt(c.x + 1u, c.y + 1u, seed) * 2.0 - 1.0;
  return mix(mix(a, b, s.x), mix(d, e, s.x), s.y);
}
fn edgeNoise(x: f32, y: f32, seed: u32) -> f32 {
  return (edgeNoiseOctave(vec2f(x, y), seed) * 2.0 + edgeNoiseOctave(vec2f(x, y) * 2.3, seed ^ 0x5bd1e995u)) / 3.0;
}`,
  },
  /**
   * A wash's body at signed distance `sd`, the region `thickness` px thick nearby, its edge stroke's centre `c` px in:
   * full only under that centre, so the stroke's own outer half meets the paper.
   * Where the region is too thin for the stroke, the body alone paints it, rising over a fifth to a half of it.
   */
  washBody: {
    cpu: (sd: number, thickness: number, c: number) => {
      const f = Math.min(1, Math.max(0, (thickness - 0.5 * c) / (0.5 * c)));
      const lo = 0.2 * thickness + (0.5 * c - 0.2 * thickness) * f, hi = Math.max(lo + 1, 0.5 * thickness + (c - 0.5 * thickness) * f);
      const t = Math.min(1, Math.max(0, (sd - lo) / (hi - lo)));
      return t * t * (3 - 2 * t);
    },
    wgsl: /* wgsl */ `fn washBody(sd: f32, thickness: f32, c: f32) -> f32 {
  let f = clamp((thickness - 0.5 * c) / (0.5 * c), 0.0, 1.0);
  let lo = mix(0.2 * thickness, 0.5 * c, f);
  let hi = max(lo + 1.0, mix(0.5 * thickness, c, f));
  return smoothstep(lo, hi, sd);
}`,
  },
};

export const stampEdgeCoverage = STAMP_REGION_FUNCTIONS.edgeCoverage.cpu;
export const stampEdgeNoise = STAMP_REGION_FUNCTIONS.edgeNoise.cpu;
export const stampWashBody = STAMP_REGION_FUNCTIONS.washBody.cpu;

/** The region formulas in WGSL; they call COVERAGE_FORMULAS_WGSL's tipNoiseAt, so they're included after it. */
export const STAMP_REGION_WGSL = Object.values(STAMP_REGION_FUNCTIONS).map(({ wgsl }) => wgsl).join('\n');

/** An edge's width: 1 px, antialiased, unless it's soft. */
export const stampEdgeWidth = (edge?: StampEdge) => Math.max(1, edge?.soft ?? 0);

/** How far past its outline an edge can reach, px: half its width, and its ragged amount. */
export const stampEdgeReach = (edge?: StampEdge) => stampEdgeWidth(edge) / 2 + (edge?.ragged?.amount ?? 0);

/** Coverage of `polygon` with `edge` at (x, y), its ragged noise seeded by `seed`. */
export function stampEdgedCoverage(polygon: readonly StampPoint[], edge: StampEdge | undefined, seed: number, x: number, y: number): number {
  const ragged = edge?.ragged;
  const moved = ragged ? ragged.amount * stampEdgeNoise(x / ragged.scale, y / ragged.scale, seed) : 0;
  return stampEdgeCoverage(stampPolygonDistance(polygon, x, y) + moved, stampEdgeWidth(edge));
}

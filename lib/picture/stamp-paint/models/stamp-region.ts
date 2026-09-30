// stamp-region.ts: an area of a painting as the engine measures it, for fills, masks and clips. A region is traced to
// a polygon once; its coverage at a pixel comes from its exact signed distance (positive inside, by even-odd), ramped
// over an edge. A distance grid, coarser than the pixels, gives a fill the contour its edge stroke follows and how
// thick the region is near a point.
//
// The per-pixel formulas are WGSL only (STAMP_REGION_WGSL), held to their accepted output by the GPU gate as
// coverage-formulas.ts's are. The polygon's distance and a grid's reading are twins, since a fill's layout needs them
// on the CPU (stampPolygonDistance, stampGridAt) and the renderer per pixel; the gate holds each pair together.

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
 * stampPolygonDistance in WGSL: the polygon's `count` points from `first` in the storage array `points`, which the
 * shader including it declares. Twins, both at runtime: the CPU's lays out a fill's grids, the GPU's reads regions per
 * pixel; the GPU gate holds them together.
 */
export const STAMP_POLYGON_DISTANCE_WGSL = /* wgsl */ `
fn polygonDistance(p: vec2f, first: u32, count: u32) -> f32 {
  var nearest = 1e30;
  var inside = false;
  var j = first + count - 1u;
  for (var i = first; i < first + count; i++) {
    let a = points[j];
    let b = points[i];
    let e = b - a;
    let q = p - a;
    let along = clamp(dot(q, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
    let d = q - e * along;
    nearest = min(nearest, dot(d, d));
    if ((a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) / (b.y - a.y) * e.x) { inside = !inside; }
    j = i;
  }
  return select(-sqrt(nearest), sqrt(nearest), inside);
}`;

/**
 * stampGridAt in WGSL: a grid whose values start at `first` in the storage array `grid` (which the including shader
 * declares), its origin and cell as (x0, y0, cell), its columns and rows as `size`. Twins as polygonDistance's are.
 */
export const STAMP_GRID_AT_WGSL = /* wgsl */ `
fn gridAt(p: vec2f, origin: vec3f, size: vec2u, first: u32) -> f32 {
  let uv = clamp((p - origin.xy) / origin.z, vec2f(0.0), vec2f(size) - 1.0);
  let cell = min(vec2u(floor(uv)), size - 2u);
  let f = uv - vec2f(cell);
  let at = first + cell.y * size.x + cell.x;
  return mix(mix(grid[at], grid[at + 1u], f.x), mix(grid[at + size.x], grid[at + size.x + 1u], f.x), f.y);
}`;

/**
 * The largest value of `grid` within `radius` px of each of its points: over a distance grid, how thick the region
 * is near there (the radius of the widest disc inside it, close by), which a flood's body narrows its edge to.
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
 * The per-pixel formulas a region is read by, in WGSL, included after COVERAGE_FORMULAS_WGSL (they call tipNoiseAt).
 * `edgeNoise` is what a ragged edge moves its outline by. `floodBody` is full only under the edge stroke's centre, so
 * the stroke's outer half meets the paper; where the region is too thin for the stroke, the body alone paints it.
 */
export const STAMP_REGION_WGSL = /* wgsl */ `
fn edgeCoverage(sd: f32, width: f32) -> f32 { return smoothstep(0.0, 1.0, clamp(sd / width + 0.5, 0.0, 1.0)); }
fn edgeNoiseOctave(p: vec2f, seed: u32) -> f32 {
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
}
fn floodBody(sd: f32, thickness: f32, c: f32) -> f32 {
  let f = clamp((thickness - 0.5 * c) / (0.5 * c), 0.0, 1.0);
  let lo = mix(0.2 * thickness, 0.5 * c, f);
  let hi = max(lo + 1.0, mix(0.5 * thickness, c, f));
  return smoothstep(lo, hi, sd);
}`;

/** An edge's width: 1 px, antialiased, unless it's soft. */
export const stampEdgeWidth = (edge?: StampEdge) => Math.max(1, edge?.soft ?? 0);

/** How far past its outline an edge can reach, px: half its width, and its ragged amount. */
export const stampEdgeReach = (edge?: StampEdge) => stampEdgeWidth(edge) / 2 + (edge?.ragged?.amount ?? 0);

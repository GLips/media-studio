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

/**
 * `region` traced, `what` naming it: refused unless it's at least 3 finite points enclosing some area, as the
 * distance a fill, mask or `within` reads is only defined for one.
 */
export function checkedStampPolygon(region: StampRegion, what: string): readonly StampPoint[] {
  const polygon = stampRegionPolygon(region);
  if (polygon.length < 3 || !polygon.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)) || !stampRingArea(polygon)) {
    throw new Error(`stamp paint: ${what}'s region isn't a shape: it needs at least 3 finite points enclosing some area`);
  }
  return polygon;
}

/**
 * A closed ring's signed area, px² (shoelace): positive when it turns clockwise on screen (y down), as
 * stampGridContours walks an outer loop; negative the other way.
 */
export function stampRingArea(ring: readonly StampPoint[]): number {
  let twice = 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    twice += a.x * b.y - b.x * a.y;
  });
  return twice / 2;
}

/** The box round `polygon`, grown by `pad` px each way. */
export function stampPolygonBox(polygon: readonly StampPoint[], pad = 0): StampBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { x, y } of polygon) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/**
 * A polygon's segments, flat for hot loops: segment k's start (`ax`, `ay`), its run to the next point (`ex`, `ey`, the
 * last closing to the first), and that run's squared length (1 for none).
 */
export type StampSegments = { ax: Float64Array; ay: Float64Array; ex: Float64Array; ey: Float64Array; length2: Float64Array };

export function stampSegmentsOf(polygon: readonly StampPoint[]): StampSegments {
  const n = polygon.length, ax = Float64Array.from(polygon, (a) => a.x), ay = Float64Array.from(polygon, (a) => a.y);
  const ex = Float64Array.from(polygon, (a, k) => polygon[(k + 1) % n].x - a.x), ey = Float64Array.from(polygon, (a, k) => polygon[(k + 1) % n].y - a.y);
  return { ax, ay, ex, ey, length2: Float64Array.from(polygon, (_, k) => ex[k] * ex[k] + ey[k] * ey[k] || 1) };
}

/**
 * How far along segment k its point nearest (ax + px, ay + py) lies, as a share of it: that point's offset from it is
 * then (px - ex·share, py - ey·share).
 */
export const stampSegmentShare = ({ ex, ey, length2 }: StampSegments, k: number, px: number, py: number) =>
  Math.min(1, Math.max(0, (px * ex[k] + py * ey[k]) / length2[k]));

/**
 * The square of how far (x, y) lies from segment k: the one point-to-segment distance every reader of an outline
 * takes. Squared, as the nearest of several is found by comparing these (two equidistant to a rounding of their roots
 * still differ here).
 */
export function stampSegmentDistanceSquared(segments: StampSegments, k: number, x: number, y: number): number {
  const px = x - segments.ax[k], py = y - segments.ay[k], along = stampSegmentShare(segments, k, px, py);
  const ox = px - segments.ex[k] * along, oy = py - segments.ey[k] * along;
  return ox * ox + oy * oy;
}

/** Whether (x, y) lies inside `polygon` (even-odd): the crossings of its row past x, odd. */
export function stampPolygonInside(polygon: readonly StampPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let k = 0, n = polygon.length; k < n; k++) {
    const a = polygon[k], b = polygon[(k + 1) % n];
    if ((a.y > y) !== (b.y > y) && x < a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

/** Each polygon's segments, made once: a region's distance is read per pixel by gates and figures. */
const segmentsOfPolygon = new WeakMap<readonly StampPoint[], StampSegments>();

/** The square of how far (x, y) is from `polygon`'s outline. */
function stampOutlineDistanceSquared(polygon: readonly StampPoint[], x: number, y: number): number {
  const segments = segmentsOfPolygon.get(polygon) ?? segmentsOfPolygon.set(polygon, stampSegmentsOf(polygon)).get(polygon)!;
  let nearest = Infinity;
  for (let k = 0; k < polygon.length; k++) nearest = Math.min(nearest, stampSegmentDistanceSquared(segments, k, x, y));
  return nearest;
}

/** How far (x, y) is from `polygon`'s outline, positive inside it (even-odd), negative outside. */
export function stampPolygonDistance(polygon: readonly StampPoint[], x: number, y: number): number {
  const nearest = Math.sqrt(stampOutlineDistanceSquared(polygon, x, y));
  return stampPolygonInside(polygon, x, y) ? nearest : -nearest;
}

/**
 * How far (x, y) is from the outline of a region of `rings`, every ring's segments, positive inside it, negative
 * outside. The rings read even-odd: one inside another is a hole, one inside a hole an island.
 */
export function stampRingsDistance(rings: readonly (readonly StampPoint[])[], x: number, y: number): number {
  let nearest = Infinity, inside = false;
  for (const ring of rings) {
    nearest = Math.min(nearest, stampOutlineDistanceSquared(ring, x, y));
    if (stampPolygonInside(ring, x, y)) inside = !inside;
  }
  return inside ? Math.sqrt(nearest) : -Math.sqrt(nearest);
}

/** The side of line a→b point p lies on: positive one way, negative the other, 0 on it. */
const sideOfLine = (a: StampPoint, b: StampPoint, p: StampPoint) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

/** Whether closed rings `a` and `b` cross: a segment of each strictly crosses one of the other. Touching isn't crossing. */
export function stampRingsCross(a: readonly StampPoint[], b: readonly StampPoint[]): boolean {
  const boxA = stampPolygonBox(a), boxB = stampPolygonBox(b);
  if (boxA.x1 < boxB.x0 || boxB.x1 < boxA.x0 || boxA.y1 < boxB.y0 || boxB.y1 < boxA.y0) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const r = b[j], s = b[(j + 1) % b.length];
      if (sideOfLine(p, q, r) * sideOfLine(p, q, s) < 0 && sideOfLine(r, s, p) * sideOfLine(r, s, q) < 0) return true;
    }
  }
  return false;
}

/**
 * A field sampled at the corners of cells `cell` px a side from (x0, y0): `columns` × `rows` values, row by row, the
 * value at column i, row j standing at (x0 + i·cell, y0 + j·cell).
 */
export type StampGrid = { x0: number; y0: number; cell: number; columns: number; rows: number; values: Float32Array };

/**
 * A grid's points in tiles `side` points square, `columns` × `rows` of them row by row, each marked: 0 where the grid
 * is read point by point, else wholly one value, 1 above every level a reader asks of it, 2 below.
 */
export type StampGridTiles = { side: number; columns: number; rows: number; far: Uint8Array };

/**
 * Each row of a `columns` × `rows` grid split at its `tiles`' edges into runs alike, left to right, rows in order:
 * `visit(j, i0, i1, mark)` for points i0..i1 - 1 of row j, `mark` their tiles' (0 for the band's, read point by point).
 */
export function stampTileRuns(tiles: StampGridTiles, columns: number, rows: number, visit: (j: number, i0: number, i1: number, mark: number) => void): void {
  const { side, far } = tiles;
  for (let j = 0; j < rows; j++) {
    const row = Math.floor(j / side) * tiles.columns;
    for (let t = 0; t < tiles.columns;) {
      const mark = far[row + t];
      let end = t + 1;
      while (end < tiles.columns && far[row + end] === mark) end++;
      visit(j, t * side, Math.min(columns, end * side), mark);
      t = end;
    }
  }
}

/**
 * A polygon's signed distance on a grid, with the outline segment each grid point is nearest (-1 past its band), and
 * its tiles past the band: 1 deep inside, 2 outside.
 */
export type StampDistanceGrid = StampGrid & { nearest: Int32Array; tiles: StampGridTiles };

/** Grid points a side of the tiles stampDistanceGrid culls segments by, and tiles a side of the blocks it culls them for first. */
const DISTANCE_TILE = 8, DISTANCE_BLOCK = 8;

/**
 * `polygon`'s signed distance over `box` on a `cell` px grid, as stampPolygonDistance gives it, in a narrow band: a
 * tile wholly deeper than `farthest` px reads `farthest`, one wholly more than `outside` px out reads -`outside`,
 * both nearest -1. Blocks, then tiles, test only segments that could be nearest.
 */
export function stampDistanceGrid(polygon: readonly StampPoint[], box: StampBox, cell: number, farthest = Infinity, outside = farthest): StampDistanceGrid {
  const columns = Math.ceil((box.x1 - box.x0) / cell) + 1, rows = Math.ceil((box.y1 - box.y0) / cell) + 1;
  const values = new Float32Array(columns * rows), nearest = new Int32Array(columns * rows), n = polygon.length;
  const segments = stampSegmentsOf(polygon);
  // The segments of `from` (its first `count`) that could be nearest a point of the `side`-point square at (i, j),
  // into `into`: those within its diagonal (a hair over) of its centre's nearest. How many, or -1 for a square wholly
  // past the band, its limit in `limit` and whether inside in `deep`.
  const centre = new Float64Array(n);
  let limit = 0, deep = false;
  const cull = (from: Int32Array, count: number, into: Int32Array, i: number, j: number, side: number) => {
    const cx = box.x0 + (i + (side - 1) / 2) * cell, cy = box.y0 + (j + (side - 1) / 2) * cell, reach = Math.SQRT2 * (side - 1) * cell;
    let closest = Infinity;
    for (let c = 0; c < count; c++) closest = Math.min(closest, centre[c] = Math.sqrt(stampSegmentDistanceSquared(segments, from[c], cx, cy)));
    // No point of the square is nearer the outline than its centre less half its diagonal, so one clear of the outline
    // lies all on its centre's side.
    const clear = closest - reach / 2;
    deep = clear > Math.min(farthest, outside) && stampPolygonInside(polygon, cx, cy);
    limit = deep ? farthest : outside;
    if (clear > limit) return -1;
    const bound = closest + reach + 1e-6 * (1 + reach);
    let kept = 0;
    for (let c = 0; c < count; c++) if (centre[c] <= bound) into[kept++] = from[c];
    return kept;
  };
  // A square past the band has its tiles marked, filled after.
  const tiles: StampGridTiles = { side: DISTANCE_TILE, columns: Math.ceil(columns / DISTANCE_TILE), rows: Math.ceil(rows / DISTANCE_TILE), far: new Uint8Array(0) };
  tiles.far = new Uint8Array(tiles.columns * tiles.rows);
  const fill = (i0: number, j0: number, side: number) => {
    for (let tj = j0 / DISTANCE_TILE; tj < Math.min(tiles.rows, (j0 + side) / DISTANCE_TILE); tj++) {
      tiles.far.fill(deep ? 1 : 2, tj * tiles.columns + i0 / DISTANCE_TILE, tj * tiles.columns + Math.min(tiles.columns, (i0 + side) / DISTANCE_TILE));
    }
  };
  const all = Int32Array.from(polygon, (_, k) => k), inBlock = new Int32Array(n), inTile = new Int32Array(n), blockSide = DISTANCE_TILE * DISTANCE_BLOCK;
  for (let bj = 0; bj < rows; bj += blockSide) {
    for (let bi = 0; bi < columns; bi += blockSide) {
      const blockCount = cull(all, n, inBlock, bi, bj, blockSide);
      if (blockCount < 0) { fill(bi, bj, blockSide); continue; }
      for (let tj = bj; tj < Math.min(rows, bj + blockSide); tj += DISTANCE_TILE) {
        for (let ti = bi; ti < Math.min(columns, bi + blockSide); ti += DISTANCE_TILE) {
          const tileCount = cull(inBlock, blockCount, inTile, ti, tj, DISTANCE_TILE);
          if (tileCount < 0) { fill(ti, tj, DISTANCE_TILE); continue; }
          for (let j = tj; j < Math.min(rows, tj + DISTANCE_TILE); j++) {
            const y = box.y0 + j * cell, i1 = Math.min(columns, ti + DISTANCE_TILE);
            for (let i = ti; i < i1; i++) {
              const x = box.x0 + i * cell;
              let least = Infinity, segment = 0;
              for (let c = 0; c < tileCount; c++) {
                const squared = stampSegmentDistanceSquared(segments, inTile[c], x, y);
                if (squared < least) { least = squared; segment = inTile[c]; }
              }
              values[j * columns + i] = Math.sqrt(least);
              nearest[j * columns + i] = segment;
            }
          }
        }
      }
    }
  }
  // The band's points signed by each row's crossings: those at or before x are those not past it, as
  // stampPolygonInside's x < crossing counts them. Past the band, a square's limit, signed: one clear of the outline
  // lies all on its centre's side, as the crossings would find each point.
  let crossings: number[] = [], before = 0;
  stampTileRuns(tiles, columns, rows, (j, i0, i1, mark) => {
    const y = box.y0 + j * cell;
    if (i0 === 0) {
      crossings = [];
      before = 0;
      for (let k = 0; k < n; k++) {
        const a = polygon[k], b = polygon[(k + 1) % n];
        if ((a.y > y) !== (b.y > y)) crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
      crossings.sort((a, b) => a - b);
    }
    if (mark) {
      values.fill(mark === 1 ? farthest : -outside, j * columns + i0, j * columns + i1);
      nearest.fill(-1, j * columns + i0, j * columns + i1);
      return;
    }
    for (let i = i0; i < i1; i++) {
      const x = box.x0 + i * cell;
      while (before < crossings.length && crossings[before] <= x) before++;
      if ((crossings.length - before) % 2 === 0) values[j * columns + i] = -values[j * columns + i];
    }
  });
  return { x0: box.x0, y0: box.y0, cell, columns, rows, values, nearest, tiles };
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
 * Rings laid out for ringsDistance: each ring's point count as a header point (count, 0), then its points. An area
 * whose points are such a run has STAMP_RINGED_COUNT set in its count.
 */
export const stampRingsLayout = (rings: readonly (readonly StampPoint[])[]): StampPoint[] => rings.flatMap((ring) => [{ x: ring.length, y: 0 }, ...ring]);

/** The high bit of an area's point count: set, its points are a stampRingsLayout run rather than one polygon. */
export const STAMP_RINGED_COUNT = 0x80000000;

/**
 * stampPolygonDistance in WGSL: the polygon's `count` points from `first` in the storage array `points`, which the
 * shader including it declares. Twins, both at runtime: the CPU's lays out a fill's grids, the GPU's reads regions per
 * pixel; the GPU gate holds them together. ringsDistance twins stampRingsDistance over a stampRingsLayout run of
 * `total` points from `first`.
 */
export const STAMP_POLYGON_DISTANCE_WGSL = /* wgsl */ `
struct RingReach { nearest: f32, inside: bool }
fn ringReach(p: vec2f, first: u32, count: u32, was: RingReach) -> RingReach {
  var reach = was;
  var j = first + count - 1u;
  for (var i = first; i < first + count; i++) {
    let a = points[j];
    let b = points[i];
    let e = b - a;
    let q = p - a;
    let along = clamp(dot(q, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
    let d = q - e * along;
    reach.nearest = min(reach.nearest, dot(d, d));
    if ((a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) / (b.y - a.y) * e.x) { reach.inside = !reach.inside; }
    j = i;
  }
  return reach;
}
fn polygonDistance(p: vec2f, first: u32, count: u32) -> f32 {
  let reach = ringReach(p, first, count, RingReach(1e30, false));
  return select(-sqrt(reach.nearest), sqrt(reach.nearest), reach.inside);
}
fn ringsDistance(p: vec2f, first: u32, total: u32) -> f32 {
  var reach = RingReach(1e30, false);
  var at = first;
  while (at < first + total) {
    let count = u32(points[at].x);
    reach = ringReach(p, at + 1u, count, reach);
    at += count + 1u;
  }
  return select(-sqrt(reach.nearest), sqrt(reach.nearest), reach.inside);
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
 * is near there (the radius of the widest disc inside it, close by).
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
 * Where `grid` crosses `level`, as closed loops (marching squares, crossings linear along cell sides). A loop off
 * the border is left open, so callers pad the grid below the level. A saddle joins by the cell's mean, so loops
 * never cross. A cell with every corner in `uniform` tiles marked alike (one side of the level) is skipped.
 */
export function stampGridContours(grid: StampGrid, level: number, uniform?: StampGridTiles): StampPoint[][] {
  const { columns, rows, values, x0, y0, cell } = grid;
  const at = (i: number, j: number) => values[j * columns + i] - level;
  // A crossing on a cell side, keyed by the side: horizontal sides (i, j)–(i+1, j) and vertical (i, j)–(i, j+1).
  const point = (i: number, j: number, horizontal: boolean): StampPoint => {
    const a = at(i, j), b = horizontal ? at(i + 1, j) : at(i, j + 1), t = a / (a - b);
    return horizontal ? { x: x0 + (i + t) * cell, y: y0 + j * cell } : { x: x0 + i * cell, y: y0 + (j + t) * cell };
  };
  // A side's key: (j·columns + i)·2, + 1 for a vertical side.
  const key = (i: number, j: number, horizontal: boolean) => (j * columns + i) * 2 + (horizontal ? 0 : 1);
  // Each segment runs from one side to another, with the inside on its left, so loops chain head to tail.
  const next = new Map<number, number>();
  const segment = (from: number, to: number) => next.set(from, to);
  const above = (p: number) => (values[p] - level > 0 ? 1 : 0);
  // The cells of a row with corners in tiles marked alike above and below (each tile column's shared mark, or 0), as
  // tiles: a run of them is passed over but for its last cell, whose right corners lie in the next run.
  const tiles = uniform ?? { side: columns, columns: 1, rows: Math.ceil(rows / columns), far: new Uint8Array(Math.ceil(rows / columns)) };
  const shared = new Uint8Array(tiles.columns);
  for (let j = 0; j + 1 < rows; j++) {
    const upperTiles = Math.floor(j / tiles.side) * tiles.columns, lowerTiles = Math.floor((j + 1) / tiles.side) * tiles.columns;
    for (let t = 0; t < tiles.columns; t++) shared[t] = tiles.far[upperTiles + t] === tiles.far[lowerTiles + t] ? tiles.far[upperTiles + t] : 0;
    for (let t = 0; t < tiles.columns;) {
      let end = t + 1;
      while (end < tiles.columns && shared[end] === shared[t]) end++;
      const i0 = shared[t] ? Math.max(t * tiles.side, end * tiles.side - 1) : t * tiles.side, i1 = Math.min(columns - 1, end * tiles.side);
      if (i0 < i1) scan(j, i0, i1);
      t = end;
    }
  }
  // Cells i0..i1 - 1 of row j: each cell's left corners are the last one's right.
  function scan(j: number, i0: number, i1: number) {
    let upper = above(j * columns + i0), lower = above(j * columns + columns + i0);
    for (let i = i0; i < i1; i++) {
      const p = j * columns + i, upperRight = above(p + 1), lowerRight = above(p + columns + 1);
      const code = (upper << 3) | (upperRight << 2) | (lowerRight << 1) | lower;
      upper = upperRight;
      lower = lowerRight;
      if (code === 0 || code === 15) continue;
      const top = key(i, j, true), right = key(i + 1, j, false), bottom = key(i, j + 1, true), left = key(i, j, false);
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
      const side = k >> 1, i = side % columns;
      loop.push(point(i, (side - i) / columns, (k & 1) === 0));
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

/**
 * The per-pixel formulas a region is read by, in WGSL, included after COVERAGE_FORMULAS_WGSL (they call tipNoiseAt).
 * `edgeNoise` is what a ragged edge moves its outline by.
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
}`;

/** Cells a grown outline's grid spans across its longer side, at most: its corners round to a few px of a sky's. */
const GROWN_CELLS = 400;

/**
 * `polygon` grown `by` px outward, concavities and all, as its distance's level set at `-by`: corners round, as a
 * brush rounds them. Where the growth would enclose a hole (a C closing on itself), the hole is filled: only the
 * outer loop is kept, as what a grown fill covers is clipped anyway.
 */
export function stampGrownPolygon(polygon: readonly StampPoint[], by: number): readonly StampPoint[] {
  if (!(by > 0)) return polygon;
  const box = stampPolygonBox(polygon), side = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const cell = Math.max(1, by / 4, side / GROWN_CELLS);
  const loops = stampGridContours(stampDistanceGrid(polygon, stampPolygonBox(polygon, by + 2 * cell), cell), -by);
  return loops.reduce((outer, loop) => (loopArea(loop) > loopArea(outer) ? loop : outer));
}

/** A closed loop's area, twice over, by the shoelace sum: only ever compared. */
const loopArea = (loop: readonly StampPoint[]) => Math.abs(loop.reduce((sum, a, i) => sum + a.x * loop[(i + 1) % loop.length].y - loop[(i + 1) % loop.length].x * a.y, 0));

/** An edge's width: 1 px, antialiased, unless it's soft. */
export const stampEdgeWidth = (edge?: StampEdge) => Math.max(1, edge?.soft ?? 0);

/** How far past its outline an edge can reach, px: half its width, and its ragged amount. */
export const stampEdgeReach = (edge?: StampEdge) => stampEdgeWidth(edge) / 2 + (edge?.ragged?.amount ?? 0);

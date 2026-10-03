// stamp-footprint.ts: a mark's footprint, its reach each way at one diameter, and how far it clears an outline: the
// one room model every fill keeps in by (stamp-fill-plan.ts, stamp-fill-strokes.ts). A footprint is read along
// STAMP_BRUSH_EDGE_WAYS ways; against an outline it is parted from each nearby segment by its own sides, the
// segment's normal or the ways to its ends, whichever parts them most.
import { STAMP_BRUSH_EDGE_WAYS, stampBrushRoundAt, type StampBrushEdgeReach } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { stampGridAt, stampSegmentDistanceSquared, stampSegmentsOf, stampTileRuns, type StampDistanceGrid, type StampGrid, type StampPoint, type StampSegments } from './stamp-region.ts';

/**
 * Which way a mark heads as its footprint is read. `outline`: an edge run, its right side to the outline as
 * stampGridContours' loops run. `any`: a mark that may run either way along its line (a ridge, a row that turns back,
 * a scribble's loops). A number: a mark heading that way, radians.
 */
export type StampMarkHeading = 'outline' | 'any' | number;

/**
 * How far a mark heading `heading` reaches toward `angle`, its sides reaching `right` and `left` that way. A turning tip
 * keeps each side's reach on its half, the other's reaching ahead as a half disc would: the end cap isn't measured
 * (vid-154). Reaches must be ≥ 0.
 */
function markReach(heading: StampMarkHeading, angle: number, right: number, left: number): number {
  if (heading === 'outline') return right;
  if (heading === 'any') return Math.max(right, left);
  const ahead = Math.abs(Math.cos(angle - heading));
  return Math.sin(angle - heading) > 0 ? Math.max(right, left * ahead) : Math.max(left, right * ahead);
}

/** How far a mark heading `heading` reaches toward `angle` (radians, y down), px, each side read between its ways. */
export const stampMarkReach = (edge: StampBrushEdgeReach, heading: StampMarkHeading, angle: number) =>
  markReach(heading, angle, stampBrushRoundAt(edge.right, angle), stampBrushRoundAt(edge.left, angle));

/** A mark's reach toward each of its edge's ways (STAMP_BRUSH_EDGE_WAYS), k turns in that many: its support. */
export function stampMarkSupport(edge: StampBrushEdgeReach, heading: StampMarkHeading): number[] {
  const support: number[] = [];
  for (let k = 0; k < STAMP_BRUSH_EDGE_WAYS; k++) support.push(markReach(heading, (k * 2 * Math.PI) / STAMP_BRUSH_EDGE_WAYS, edge.right[k], edge.left[k]));
  return support;
}

/**
 * The unit ways `n` evenly round and each pair's cosine, made once a count; and for each way u the ways facing it
 * (cosine above 1e-9), nearest first: facing[u·n .. u·n + facingCount[u]).
 */
type StampWays = { x: Float64Array; y: Float64Array; cos: Float64Array; facing: Int32Array; facingCount: Int32Array };
const stampWaysOf = new Map<number, StampWays>();
function stampWays(n: number): StampWays {
  const known = stampWaysOf.get(n);
  if (known) return known;
  const x = Float64Array.from({ length: n }, (_, k) => Math.cos((k * 2 * Math.PI) / n)), y = Float64Array.from({ length: n }, (_, k) => Math.sin((k * 2 * Math.PI) / n));
  const cos = new Float64Array(n * n), facing = new Int32Array(n * n), facingCount = new Int32Array(n);
  for (let u = 0; u < n; u++) for (let v = 0; v < n; v++) cos[u * n + v] = x[u] * x[v] + y[u] * y[v];
  for (let u = 0; u < n; u++) {
    const near = Array.from({ length: n }, (_, v) => v).filter((v) => cos[u * n + v] > 1e-9).toSorted((a, b) => cos[u * n + b] - cos[u * n + a]);
    facing.set(near, u * n);
    facingCount[u] = near.length;
  }
  const ways = { x, y, cos, facing, facingCount };
  stampWaysOf.set(n, ways);
  return ways;
}

/** Whether `support` is alike every way: a disc, its reach exactly its support. */
const isDisc = (support: readonly number[]) => support.every((h) => h === support[0]);

/**
 * How near a footprint with `support` comes any way, px, as stampFootprintExtent finds it. With every way's support
 * positive the least is some way's own support over its own cosine (any other way's lies a 32nd of a turn off, so at
 * least 1.9% farther), found without the other ways.
 */
function footprintNearest(support: readonly number[]): number {
  const n = support.length, { cos } = stampWays(n);
  let nearest = Infinity, positive = true;
  for (let u = 0; u < n; u++) {
    positive &&= support[u] > 0;
    nearest = Math.min(nearest, support[u] / cos[u * n + u]);
  }
  return positive && n >= 8 ? nearest : stampFootprintExtent(support).nearest;
}

/**
 * How near and far a footprint with `support` comes any way, px, and whether it is a disc (alike every way, its reach
 * then exactly its support's). Elsewhere each way's reach is the least of its support over the cosine to each side
 * facing within a quarter turn.
 */
export function stampFootprintExtent(support: readonly number[]): { disc: boolean; nearest: number; farthest: number } {
  const n = support.length;
  if (isDisc(support)) return { disc: true, nearest: support[0], farthest: support[0] };
  const { cos, facing, facingCount } = stampWays(n);
  let nearest = Infinity, farthest = -Infinity, least = Infinity;
  for (const h of support) least = Math.min(least, h);
  for (let u = 0; u < n; u++) {
    // Nearest way first: with no support below zero, a way whose cosine leaves even the least support past the
    // radial so far can't lower it, nor can any after it.
    let radial = Infinity;
    for (let f = u * n; f < u * n + facingCount[u]; f++) {
      const v = facing[f], c = cos[u * n + v];
      if (least >= 0 && least / c >= radial) break;
      radial = Math.min(radial, support[v] / c);
    }
    nearest = Math.min(nearest, radial);
    farthest = Math.max(farthest, radial);
  }
  return { disc: false, nearest, farthest };
}

/**
 * An outline as footprints are read against it: its segments (their ends, runs and outward normals with their
 * angles), and the segments touching each bucket `side` px square over its box, bucket b's at
 * members[starts[b]..starts[b + 1]).
 */
export type StampOutline = Readonly<StampSegments & {
  side: number; bx0: number; by0: number; columns: number; rows: number; starts: Int32Array; members: Int32Array;
  bx: Float64Array; by: Float64Array; nx: Float64Array; ny: Float64Array; out: Float64Array; back: Float64Array;
}>;

/**
 * Segments near a point as a footprint reads them: `count` of `segments`, each with the least it may be parted by
 * (`bounds`: its distance less the footprint's widest support, held off by rounding; Infinity past the footprint's
 * reach), and `first`, the one likeliest to cross, -1 for none.
 */
type StampOutlineNear = { count: number; segments: Int32Array; bounds: Float64Array; first: number };

/**
 * What footprints read against one outline keep between reads: the read each segment was last met in (one met in
 * several buckets weighed once), the last bucket's segments, and the point last read with its probe, its segments
 * nearest first, for a point read twice running (a ridge's size solved there).
 */
type StampOutlineScratch = {
  reads: number; met: Int32Array; asked: { x: number; y: number };
  gathered: StampOutlineNear & { i: number; j: number; span: number };
  probe: StampOutlineNear & { x: number; y: number; span: number; ring: Int32Array; distance: Float64Array };
};
const outlineScratch = new WeakMap<StampOutline, StampOutlineScratch>();

export function stampOutlineOf(polygon: readonly StampPoint[], side: number): StampOutline {
  const m = polygon.length, cellOf = (v: number) => Math.floor(v / side), segments = stampSegmentsOf(polygon), { ax, ay } = segments;
  const bx = Float64Array.from(polygon, (_, k) => polygon[(k + 1) % m].x), by = Float64Array.from(polygon, (_, k) => polygon[(k + 1) % m].y);
  const bx0 = cellOf(Math.min(...ax)), by0 = cellOf(Math.min(...ay)), columns = cellOf(Math.max(...ax)) - bx0 + 1, rows = cellOf(Math.max(...ay)) - by0 + 1;
  // Each segment in every bucket its box touches: counted, then laid out bucket by bucket.
  const eachBucket = (k: number, visit: (b: number) => void) => {
    for (let j = cellOf(Math.min(ay[k], by[k])); j <= cellOf(Math.max(ay[k], by[k])); j++) {
      for (let i = cellOf(Math.min(ax[k], bx[k])); i <= cellOf(Math.max(ax[k], bx[k])); i++) visit((j - by0) * columns + i - bx0);
    }
  };
  const starts = new Int32Array(columns * rows + 1);
  for (let k = 0; k < m; k++) eachBucket(k, (b) => starts[b + 1]++);
  for (let b = 0; b < columns * rows; b++) starts[b + 1] += starts[b];
  const members = new Int32Array(starts[columns * rows]), filled = starts.slice(0, -1);
  for (let k = 0; k < m; k++) eachBucket(k, (b) => { members[filled[b]++] = k; });
  const nx = new Float64Array(m), ny = new Float64Array(m), out = new Float64Array(m), back = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const length = Math.hypot(bx[k] - ax[k], by[k] - ay[k]) || 1;
    nx[k] = (by[k] - ay[k]) / length;
    ny[k] = (ax[k] - bx[k]) / length;
    out[k] = Math.atan2(ny[k], nx[k]);
    back[k] = Math.atan2(-ny[k], -nx[k]);
  }
  const outline: StampOutline = { ...segments, side, bx0, by0, columns, rows, starts, members, bx, by, nx, ny, out, back };
  const near = () => ({ count: 0, segments: new Int32Array(m), bounds: new Float64Array(m), first: -1 });
  outlineScratch.set(outline, {
    reads: 0, met: new Int32Array(m).fill(-1), asked: { x: NaN, y: NaN },
    gathered: { ...near(), i: NaN, j: NaN, span: NaN },
    probe: { ...near(), x: NaN, y: NaN, span: -1, ring: new Int32Array(m), distance: new Float64Array(m) },
  });
  return outline;
}

/**
 * A mark's footprint against an outline: how far it clears the outline at a point given its distance there, negative
 * where it crosses. It reads the segments within its farthest reach and `margin`; past that it takes the distance less
 * its farthest reach.
 */
export type StampFootprint = {
  /** Its least and most reach any way, px. */
  readonly nearest: number;
  readonly farthest: number;
  /** How far past its farthest reach it still reads the outline, px. */
  readonly margin: number;
  /** The most support any way, px: no segment is parted by less than its distance less this. */
  readonly widest: number;
  eroded: (distance: number, x: number, y: number) => number;
  /** Whether `eroded` there exceeds `by`: every segment near parted by more by some way, its size never summed. */
  clears: (distance: number, x: number, y: number, by: number) => boolean;
};

/**
 * The segments touching an outline's buckets within `span` of bucket (i0, j0), each once (a long one sits in several),
 * into its `gathered`: points in one bucket read the same, so a fill's grid gathers once a bucket.
 */
function gatherOutline(outline: StampOutline, scratch: StampOutlineScratch, i0: number, j0: number, span: number): void {
  const { columns, rows, starts, members } = outline, { met, gathered } = scratch, read = ++scratch.reads;
  let count = 0;
  for (let j = Math.max(0, j0 - span); j <= Math.min(rows - 1, j0 + span); j++) {
    for (let i = Math.max(0, i0 - span); i <= Math.min(columns - 1, i0 + span); i++) {
      for (let at = starts[j * columns + i], end = starts[j * columns + i + 1]; at < end; at++) {
        const k = members[at];
        if (met[k] !== read) { met[k] = read; gathered.segments[count++] = k; }
      }
    }
  }
  gathered.i = i0;
  gathered.j = j0;
  gathered.span = span;
  gathered.count = count;
}

/** An outline's probe at (x, y), reading `span` buckets out: ring by ring, so each segment keeps the nearest it touches. */
function probeOutline(outline: StampOutline, scratch: StampOutlineScratch, x: number, y: number, span: number): void {
  const { side, bx0, by0, columns, rows, starts, members } = outline, { met, probe } = scratch, read = ++scratch.reads;
  const i0 = Math.floor(x / side) - bx0, j0 = Math.floor(y / side) - by0, { segments, ring, distance } = probe;
  // In order of distance as met.
  let count = 0;
  for (let r = 0; r <= span; r++) {
    for (let j = j0 - r; j <= j0 + r; j++) {
      for (let i = i0 - r; i <= i0 + r; i += j === j0 - r || j === j0 + r ? 1 : 2 * r) {
        if (i < 0 || j < 0 || i >= columns || j >= rows) continue;
        for (let at = starts[j * columns + i], end = starts[j * columns + i + 1]; at < end; at++) {
          const k = members[at];
          if (met[k] === read) continue;
          met[k] = read;
          const d = Math.sqrt(stampSegmentDistanceSquared(outline, k, x, y));
          let c = count++;
          for (; c > 0 && distance[c - 1] > d; c--) {
            segments[c] = segments[c - 1];
            ring[c] = ring[c - 1];
            distance[c] = distance[c - 1];
          }
          segments[c] = k;
          ring[c] = r;
          distance[c] = d;
        }
      }
    }
  }
  Object.assign(probe, { x, y, span, count });
}

/** Px a segment's distance bound is held off by, far more than its rounding over a painting's coordinates. */
const STAMP_PARTING_ROUNDING = 1e-6;

/**
 * A footprint made cheaply, as a ridge's size is solved at hundreds of diameters a fill: its farthest reach (a pass
 * over every pair of ways) is found only when a point lies deep enough to need it.
 */
class OutlineFootprint implements StampFootprint {
  readonly nearest: number;
  readonly #outline: StampOutline;
  readonly #scratch: StampOutlineScratch;
  readonly #support: readonly number[];
  readonly margin: number;
  readonly #disc: boolean;
  readonly widest: number;
  #farthest = NaN;
  #span = 0;

  constructor(outline: StampOutline, support: readonly number[], margin: number) {
    this.#outline = outline;
    this.#scratch = outlineScratch.get(outline)!;
    this.#support = support;
    this.margin = margin;
    this.#disc = isDisc(support);
    this.nearest = this.#disc ? support[0] : footprintNearest(support);
    let widest = -Infinity;
    for (const h of support) widest = Math.max(widest, h);
    this.widest = widest;
  }

  get farthest(): number {
    if (Number.isNaN(this.#farthest)) {
      this.#farthest = this.#disc ? this.#support[0] : stampFootprintExtent(this.#support).farthest;
      this.#span = Math.ceil((this.#farthest + this.margin) / this.#outline.side);
    }
    return this.#farthest;
  }

  eroded(distance: number, x: number, y: number): number {
    // Nearer the outline than its nearest reach the footprint crosses it; past its farthest and the margin, it never
    // does; a disc clears it by the distance less its reach.
    if (this.#disc || distance < this.nearest) return distance - this.nearest;
    if (distance >= this.farthest + this.margin) return distance - this.farthest;
    return this.#lowest(x, y, distance - this.nearest, -Infinity);
  }

  clears(distance: number, x: number, y: number, by: number): boolean {
    if (this.#disc || distance < this.nearest) return distance - this.nearest > by;
    if (distance >= this.farthest + this.margin) return distance - this.farthest > by;
    return this.#lowest(x, y, distance - this.nearest, by) > by;
  }

  /**
   * How far the footprint at (x, y) is parted from segment k along its own sides, the segment's normal, or the way to
   * an end, each that way's least projection less the support there: the most, or once past `stop`, some value past
   * it. Any order gives the same most.
   */
  #parting(k: number, x: number, y: number, stop: number): number {
    const { ax: sax, ay: say, bx: sbx, by: sby, nx, ny, out, back } = this.#outline, h = this.#support, n = h.length, { x: wx, y: wy } = stampWays(n);
    const ax = sax[k] - x, ay = say[k] - y, bx = sbx[k] - x, by = sby[k] - y, toward = nx[k] * ax + ny[k] * ay;
    let most = toward > 0 ? toward - stampBrushRoundAt(this.#support, out[k]) : -toward - stampBrushRoundAt(this.#support, back[k]);
    for (let u = 0; u < n && most <= stop; u++) most = Math.max(most, Math.min(wx[u] * ax + wy[u] * ay, wx[u] * bx + wy[u] * by) - h[u]);
    for (let end = 0; end < 2 && most <= stop; end++) {
      const px = end ? bx : ax, py = end ? by : ay, length = Math.hypot(px, py) || 1, ux = px / length, uy = py / length;
      most = Math.max(most, Math.min(ux * ax + uy * ay, ux * bx + uy * by) - stampBrushRoundAt(this.#support, Math.atan2(uy, ux)));
    }
    return most;
  }

  /**
   * The segments near (x, y) with their bounds (StampOutlineNear): on a point's second read running, its probe, read
   * once for every footprint asked there; else its bucket's segments, gathered once a bucket.
   */
  #near(x: number, y: number): StampOutlineNear {
    const scratch = this.#scratch, { asked, probe, gathered } = scratch, span = this.#span, widest = this.widest;
    if (asked.x === x && asked.y === y) {
      if (probe.x !== x || probe.y !== y || probe.span < span) probeOutline(this.#outline, scratch, x, y, span);
      // Nearest first, so the first is likeliest to cross.
      for (let c = 0; c < probe.count; c++) probe.bounds[c] = probe.ring[c] <= span ? probe.distance[c] - widest - STAMP_PARTING_ROUNDING : Infinity;
      probe.first = probe.count ? 0 : -1;
      return probe;
    }
    asked.x = x;
    asked.y = y;
    const { side, bx0, by0 } = this.#outline, i0 = Math.floor(x / side) - bx0, j0 = Math.floor(y / side) - by0;
    if (gathered.i !== i0 || gathered.j !== j0 || gathered.span !== span) gatherOutline(this.#outline, scratch, i0, j0, span);
    const { count, segments, bounds } = gathered;
    gathered.first = -1;
    for (let c = 0; c < count; c++) {
      bounds[c] = Math.sqrt(stampSegmentDistanceSquared(this.#outline, segments[c], x, y)) - widest - STAMP_PARTING_ROUNDING;
      if (gathered.first < 0 || bounds[c] < bounds[gathered.first]) gathered.first = c;
    }
    return gathered;
  }

  /**
   * The least, from `start`, over the segments near (x, y) of how far each is parted (#parting), the likeliest to cross
   * first; a segment whose bound passes the least so far is passed over. With `by` above -Infinity, only its side
   * matters: segments are weighed against it, and the first at or under it ends the read.
   */
  #lowest(x: number, y: number, start: number, by: number): number {
    let lowest = start;
    if (!(lowest > by)) return lowest;
    const settles = by > -Infinity, { count, segments, bounds, first } = this.#near(x, y);
    for (let o = -1; o < count; o++) {
      const c = o < 0 ? first : o;
      if (c < 0 || (o >= 0 && c === first)) continue;
      const stop = settles ? by : lowest;
      if (bounds[c] > stop) continue;
      lowest = Math.min(lowest, this.#parting(segments[c], x, y, stop));
      if (settles && !(lowest > by)) return lowest;
    }
    return lowest;
  }
}

export const stampFootprintAgainst = (outline: StampOutline, support: readonly number[], margin: number): StampFootprint =>
  new OutlineFootprint(outline, support, margin);

/**
 * Where a mark keeps its paint inside an outline: `footprint`, its footprint heading `heading` against it, made once a
 * heading; `keepsIn`, whether that footprint centred at (x, y) clears the outline by more than `by` px, read at the
 * outline's distance there. A flood's rows and a strokes fill's marks keep in by it.
 */
export type StampFootprintKeepsIn = {
  footprint: (heading: StampMarkHeading) => StampFootprint;
  keepsIn: (x: number, y: number, heading: StampMarkHeading, by?: number) => boolean;
};

/**
 * StampFootprintKeepsIn for a mark reaching as `edge` says, against `outline`, at `distance` (its signed distance, read
 * by stampGridAt), each footprint reading `margin` px past its reach. A heading is kept as given: a caller asking at
 * many rounds them first.
 */
export function stampFootprintKeepsIn(outline: StampOutline, distance: StampGrid, edge: StampBrushEdgeReach, margin: number): StampFootprintKeepsIn {
  const footprints = new Map<StampMarkHeading, StampFootprint>();
  // A fill's rows mostly head one way, so the last heading's footprint is kept to hand.
  let last: { heading: StampMarkHeading; footprint: StampFootprint } | null = null;
  const footprint = (heading: StampMarkHeading) => {
    if (last?.heading !== heading) {
      last = { heading, footprint: footprints.get(heading) ?? footprints.set(heading, stampFootprintAgainst(outline, stampMarkSupport(edge, heading), margin)).get(heading)! };
    }
    return last.footprint;
  };
  return { footprint, keepsIn: (x, y, heading, by = 0) => footprint(heading).clears(stampGridAt(distance, x, y), x, y, by) };
}

/**
 * Px a bounded point's distance is held off by: far more than a Float32 distance's rounding over a painting, so its
 * bound lies under its clearance.
 */
const STAMP_CONTOUR_BOUND_MARGIN = 0.01;

/**
 * `field`, an outline's signed distance, eroded by `footprint` and raised by `inset`: its level `inset` runs where the
 * footprint just keeps inside. Exact only near that level: a point surely clear with all 8 neighbours above the inset
 * holds a bound instead, above it, until `exact` reads it. Its sign, and every value beside a crossing, hold.
 */
export type StampEdgeContourField = { grid: StampGrid; bounded: Uint8Array; exact: (p: number) => number };

export function stampEdgeContourField(field: StampDistanceGrid, footprint: StampFootprint, inset: number): StampEdgeContourField {
  const { columns, rows, values, nearest, x0, y0, cell, tiles } = field, eroded = new Float32Array(values.length);
  const { nearest: least, farthest, margin, widest } = footprint, reads = farthest + margin;
  // A footprint alike every way reads its clearance at once, so it's never bounded.
  const lopsided = widest > least, bounded = new Uint8Array(values.length), held: number[] = [];
  const exact = (p: number) => {
    if (bounded[p]) {
      const i = p % columns, j = (p - i) / columns;
      eroded[p] = footprint.eroded(values[p], x0 + i * cell, y0 + j * cell) + inset;
      bounded[p] = 0;
    }
    return eroded[p];
  };
  // A point nearer the outline than the footprint's nearest reach, or deeper than its farthest and the margin, is read
  // without asking it; past the band, a point inside reads as deeper than it reaches. One it would ask, surely clear,
  // takes its bound for now.
  stampTileRuns(tiles, columns, rows, (j, i0, i1, mark) => {
    const row = j * columns, d = values[row + i0];
    if (mark && (d > 0 || d < least)) {
      eroded.fill(d > 0 ? d - farthest + inset : d - least + inset, row + i0, row + i1);
      return;
    }
    for (let i = i0; i < i1; i++) {
      const p = row + i, dp = values[p];
      if (nearest[p] < 0 ? dp > 0 : dp >= reads) eroded[p] = dp - farthest + inset;
      else if (dp < least) eroded[p] = dp - least + inset;
      else if (lopsided && Math.fround(dp - widest - STAMP_CONTOUR_BOUND_MARGIN + inset) > inset) {
        eroded[p] = dp - widest - STAMP_CONTOUR_BOUND_MARGIN + inset;
        bounded[p] = 1;
        held.push(p);
      } else eroded[p] = footprint.eroded(dp, x0 + i * cell, y0 + j * cell) + inset;
    }
  });
  // Beside a point at or under the inset, a crossing's or a saddle's corners are read: those bounds made exact.
  for (const p of held) {
    const i = p % columns, j = (p - i) / columns;
    let beside = false;
    for (let dj = -1; dj <= 1 && !beside; dj++) {
      for (let di = -1; di <= 1 && !beside; di++) {
        const qi = i + di, qj = j + dj;
        beside = qi >= 0 && qj >= 0 && qi < columns && qj < rows && eroded[qj * columns + qi] <= inset;
      }
    }
    if (beside) exact(p);
  }
  return { grid: { x0, y0, cell, columns, rows, values: eroded }, bounded, exact };
}

// stamp-fill-plan.ts: the strokes a flood's brush lays to reach its outline (vid-119), from one clearance field.
//
// One room model for every mark: a footprint (a mark's reach each way at a diameter, stampMarkSupport) clears the
// outline where the region, eroded by it, stays positive. The edge contour runs on that eroded outline; a medial point
// is a ridge's where the full footprint doesn't fit, sized to the largest diameter whose own footprint does, and
// dropped where even the smallest diameter's doesn't. What the plan drops (spurs, stray parts, a contour loop too thin
// for two) it weighs as coverage lost against paint laid past the outline.
import type { StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';
import type { StampBrushEdgeReach } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import {
  stampEdgeContourField, stampFootprintAgainst, stampFootprintExtent, stampFootprintKeepsIn, stampMarkSupport, stampOutlineOf, type StampFootprint, type StampFootprintKeepsIn,
} from './stamp-footprint.ts';
import { stampFloodRowTurned, stampFloodTurned, type StampFloodRowTurned } from './stamp-flood-rows.ts';
import {
  stampDistanceGrid, stampGridAt, stampGridContours, stampPolygonBox, stampPolygonDistance, stampSegmentDistanceSquared, stampSegmentShare, stampSegmentsOf, stampTileRuns, type StampDistanceGrid, type StampGrid, type StampPoint,
} from './stamp-region.ts';

/** How a brush's paint reaches, as a fill plans with it. */
export type StampFloodReach = {
  /**
   * The visible offset at a diameter, both sides' mean over every heading, px: how far a firm stroke's paint reaches
   * from its centreline. Non-decreasing.
   */
  offset: (diameter: number) => number;
  /** The visible offset at a diameter toward every way by side: a lopsided or squarish tip's own, which may change with size. */
  edge: (diameter: number) => StampBrushEdgeReach;
  /** The fill's diameter, px. */
  diameter: number;
  /**
   * The least diameter a ridge narrows to, px: the brush's smallest measured one, as below it the profile says
   * nothing of how far its paint reaches.
   */
  smallest: number;
};

/**
 * A stroke of a flood's plan: its points, a closed run repeating its first last, laid in order. Contour points carry no
 * scale (1); ridge points each their own.
 */
export type StampFloodRun = { points: StampStrokePoint[] };

export type StampFloodRuns = {
  /** The edge contour's distance from the outline, px: o(d). */
  inset: number;
  /** Px a side of the plan's grid: the finest its room is read at. */
  cell: number;
  /** Where a row keeps in, the way it heads. */
  keepsIn: StampFootprintKeepsIn['keepsIn'];
  /** Which way a row runs. */
  rowTurned: StampFloodRowTurned;
  /** Each run its own stroke, lifted between: the contour's loops, then the ridge graph's branches, loops and dabs. */
  runs: StampFloodRun[];
  /**
   * The share of the diameter its water's effects reach by, the tool's local scale: each point at its nearest run
   * point's, so the body round a run carries its scale.
   */
  scale: StampGrid;
};

/** The loss tolerance as a share of the visible offset: inside the soft edge a brush's paint fades over. */
const STAMP_FLOOD_LOSS_SHARE = 0.15;

/**
 * The most outline, px, a plan inset `inset` on a grid `cell` px across may leave short of its paint: a spur or a
 * contour loop that would add less goes.
 */
export const stampFloodLoss = (inset: number, cell: number) => Math.max(cell, STAMP_FLOOD_LOSS_SHARE * inset);

/** Where `holds` turns false along 0..1 (true at 0, false at 1), to within `tolerance`. */
function bisect(holds: (t: number) => boolean, tolerance: number): number {
  let lo = 0, hi = 1;
  while (hi - lo > tolerance) {
    const t = (lo + hi) / 2;
    if (holds(t)) lo = t; else hi = t;
  }
  return (lo + hi) / 2;
}

/** The medial graph: points with their inscribed radius, `anchor` a pinch where a ridge meets the contour. */
type Medial = { x: number[]; y: number[]; r: number[]; anchor: boolean[]; links: Set<number>[]; alive: boolean[] };

const addPoint = (g: Medial, x: number, y: number, r: number, anchor = false) => {
  g.x.push(x); g.y.push(y); g.r.push(r); g.anchor.push(anchor); g.links.push(new Set()); g.alive.push(true);
  return g.x.length - 1;
};
const link = (g: Medial, a: number, b: number) => {
  if (a !== b) { g.links[a].add(b); g.links[b].add(a); }
};
const unlinkPoint = (g: Medial, a: number) => {
  for (const b of g.links[a]) g.links[b].delete(a);
  g.links[a].clear();
  g.alive[a] = false;
};
const gap = (g: Medial, a: number, b: number) => Math.hypot(g.x[a] - g.x[b], g.y[a] - g.y[b]);

/**
 * The medial axis on `grid`: a crossing on each side whose ends lie inside and whose nearest outline points are more
 * than `significance` apart, placed to a 64th of the side where its two segments are equidistant; each cell joins its
 * crossings.
 */
function medialAxis(polygon: readonly StampPoint[], grid: StampDistanceGrid, significance: number): Medial {
  const { columns, rows, values, nearest, x0, y0, cell } = grid;
  const g: Medial = { x: [], y: [], r: [], anchor: [], links: [], alive: [] };
  const segments = stampSegmentsOf(polygon), { ax, ay, ex, ey } = segments;
  // Side ids: (j·columns + i)·2 for (i, j)–(i+1, j), + 1 for (i, j)–(i, j+1). Few sides cross, so a map.
  const crossings = new Map<number, number>(), crossed: number[] = [];
  const crossing = (side: number) => crossings.get(side) ?? -1;
  const cross = (p: number, q: number, side: number) => {
    if (values[p] <= 0 || values[q] <= 0) return;
    const a = nearest[p], b = nearest[q];
    if (a === b || a < 0 || b < 0) return;
    const px = x0 + (p % columns) * cell, py = y0 + Math.floor(p / columns) * cell;
    const qx = x0 + (q % columns) * cell, qy = y0 + Math.floor(q / columns) * cell;
    // The two feet: each end less its offset from its nearest segment.
    const pax = px - ax[a], pay = py - ay[a], ta = stampSegmentShare(segments, a, pax, pay);
    const qbx = qx - ax[b], qby = qy - ay[b], tb = stampSegmentShare(segments, b, qbx, qby);
    if (Math.hypot(px - (pax - ex[a] * ta) - qx + (qbx - ex[b] * tb), py - (pay - ey[a] * ta) - qy + (qby - ey[b] * tb)) <= significance) return;
    // a is nearest at p and b at q, so their difference changes sign between: the medial point.
    const t = bisect((s) => stampSegmentDistanceSquared(segments, a, px + (qx - px) * s, py + (qy - py) * s) < stampSegmentDistanceSquared(segments, b, px + (qx - px) * s, py + (qy - py) * s), 1 / 64);
    const x = px + (qx - px) * t, y = py + (qy - py) * t;
    crossings.set(side, addPoint(g, x, y, Math.sqrt(stampSegmentDistanceSquared(segments, a, x, y))));
    crossed.push(side);
  };
  // Past the band (nearest -1) or outside, no side from a point crosses: most of a big region's grid, passed by tile.
  stampTileRuns(grid.tiles, columns, rows, (j, i0, i1, mark) => {
    if (mark) return;
    for (let p = j * columns + i0; p < j * columns + i1; p++) {
      const k = nearest[p];
      if (k < 0 || values[p] <= 0) continue;
      if (p + 1 < (j + 1) * columns && nearest[p + 1] !== k) cross(p, p + 1, p * 2);
      if (j + 1 < rows && nearest[p + columns] !== k) cross(p, p + columns, p * 2 + 1);
    }
  });
  // The cells beside a crossing, in grid order: a side's cell below or right of it, and the one above or left.
  const beside = new Set<number>();
  for (const side of crossed) {
    const p = side >> 1;
    beside.add(p).add(side & 1 ? p - 1 : p - columns);
  }
  for (const p of [...beside].toSorted((a, b) => a - b)) {
    const i = p % columns, j = (p - i) / columns;
    if (i < 0 || j < 0 || i + 1 >= columns || j + 1 >= rows) continue;
    const here = [crossing(p * 2), crossing((p + columns) * 2), crossing(p * 2 + 1), crossing((p + 1) * 2 + 1)].filter((k) => k >= 0);
    if (here.length === 2) link(g, here[0], here[1]);
    else if (here.length > 2) {
      const x = here.reduce((s, k) => s + g.x[k], 0) / here.length, y = here.reduce((s, k) => s + g.y[k], 0) / here.length;
      const junction = addPoint(g, x, y, Math.abs(stampPolygonDistance(polygon, x, y)));
      for (const k of here) link(g, junction, k);
    }
  }
  for (let k = 0; k < g.x.length; k++) if (!g.links[k].size) g.alive[k] = false;
  return g;
}

/** A path through points of degree 2, from a stop (any other degree, or an anchor) to the next stop. */
type Branch = { points: number[]; length: number };

const isStop = (g: Medial, k: number) => g.anchor[k] || g.links[k].size !== 2;

/** Every branch of `g` once, stop to stop, then its loops of degree-2 points (closed, first repeated last). */
function branchesOf(g: Medial): { open: Branch[]; closed: Branch[] } {
  // A step from point a to b, walked, keyed as one number.
  const count = g.x.length, step = (a: number, b: number) => a * count + b;
  const walked = new Set<number>(), open: Branch[] = [], closed: Branch[] = [], onBranch = new Uint8Array(count);
  const walk = (from: number, first: number): Branch => {
    const points = [from];
    let previous = from, here = first, length = gap(g, from, first);
    walked.add(step(from, first));
    for (;;) {
      points.push(here);
      onBranch[here] = 1;
      if (isStop(g, here)) break;
      let next = -1;
      for (const k of g.links[here]) if (k !== previous) { next = k; break; }
      length += gap(g, here, next);
      previous = here;
      here = next;
      if (here === from && !isStop(g, here)) { points.push(here); break; }
    }
    walked.add(step(here, previous));
    return { points, length };
  };
  for (let k = 0; k < g.x.length; k++) {
    if (!g.alive[k] || !isStop(g, k)) continue;
    onBranch[k] = 1;
    for (const n of [...g.links[k]].toSorted((a, b) => a - b)) if (!walked.has(step(k, n))) open.push(walk(k, n));
  }
  for (let k = 0; k < g.x.length; k++) {
    if (!g.alive[k] || onBranch[k]) continue;
    const first = Math.min(...g.links[k]);
    closed.push(walk(k, first));
  }
  return { open, closed };
}

/** Merges each branch between two junctions under two cells' diagonal, a cluster the grid makes of one, into one. */
function collapseJunctions(polygon: readonly StampPoint[], g: Medial, cell: number): void {
  for (let merged = true; merged;) {
    merged = false;
    for (const { points, length } of branchesOf(g).open) {
      const a = points[0], b = points.at(-1)!;
      if (a === b || g.links[a].size < 3 || g.links[b].size < 3 || !points.every((k) => g.alive[k])) continue;
      if (length > 2 * Math.SQRT2 * cell) continue;
      const x = (g.x[a] + g.x[b]) / 2, y = (g.y[a] + g.y[b]) / 2;
      const junction = addPoint(g, x, y, Math.abs(stampPolygonDistance(polygon, x, y)));
      const outside = new Set<number>();
      for (const k of points) for (const n of g.links[k]) if (!points.includes(n)) outside.add(n);
      for (const k of points) unlinkPoint(g, k);
      for (const n of outside) link(g, junction, n);
      merged = true;
    }
  }
}

/** `g`'s connected parts, each its live points. */
function partsOf(g: Medial): number[][] {
  const seen = new Set<number>(), parts: number[][] = [];
  for (let k = 0; k < g.x.length; k++) {
    if (!g.alive[k] || seen.has(k)) continue;
    const part = [k];
    seen.add(k);
    for (let i = 0; i < part.length; i++) for (const n of g.links[part[i]]) if (!seen.has(n)) { seen.add(n); part.push(n); }
    parts.push(part);
  }
  return parts;
}

/**
 * The plan's runs for a fill of `polygon` by a brush that reaches as `reach` says: its edge contour at the visible
 * offset, and ridges down its narrow parts, each a stroke of its own.
 */
export function planStampFloodRuns(polygon: readonly StampPoint[], reach: StampFloodReach): StampFloodRuns {
  const { offset, edge, diameter, smallest } = reach;
  // The contour's loops have the outline on their right; turned, they run back, read as the edge's mirror.
  const turned = stampFloodTurned(edge(diameter), 'right');
  // Mirroring swaps the sides without turning the heading, so it holds for an edge run or a mark either way only.
  const support = (d: number, heading: 'outline' | 'any') => {
    const { left, right } = edge(d);
    return stampMarkSupport(turned ? { left: right, right: left } : { left, right }, heading);
  };
  const inset = offset(diameter), smallestOffset = offset(smallest), floor = smallest / diameter;
  // A ridge may run either way along it, at any diameter down to the smallest: its footprint at each, remembered, as
  // its size is solved point by point.
  const ridgeSupports = new Map<number, number[]>();
  const ridgeSupport = (d: number) => ridgeSupports.get(d) ?? ridgeSupports.set(d, support(d, 'any')).get(d)!;
  const smallestFootprint = stampFootprintExtent(ridgeSupport(smallest));
  const smallestReach = smallestFootprint.disc ? smallestOffset : smallestFootprint.nearest;
  // Fine enough that the narrowest ridge, a stroke at the floor, spans two cells, but no finer than a pixel.
  const cell = Math.min(2, Math.max(1, smallestReach / 2));
  const loss = stampFloodLoss(inset, cell), outward = support(diameter, 'outline'), farthest = Math.max(...outward);
  // A narrow band: deeper than the farthest reach by more than the loss and two cells, the field is never read but as
  // `held` and above the inset; more than two cells outside, but as outside, as no point beside one reaches the inset.
  const field = stampDistanceGrid(polygon, stampPolygonBox(polygon, inset + 2 * cell), cell, farthest + loss + 2 * cell, 2 * cell);
  // The edge contour runs at its level `inset`, where the edge stroke's footprint just keeps inside.
  const outline = stampOutlineOf(polygon, stampFootprintExtent(outward).farthest + 2 * cell);
  const footprint = stampFootprintAgainst(outline, outward, 2 * cell);
  const ridgeFootprints = new Map<number, StampFootprint>();
  const ridgeAt = (d: number) => ridgeFootprints.get(d) ?? ridgeFootprints.set(d, stampFootprintAgainst(outline, ridgeSupport(d), 2 * cell)).get(d)!;
  // How far a stroke `d` across, on a ridge point `r` deep, clears the outline: it fits where this is positive.
  const roomAt = (x: number, y: number, r: number, d: number) => ridgeAt(d).eroded(r, x, y);
  const fitsAt = (x: number, y: number, r: number, d: number) => ridgeAt(d).clears(r, x, y, 0);
  const contour = stampEdgeContourField(field, footprint, inset), contourField = contour.grid, { columns, rows, values } = contourField;

  // The contour's parts: the grid above the inset by 4-connected part, each with its widest point; one within `loss`
  // of the inset is too thin for two strokes, so it collapses to its ridge. Past the band inside is part 0, held.
  // A point's part: `walked[p] - 1` once walked, 0 if it lies deep (read from the field), else -1.
  const walked = new Int32Array(values.length), deep = (p: number) => field.nearest[p] < 0 && field.values[p] > 0;
  const partOf = (p: number) => {
    if (walked[p]) return walked[p] - 1;
    return deep(p) ? 0 : -1;
  };
  const widest: number[] = [Infinity], stack: number[] = [], boundWalked: number[] = [];
  let walking = 0, peak = 0;
  const spread = (q: number) => {
    if (values[q] <= inset) return;
    if (!walked[q] && !deep(q)) { walked[q] = walking + 1; stack.push(q); } else peak = Math.max(peak, values[q]);
  };
  // No part starts in a tile past the band: deep inside is part 0, outside lies below the inset.
  stampTileRuns(field.tiles, columns, rows, (j, i0, i1, mark) => {
    if (mark) return;
    for (let start = j * columns + i0; start < j * columns + i1; start++) {
      if (values[start] <= inset || walked[start] || deep(start)) continue;
      walking = widest.length;
      peak = values[start];
      walked[start] = walking + 1;
      stack.push(start);
      while (stack.length) {
        const p = stack.pop()!, i = p % columns, row = (p - i) / columns;
        peak = Math.max(peak, values[p]);
        if (contour.bounded[p]) boundWalked.push(p);
        if (i > 0) spread(p - 1);
        if (i + 1 < columns) spread(p + 1);
        if (row > 0) spread(p - columns);
        if (row + 1 < rows) spread(p + columns);
      }
      widest.push(peak);
    }
  });
  // A bound is under its value, so a part held by its bounds is held; one that isn't is judged by its values.
  const thin = widest.map((most) => most - inset < loss);
  for (const p of boundWalked) if (thin[walked[p] - 1]) widest[walked[p] - 1] = Math.max(widest[walked[p] - 1], contour.exact(p));
  const held = widest.map((most) => most - inset >= loss);
  // Only a part too thin to hold is lowered below the inset, so its contour loop goes; most plans have none.
  let lowered = values;
  if (held.includes(false)) {
    lowered = new Float32Array(values);
    for (let p = 0; p < values.length; p++) if (walked[p] && !held[walked[p] - 1]) lowered[p] = inset - 1e-3;
  }
  // Past the band, the clearance lies wholly above the inset deep inside and below it outside.
  const contours = stampGridContours({ ...contourField, values: lowered }, inset, field.tiles);

  // The contour owns a medial point its edge stroke's footprint clears the outline at, in a held part's cell.
  const contourOwns = (x: number, y: number, r: number) => {
    if (!footprint.clears(r, x, y, 0)) return false;
    const i = Math.min(columns - 2, Math.max(0, Math.floor((x - field.x0) / cell))), j = Math.min(rows - 2, Math.max(0, Math.floor((y - field.y0) / cell)));
    let top = -1;
    const corners = [j * columns + i, j * columns + i + 1, (j + 1) * columns + i, (j + 1) * columns + i + 1];
    // Compared by value, so none is left a bound.
    for (const p of corners) contour.exact(p);
    for (const p of corners) if (top < 0 || values[p] > values[top]) top = p;
    const part = partOf(top);
    return part >= 0 && held[part];
  };

  const g = medialAxis(polygon, field, 2 * cell);
  collapseJunctions(polygon, g, cell);

  // Split at the pinches: each link from a contour-owned point to a ridge point gets an anchor where the edge
  // stroke's footprint just clears the outline, linear along the link.
  const owned = g.x.map((_, k) => g.alive[k] && contourOwns(g.x[k], g.y[k], g.r[k]));
  const edgeRoom = (k: number) => footprint.eroded(g.r[k], g.x[k], g.y[k]);
  for (let k = 0; k < owned.length; k++) {
    if (!owned[k]) continue;
    const here = edgeRoom(k);
    for (const n of g.links[k]) {
      if (owned[n]) continue;
      const there = edgeRoom(n), t = Math.min(1, Math.max(0, here > there ? -there / (here - there) : 0.5));
      const lerp = (a: number[]) => a[n] + (a[k] - a[n]) * t;
      const anchor = addPoint(g, lerp(g.x), lerp(g.y), lerp(g.r), true);
      link(g, anchor, n);
    }
    unlinkPoint(g, k);
  }

  // A ridge narrows no further than the brush's smallest diameter fits: where the region is thinner, it ends where
  // that stroke's footprint just keeps inside, so its paint stops at the outline rather than crossing it.
  const roomOf = (k: number, d: number) => roomAt(g.x[k], g.y[k], g.r[k], d);
  for (let k = 0, count = g.x.length; k < count; k++) {
    if (!g.alive[k]) continue;
    const here = roomOf(k, smallest);
    if (here >= 0) continue;
    for (const n of g.links[k]) {
      const there = roomOf(n, smallest);
      if (there < 0) continue;
      const t = -here / (there - here), lerp = (a: number, b: number) => a + (b - a) * t;
      link(g, addPoint(g, lerp(g.x[k], g.x[n]), lerp(g.y[k], g.y[n]), lerp(g.r[k], g.r[n])), n);
    }
    unlinkPoint(g, k);
  }

  // A point's scale: the share of the diameter whose footprint just fits its room, held to the floor and 1, found to a
  // 16th of a cell in diameter, the footprint read afresh at each diameter tried.
  const scaleOf = (k: number) => {
    if (roomOf(k, diameter) >= 0) return 1;
    if (roomOf(k, smallest) <= 0) return floor;
    return (smallest + (diameter - smallest) * bisect((t) => fitsAt(g.x[k], g.y[k], g.r[k], smallest + (diameter - smallest) * t), cell / 16 / (diameter - smallest))) / diameter;
  };
  // How far a point's paint reaches toward the outline: its radius less the room its footprint leaves, none where it's
  // sized to just fit, past it where even the smallest crosses. An anchor's is its radius, where the contour's meets it.
  // Pruning asks of every pair of points, and adds none, so each is read once.
  const visibleOf = new Float64Array(g.x.length).fill(NaN);
  const visible = (k: number) => {
    if (Number.isNaN(visibleOf[k])) {
      const full = g.anchor[k] ? 0 : roomOf(k, diameter);
      visibleOf[k] = g.r[k] - (full >= 0 ? full : Math.min(0, roomOf(k, smallest)));
    }
    return visibleOf[k];
  };

  // Pruning, least loss first: a candidate's `cut` goes while no disc of its `points` reaches more than `loss` past
  // `reach(k)`, how far other paint reaches past point k.
  type Candidate = { points: number[]; cut: number[]; reach: (k: number) => number };
  const prune = (candidates: () => Candidate[]) => {
    for (;;) {
      let cut: number[] | null = null, leastLost = Infinity;
      for (const candidate of candidates()) {
        let lost = -Infinity;
        // Past the loss it can't be cut, however much more it loses.
        for (const k of candidate.points) if ((lost = Math.max(lost, g.r[k] - candidate.reach(k))) >= loss) break;
        if (lost < loss && lost < leastLost) { cut = candidate.cut; leastLost = lost; }
      }
      if (!cut) return;
      for (const k of cut) unlinkPoint(g, k);
    }
  };

  // Spurs: a branch from a free tip to a junction or a pinch, judged against the paint its attachment lays.
  const free = (k: number) => !g.anchor[k] && g.links[k].size === 1;
  prune(() => branchesOf(g).open.flatMap(({ points }): Candidate[] => {
    const path = free(points[0]) ? points : points.toReversed(), to = path.at(-1)!;
    if (!free(path[0]) || path[0] === to || !(g.anchor[to] || g.links[to].size >= 3)) return [];
    return [{ points: path, cut: g.anchor[to] ? path : path.slice(0, -1), reach: (k) => visible(to) - gap(g, k, to) }];
  }));

  // A ridge part touching no pinch is cut off from the axis by a shallow corner, or is the whole of a narrow region,
  // judged against the contour's paint and every other part's.
  // Each contour point's paint reaches the outline, its own distance from it, as its footprint just clears there.
  const side = Math.max(4 * cell, inset), contourPaint = stampPaintReach(contours.flat().map(({ x, y }) => ({ x, y, r: stampGridAt(field, x, y), part: -1 })), side);
  const contourReachOf = new Map<number, number>();
  // The contour never changes, and pruning asks again on every pass.
  const contourReach = (k: number) => {
    if (!contourReachOf.has(k)) contourReachOf.set(k, contourPaint(g.x[k], g.y[k]));
    return contourReachOf.get(k)!;
  };
  prune(() => {
    const parts = partsOf(g), lone = parts.filter((part) => !part.some((k) => g.anchor[k]));
    if (!lone.length) return [];
    const ridgePaint = stampPaintReach(parts.flatMap((part, i) => part.map((k) => ({ x: g.x[k], y: g.y[k], r: visible(k), part: i }))), side);
    return lone.map((part) => {
      const own = parts.indexOf(part);
      return { points: part, cut: part, reach: (k: number) => Math.max(contourReach(k), ridgePaint(g.x[k], g.y[k], own)) };
    });
  });
  extendTips(polygon, g, cell, (x, y, r) => fitsAt(x, y, r, smallest));

  const point = (k: number): StampStrokePoint => ({ x: g.x[k], y: g.y[k], scale: scaleOf(k) });
  const { open, closed } = branchesOf(g);
  const runs: StampFloodRun[] = [
    ...contours.map((loop) => ({ points: turned ? [loop[0], ...loop.toReversed()] : [...loop, loop[0]] })),
    ...[...open, ...closed].map(({ points }) => ({ points: points.map(point) })),
  ];
  // A lone point is a dab.
  for (let k = 0; k < g.x.length; k++) if (g.alive[k] && !g.links[k].size) runs.push({ points: [point(k), point(k)] });
  return {
    inset, cell, runs, scale: floodScale(field, runs),
    keepsIn: stampFootprintKeepsIn(outline, field, edge(diameter), 2 * cell).keepsIn,
    rowTurned: stampFloodRowTurned(field, edge(diameter), 2 * cell),
  };
}

/** A bucket's key, `i` and `j` buckets from the origin. */
const bucketKey = (i: number, j: number) => (j + 0x8000) * 0x10000 + i + 0x8000;

/** A point whose paint reaches `r` px round it, one of `part`'s. */
type StampPaintPoint = { x: number; y: number; r: number; part: number };

/**
 * How far past (x, y) the paint of `points` reaches, all but part `except`'s (-Infinity for none), exactly: the
 * points bucketed `side` px square, read ring by ring out from (x, y)'s bucket until none past the ring could reach
 * farther.
 */
function stampPaintReach(points: readonly StampPaintPoint[], side: number): (x: number, y: number, except?: number) => number {
  const buckets = new Map<number, StampPaintPoint[]>();
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, widest = -Infinity;
  for (const point of points) {
    const i = Math.floor(point.x / side), j = Math.floor(point.y / side);
    const key = bucketKey(i, j);
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(point);
    left = Math.min(left, i); top = Math.min(top, j); right = Math.max(right, i); bottom = Math.max(bottom, j);
    widest = Math.max(widest, point.r);
  }
  return (x, y, except = -2) => {
    const i0 = Math.floor(x / side), j0 = Math.floor(y / side);
    // Past ring r every point lies at least r - 1 buckets off; past the points' own box, none.
    const rings = Math.max(i0 - left, right - i0, j0 - top, bottom - j0);
    let most = -Infinity;
    for (let ring = 0; ring <= rings && most < widest - (ring - 1) * side; ring++) {
      for (let j = j0 - ring; j <= j0 + ring; j++) {
        for (let i = i0 - ring; i <= i0 + ring; i += j === j0 - ring || j === j0 + ring ? 1 : 2 * ring) {
          for (const c of buckets.get(bucketKey(i, j)) ?? []) if (c.part !== except) most = Math.max(most, c.r - Math.hypot(c.x - x, c.y - y));
        }
      }
    }
    return most;
  };
}

/** Px a side of the grid a plan's local scale is kept on, which the wet field reads per pixel. */
const STAMP_FLOOD_SCALE_CELL = 4;

/**
 * `runs`' local scale over `field`'s box (StampFloodRuns' scale): each point at its nearest run point's, found by a
 * two-pass sweep carrying each point's nearest point on to its neighbours (near enough to the exact nearest).
 */
function floodScale(field: StampGrid, runs: readonly StampFloodRun[]): StampGrid {
  const step = Math.max(1, Math.round(STAMP_FLOOD_SCALE_CELL / field.cell)), cell = field.cell * step;
  const columns = Math.ceil(field.columns / step), rows = Math.ceil(field.rows / step), n = columns * rows;
  const values = new Float32Array(n).fill(1), grid = { x0: field.x0, y0: field.y0, cell, columns, rows, values };
  const points = runs.flatMap((run) => run.points);
  // Every point at the whole diameter, as a plan with no narrow ridge is, leaves every point at it.
  if (points.every((point) => (point.scale ?? 1) === 1)) return grid;
  const nearest = new Int32Array(n).fill(-1), d2 = new Float64Array(n).fill(Infinity);
  const px = new Float64Array(points.length), py = new Float64Array(points.length);
  for (let k = 0; k < points.length; k++) {
    px[k] = points[k].x - field.x0;
    py[k] = points[k].y - field.y0;
  }
  // A neighbour's nearest that is already the point's own can't be nearer, and most are.
  const offer = (p: number, i: number, j: number, k: number) => {
    if (k === nearest[p]) return;
    const dx = px[k] - i * cell, dy = py[k] - j * cell, d = dx * dx + dy * dy;
    if (d < d2[p]) { d2[p] = d; nearest[p] = k; }
  };
  points.forEach(({ x, y }, k) => {
    const i = Math.round((x - field.x0) / cell), j = Math.round((y - field.y0) / cell);
    if (i >= 0 && j >= 0 && i < columns && j < rows) offer(j * columns + i, i, j, k);
  });
  // Forward, each point takes its left, upper-left, upper and upper-right neighbours' nearest; backward, the mirror.
  for (const order of [1, -1]) {
    for (let jj = 0; jj < rows; jj++) {
      const j = order > 0 ? jj : rows - 1 - jj, b = j - order;
      for (let ii = 0; ii < columns; ii++) {
        const i = order > 0 ? ii : columns - 1 - ii, p = j * columns + i, a = i - order;
        if (a >= 0 && a < columns && nearest[j * columns + a] >= 0) offer(p, i, j, nearest[j * columns + a]);
        if (b < 0 || b >= rows) continue;
        if (a >= 0 && a < columns && nearest[b * columns + a] >= 0) offer(p, i, j, nearest[b * columns + a]);
        if (nearest[b * columns + i] >= 0) offer(p, i, j, nearest[b * columns + i]);
        if (i + order >= 0 && i + order < columns && nearest[b * columns + i + order] >= 0) offer(p, i, j, nearest[b * columns + i + order]);
      }
    }
  }
  for (let p = 0; p < n; p++) values[p] = points[nearest[p]].scale ?? 1;
  return grid;
}

/**
 * Each free tip within two cells of the outline carried on the way it heads while it stays that thin, until the
 * outline is a quarter cell off or the smallest stroke no longer `fits`: the grid finds no axis that thin, as a sharp
 * end is. A tip deeper in was cut at a shallow corner, and stays.
 */
function extendTips(polygon: readonly StampPoint[], g: Medial, cell: number, fits: (x: number, y: number, r: number) => boolean): void {
  const count = g.x.length;
  for (let tip = 0; tip < count; tip++) {
    if (!g.alive[tip] || g.anchor[tip] || g.links[tip].size !== 1 || g.r[tip] > 2 * cell) continue;
    // Its heading from a point two cells back along its branch, or its neighbour.
    let back = [...g.links[tip]][0], previous = tip;
    while (gap(g, tip, back) < 2 * cell && g.links[back].size === 2 && !g.anchor[back]) {
      const next = [...g.links[back]].find((k) => k !== previous)!;
      previous = back;
      back = next;
    }
    const length = gap(g, tip, back);
    if (!length) continue;
    const ux = (g.x[tip] - g.x[back]) / length, uy = (g.y[tip] - g.y[back]) / length;
    let end = tip;
    for (let s = 1; ; s++) {
      const x = g.x[tip] + ux * s * cell / 2, y = g.y[tip] + uy * s * cell / 2, r = stampPolygonDistance(polygon, x, y);
      if (r <= cell / 4 || r > 2 * cell || !fits(x, y, r)) break;
      const added = addPoint(g, x, y, r);
      link(g, end, added);
      end = added;
    }
  }
}

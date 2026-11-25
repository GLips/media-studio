// subject-three-raster.ts: the numeric half of projecting meshes to a subject, free of three.js. Triangles already
// projected to the page are rasterised, one buffer per draw unit (a mesh's range under one material), with depth
// interpolated correctly for perspective and normals renormalised. Masks over the sample grid are traced into rings
// and runs. subject-three.ts walks the scene and decides what each unit is.

import { stampGridContours, stampRingArea, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { SubjectSampleLayout } from './subject-evidence.ts';
import type { SubjectPathRun, SubjectRing } from './subject-geometry.ts';

/** Samples `i0..i1` × `j0..j1`, inclusive, on the layout. */
export type SubjectRasterBox = { readonly i0: number; readonly j0: number; readonly i1: number; readonly j1: number };

/**
 * A draw unit's triangles on the page. `screen`: x, y per vertex (px); `depth`: view depth per vertex (scene units,
 * above 0); `normals`: view-space unit normals per vertex, given for units whose surface is evidence.
 */
export type SubjectRasterTriangles = {
  readonly screen: Float64Array;
  readonly depth: Float64Array;
  readonly normals?: Float32Array;
  readonly corners: Uint32Array;
  /** +1 when a front face winds with a positive screen cross product (y down), -1 when negative. */
  readonly frontSign: 1 | -1;
  /** Which faces draw: three's FrontSide, BackSide or DoubleSide. A back face drawn has its normal turned to the viewer. */
  readonly faces: { readonly front: boolean; readonly back: boolean };
};

/** What one unit covers: per sample in `box`, its nearest depth (Infinity where it misses) and normal there. */
export type SubjectRasterUnit = { readonly box: SubjectRasterBox; readonly depth: Float32Array; readonly normals?: Float32Array };

const boxSize = ({ i0, j0, i1, j1 }: SubjectRasterBox) => (i1 - i0 + 1) * (j1 - j0 + 1);

/** The samples a unit's vertices span, clipped to the layout; undefined when it falls off the page. */
function rasterBoxOf(layout: SubjectSampleLayout, screen: Float64Array): SubjectRasterBox | undefined {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let v = 0; v < screen.length; v += 2) {
    x0 = Math.min(x0, screen[v]); x1 = Math.max(x1, screen[v]);
    y0 = Math.min(y0, screen[v + 1]); y1 = Math.max(y1, screen[v + 1]);
  }
  const i0 = Math.max(0, Math.ceil((x0 - layout.x0) / layout.cell)), i1 = Math.min(layout.columns - 1, Math.floor((x1 - layout.x0) / layout.cell));
  const j0 = Math.max(0, Math.ceil((y0 - layout.y0) / layout.cell)), j1 = Math.min(layout.rows - 1, Math.floor((y1 - layout.y0) / layout.cell));
  return i0 <= i1 && j0 <= j1 ? { i0, j0, i1, j1 } : undefined;
}

/**
 * Rasterises `units` (each a list of triangle sets sharing one buffer) at the layout's sample points. Depth is
 * interpolated as 1/z, the perspective-correct way, and so are normals, which are then renormalised.
 */
export function rasterSubjectUnit(layout: SubjectSampleLayout, sets: readonly SubjectRasterTriangles[]): SubjectRasterUnit | undefined {
  const boxes = sets.flatMap(({ screen }) => rasterBoxOf(layout, screen) ?? []);
  if (!boxes.length) return undefined;
  const box = { i0: Math.min(...boxes.map((b) => b.i0)), j0: Math.min(...boxes.map((b) => b.j0)), i1: Math.max(...boxes.map((b) => b.i1)), j1: Math.max(...boxes.map((b) => b.j1)) };
  const width = box.i1 - box.i0 + 1, depth = new Float32Array(boxSize(box)).fill(Infinity);
  const withNormals = sets.some(({ normals }) => normals);
  const normals = withNormals ? new Float32Array(3 * boxSize(box)) : undefined;
  for (const set of sets) rasterTriangles(layout, box, width, set, depth, normals);
  return normals ? { box, depth, normals } : { box, depth };
}

function rasterTriangles(layout: SubjectSampleLayout, box: SubjectRasterBox, width: number, set: SubjectRasterTriangles, depth: Float32Array, normals: Float32Array | undefined) {
  const { screen, depth: z, normals: n, corners, frontSign, faces } = set, { cell } = layout;
  for (let t = 0; t + 2 < corners.length; t += 3) {
    const a = corners[t], b = corners[t + 1], c = corners[t + 2];
    const ax = screen[2 * a], ay = screen[2 * a + 1], bx = screen[2 * b], by = screen[2 * b + 1], cx = screen[2 * c], cy = screen[2 * c + 1];
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (cross === 0) continue;
    const front = cross * frontSign > 0;
    if (front ? !faces.front : !faces.back) continue;
    const turn = front ? 1 : -1;
    const i0 = Math.max(box.i0, Math.ceil((Math.min(ax, bx, cx) - layout.x0) / cell)), i1 = Math.min(box.i1, Math.floor((Math.max(ax, bx, cx) - layout.x0) / cell));
    const j0 = Math.max(box.j0, Math.ceil((Math.min(ay, by, cy) - layout.y0) / cell)), j1 = Math.min(box.j1, Math.floor((Math.max(ay, by, cy) - layout.y0) / cell));
    const za = 1 / z[a], zb = 1 / z[b], zc = 1 / z[c];
    for (let j = j0; j <= j1; j++) {
      const py = layout.y0 + j * cell;
      for (let i = i0; i <= i1; i++) {
        const px = layout.x0 + i * cell;
        const wb = ((px - ax) * (cy - ay) - (py - ay) * (cx - ax)) / cross, wc = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / cross, wa = 1 - wb - wc;
        if (wa < 0 || wb < 0 || wc < 0) continue;
        // Screen weights over 1/z give the perspective-correct weights: the same over-z sums serve depth and normals.
        const pa = wa * za, pb = wb * zb, pc = wc * zc, inverse = pa + pb + pc, at = (j - box.j0) * width + (i - box.i0);
        const d = 1 / inverse;
        if (d >= depth[at]) continue;
        depth[at] = d;
        if (!normals || !n) continue;
        let nx = pa * n[3 * a] + pb * n[3 * b] + pc * n[3 * c], ny = pa * n[3 * a + 1] + pb * n[3 * b + 1] + pc * n[3 * c + 1], nz = pa * n[3 * a + 2] + pb * n[3 * b + 2] + pc * n[3 * c + 2];
        const length = Math.hypot(nx, ny, nz);
        if (length < 1e-9) [nx, ny, nz] = [0, 0, 1];
        else [nx, ny, nz] = [(turn * nx) / length, (turn * ny) / length, (turn * nz) / length];
        normals.set([nx, ny, nz], 3 * at);
      }
    }
  }
}

/** The unit's depth at layout sample `k`, Infinity where it misses. */
export function subjectRasterDepthAt(layout: SubjectSampleLayout, unit: SubjectRasterUnit, k: number): number {
  const i = k % layout.columns, j = (k - i) / layout.columns, { box } = unit;
  if (i < box.i0 || i > box.i1 || j < box.j0 || j > box.j1) return Infinity;
  return unit.depth[(j - box.j0) * (box.i1 - box.i0 + 1) + (i - box.i0)];
}

/** Per sample, the nearest of `units` (by index, -1 for none), its depth and its normal: what the eye sees. */
export function nearestSubjectRaster(layout: SubjectSampleLayout, units: readonly (SubjectRasterUnit | undefined)[]) {
  const size = layout.columns * layout.rows;
  const unit = new Int32Array(size).fill(-1), depth = new Float32Array(size).fill(Infinity), normals = new Float32Array(3 * size);
  units.forEach((raster, u) => {
    if (!raster) return;
    const { box } = raster, width = box.i1 - box.i0 + 1;
    for (let j = box.j0; j <= box.j1; j++) {
      for (let i = box.i0; i <= box.i1; i++) {
        const local = (j - box.j0) * width + (i - box.i0), k = j * layout.columns + i, d = raster.depth[local];
        if (!(d < depth[k])) continue;
        depth[k] = d;
        unit[k] = u;
        if (raster.normals) normals.set(raster.normals.subarray(3 * local, 3 * local + 3), 3 * k);
      }
    }
  });
  return { unit, depth, normals };
}

/** The layout sample nearest page point `p`, or -1 off the layout. */
export function subjectSampleAt(layout: SubjectSampleLayout, p: StampPoint): number {
  const i = Math.round((p.x - layout.x0) / layout.cell), j = Math.round((p.y - layout.y0) / layout.cell);
  return i >= 0 && j >= 0 && i < layout.columns && j < layout.rows ? j * layout.columns + i : -1;
}

/** A trace's points closer than this share of a cell to the line between their neighbours are dropped. */
const SIMPLIFY_SHARE = 0.25;
/** Loops enclosing under this many cells are the trace's specks, not the subject's. */
const SPECK_CELLS = 2;

/** `points` with every one that lies within `tolerance` of the chord around it dropped (Douglas–Peucker). */
function simplifiedRun(points: readonly StampPoint[], tolerance: number): StampPoint[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop() ?? [0, 0];
    const a = points[from], b = points[to], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    let far = -1, farthest = tolerance;
    for (let k = from + 1; k < to; k++) {
      const p = points[k];
      const off = length > 0 ? Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / length : Math.hypot(p.x - a.x, p.y - a.y);
      if (off > farthest) [far, farthest] = [k, off];
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([from, far], [far, to]);
  }
  return points.filter((_, k) => keep[k] === 1);
}

/** Easing passes over a traced loop: enough to take the stair-steps off a slanted edge, few enough to keep its corners. */
const EASE_PASSES = 3;

/** A traced loop eased by its neighbours, taking the marching squares' stair-steps off a slanted edge. */
function easedLoop(loop: readonly StampPoint[]): StampPoint[] {
  let eased = [...loop];
  for (let pass = 0; pass < EASE_PASSES; pass++) {
    const from = eased;
    eased = from.map((p, k) => {
      const before = from[(k + from.length - 1) % from.length], after = from[(k + 1) % from.length];
      return { x: (before.x + 2 * p.x + after.x) / 4, y: (before.y + 2 * p.y + after.y) / 4 };
    });
  }
  return eased;
}

/** The box of samples where `inside` holds, grown by one sample so traced loops close; undefined when none does. */
function maskBox(layout: SubjectSampleLayout, inside: (k: number) => boolean, within?: SubjectRasterBox): SubjectRasterBox | undefined {
  const scan = within ?? { i0: 0, j0: 0, i1: layout.columns - 1, j1: layout.rows - 1 };
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
  for (let j = scan.j0; j <= scan.j1; j++) {
    for (let i = scan.i0; i <= scan.i1; i++) {
      if (!inside(j * layout.columns + i)) continue;
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
    }
  }
  return i0 <= i1 ? { i0: i0 - 1, j0: j0 - 1, i1: i1 + 1, j1: j1 + 1 } : undefined;
}

/** The loops where `inside` turns, each point with the samples either side of it (-1 for one past the layout). */
function maskLoops(layout: SubjectSampleLayout, inside: (k: number) => boolean, within?: SubjectRasterBox) {
  const box = maskBox(layout, inside, within);
  if (!box) return [];
  const columns = box.i1 - box.i0 + 1, rows = box.j1 - box.j0 + 1, values = new Float32Array(columns * rows);
  const sampleOf = (i: number, j: number) => (i >= 0 && j >= 0 && i < layout.columns && j < layout.rows ? j * layout.columns + i : -1);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const k = sampleOf(i + box.i0, j + box.j0);
      values[j * columns + i] = k >= 0 && inside(k) ? 1 : -1;
    }
  }
  const x0 = layout.x0 + box.i0 * layout.cell, y0 = layout.y0 + box.j0 * layout.cell;
  return stampGridContours({ x0, y0, cell: layout.cell, columns, rows, values }, 0)
    .filter((loop) => Math.abs(stampRingArea(loop)) > SPECK_CELLS * layout.cell ** 2)
    .map((loop) => loop.map((p) => {
      // Values are ±1, so each crossing sits midway along a cell side: the half-integer coordinate names the side.
      const gx = (p.x - layout.x0) / layout.cell, gy = (p.y - layout.y0) / layout.cell;
      const horizontal = Math.abs(gx - Math.round(gx)) > 0.25;
      const a = horizontal ? sampleOf(Math.floor(gx), Math.round(gy)) : sampleOf(Math.round(gx), Math.floor(gy));
      const b = horizontal ? sampleOf(Math.floor(gx) + 1, Math.round(gy)) : sampleOf(Math.round(gx), Math.floor(gy) + 1);
      const aInside = a >= 0 && inside(a);
      return { at: p, inner: aInside ? a : b, outer: aInside ? b : a };
    }));
}

/** The rings of the area where `inside` holds, read even-odd: none when it holds nowhere. */
export function traceSubjectMaskRings(layout: SubjectSampleLayout, inside: (k: number) => boolean, within?: SubjectRasterBox): SubjectRing[] {
  return maskLoops(layout, inside, within).map((loop) => {
    const eased = easedLoop(loop.map(({ at }) => at));
    return simplifiedRun([...eased, eased[0]], SIMPLIFY_SHARE * layout.cell).slice(0, -1);
  }).filter((ring) => ring.length >= 3 && stampRingArea(ring) !== 0);
}

/**
 * The edge of the area where `inside` holds, as runs: only its stretches where `drawn(inner, outer)` holds for the
 * samples either side (outer -1 past the layout). A loop drawn all round is one closed run.
 */
export function traceSubjectMaskEdgeRuns(
  layout: SubjectSampleLayout, inside: (k: number) => boolean, drawn: (inner: number, outer: number) => boolean, within?: SubjectRasterBox,
): SubjectPathRun[] {
  const tolerance = SIMPLIFY_SHARE * layout.cell;
  return maskLoops(layout, inside, within).flatMap((loop): SubjectPathRun[] => {
    const eased = easedLoop(loop.map(({ at }) => at)), marks = loop.map(({ inner, outer }) => drawn(inner, outer));
    if (marks.every(Boolean)) return [{ points: simplifiedRun([...eased, eased[0]], tolerance).slice(0, -1), closed: true }];
    // Start just after an undrawn point, so no drawn stretch is cut in two at the loop's seam.
    const start = marks.indexOf(false), runs: SubjectPathRun[] = [];
    let run: StampPoint[] = [];
    for (let step = 1; step <= loop.length; step++) {
      const k = (start + step) % loop.length;
      if (marks[k]) run.push(eased[k]);
      if (!marks[k] || step === loop.length) {
        if (run.length >= 3) runs.push({ points: simplifiedRun(run, tolerance), closed: false });
        run = [];
      }
    }
    return runs;
  });
}

/** Runs of `points` where `shows` holds, simplified; one closed run when a closed line shows all round. */
export function subjectVisibleRuns(layout: SubjectSampleLayout, points: readonly StampPoint[], shows: readonly boolean[], closed: boolean): SubjectPathRun[] {
  const tolerance = SIMPLIFY_SHARE * layout.cell;
  if (closed && shows.every(Boolean)) return [{ points: simplifiedRun([...points, points[0]], tolerance).slice(0, -1), closed: true }];
  const runs: SubjectPathRun[] = [];
  let run: StampPoint[] = [];
  const flush = () => {
    if (run.length >= 2) runs.push({ points: simplifiedRun(run, tolerance), closed: false });
    run = [];
  };
  points.forEach((p, k) => (shows[k] ? run.push(p) : flush()));
  flush();
  // A closed line seen in part may show across its seam: its last run carries on into its first.
  if (closed && runs.length > 1 && shows[0] && shows[shows.length - 1]) {
    const last = runs.pop(), first = runs.shift();
    if (last && first) runs.unshift({ points: simplifiedRun([...last.points, ...first.points], tolerance), closed: false });
  }
  return runs.filter((kept) => kept.points.length >= (kept.closed ? 3 : 2));
}

/**
 * Signed distance from the edge of the mask `inside`, in px: positive inside, negative out, at least half a cell
 * either way. Chamfered (steps of 1 and √2 cells), which is near enough for coverage. Past the layout counts as out.
 */
export function subjectMaskSignedDistance(layout: SubjectSampleLayout, inside: Uint8Array): Float32Array {
  const { columns, rows, cell } = layout;
  const toward = (target: number) => {
    const d = new Float32Array(columns * rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < columns; i++) {
        const k = j * columns + i;
        // An inside sample on the layout's edge is a cell from the outside past it.
        const border = target === 0 ? Math.min(i + 1, j + 1, columns - i, rows - j) : Infinity;
        d[k] = inside[k] === target ? 0 : border;
      }
    }
    const relax = (k: number, from: number, step: number) => { if (d[from] + step < d[k]) d[k] = d[from] + step; };
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < columns; i++) {
        const k = j * columns + i;
        if (i > 0) relax(k, k - 1, 1);
        if (j > 0) relax(k, k - columns, 1);
        if (i > 0 && j > 0) relax(k, k - columns - 1, Math.SQRT2);
        if (i + 1 < columns && j > 0) relax(k, k - columns + 1, Math.SQRT2);
      }
    }
    for (let j = rows - 1; j >= 0; j--) {
      for (let i = columns - 1; i >= 0; i--) {
        const k = j * columns + i;
        if (i + 1 < columns) relax(k, k + 1, 1);
        if (j + 1 < rows) relax(k, k + columns, 1);
        if (i + 1 < columns && j + 1 < rows) relax(k, k + columns + 1, Math.SQRT2);
        if (i > 0 && j + 1 < rows) relax(k, k + columns - 1, Math.SQRT2);
      }
    }
    return d;
  };
  const toOutside = toward(0), toInside = toward(1), signed = new Float32Array(columns * rows);
  for (let k = 0; k < signed.length; k++) signed[k] = inside[k] ? (toOutside[k] - 0.5) * cell : -(toInside[k] - 0.5) * cell;
  return signed;
}

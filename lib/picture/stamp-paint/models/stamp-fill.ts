// stamp-fill.ts: how a fill covers its region, as a wash or in strokes (StampFillApplication).
//
// Wet paint's build converges inside a region, and only its edge shows the brush. So a wash is a body worked out
// per pixel (washBody) under one stroke of the real brush along the contour half a diameter inside, where its
// stamps' edges touch the outline; a neck narrower than a diameter is the body's alone. The brush's dual is stamped
// along the contour and in rows over the region.
//
// A crayon or a pencil never converges: its marks and the paper between them are the look. So strokes are real
// strokes of the brush in a pattern (stampFillStrokePath), a stroke deposit like any other.

import { seededRandom } from '#lib/picture/motion/models/random.ts';
import type { StampBrush } from './stamp-brush.ts';
import { placeStrokeStamps, type PlacedStamp, type StampStrokePoint } from './stamp-placement.ts';
import { handStampStroke, type StampStrokeHand } from './stamp-stroke-hand.ts';
import {
  stampDistanceGrid, stampGridAt, stampGridContours, stampGridLocalMax, stampPolygonBox, stampRegionPolygon, type StampBox, type StampGrid, type StampPoint, type StampRegion,
} from './stamp-region.ts';

/** Rows of a wash's dual, a quarter diameter apart: close enough that a tip's own falloff doesn't band. */
const DUAL_ROWS = 0.25;

/**
 * A region through `points`, closed and smoothed (a Catmull–Rom curve through each, `steps` points a span), for a
 * silhouette drawn from a few control points.
 */
export function stampSmoothRegion(points: readonly StampPoint[], steps = 8): StampRegion {
  const n = points.length, at = (i: number) => points[((i % n) + n) % n];
  const curve = points.flatMap((_, i) => Array.from({ length: steps }, (_slot, k) => {
    const u = k / steps, u2 = u * u, u3 = u2 * u;
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const along = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (3 * b - a - 3 * c + d) * u3);
    return { x: along(p0.x, p1.x, p2.x, p3.x), y: along(p0.y, p1.y, p2.y, p3.y) };
  }));
  return { kind: 'polygon', points: curve };
}

/** The region's edge, closed (its first point repeated at the end), to stroke along. */
export function stampRegionOutline(region: StampRegion): StampStrokePoint[] {
  const polygon = stampRegionPolygon(region);
  return [...polygon, polygon[0]].map(({ x, y }) => ({ x, y }));
}

/** A wash's body as the renderer and the CPU reference lay it (STAMP_REGION_FUNCTIONS.washBody). */
export type StampWashBody = {
  /** The region, traced (stampRegionPolygon). */
  polygon: readonly StampPoint[];
  /** The body's box: the region's own. */
  box: StampBox;
  /** How thick the region is near each point (stampGridLocalMax of its distance), which narrows the body's edge. */
  thickness: StampGrid;
  /** Half the diameter: where the edge stroke runs inside the outline. */
  inset: number;
};

/** A fill's stamps and body, placed once. */
export type StampWashPlacement = { body: StampWashBody; stamps: PlacedStamp[]; dualStamps: PlacedStamp[] };

/**
 * Places a fill of `region` by `brush` at `diameter`: its body, its edge stroke (untapered and unfading, so the
 * contour is as dense at its end as its start) and its dual's stamps, along the contour and in rows along `direction`
 * (radians) wherever the region comes within half a diameter.
 */
export function placeStampWash(region: StampRegion, brush: StampBrush, diameter: number, direction: number, seed: string): StampWashPlacement {
  const polygon = stampRegionPolygon(region), inset = diameter / 2;
  // A quarter of the inset: the contour's corners are exact to a few pixels, which the brush's own edge hides.
  const cell = Math.max(1, inset / 4);
  const distance = stampDistanceGrid(polygon, stampPolygonBox(polygon, inset + 2 * cell), cell);
  const edge = stampGridContours(distance, inset).flatMap((loop, i) =>
    [...loop, loop[0]].map(({ x, y }, k): StampStrokePoint => (i > 0 && k === 0 ? { x, y, lift: true } : { x, y })));
  const untapered = { ...brush, taper: { ...brush.taper, start: 0, end: 0, size: 1, opacity: 1 }, falloff: 0 };
  const stamps = edge.length ? placeStrokeStamps(edge, untapered, diameter, seed) : [];
  let dualStamps: PlacedStamp[] = [];
  if (brush.dual) {
    const rows = rowRuns(polygon, direction, Math.max(1, DUAL_ROWS * diameter), (points, y) => rowSpans(points, direction, y, inset + cell, cell, (x, yy) => stampGridAt(distance, x, yy) > -inset));
    const path = edge.length && rows.length ? [...edge, { ...rows[0], lift: true }, ...rows.slice(1)] : [...edge, ...rows];
    dualStamps = path.length ? placeStrokeStamps(path, brush.dual, diameter * brush.dual.scale, `${seed}|dual`) : [];
  }
  const thickness = stampGridLocalMax(distance, inset);
  return { body: { polygon, box: stampPolygonBox(polygon), thickness, inset }, stamps, dualStamps };
}

/**
 * A wash body's paint: its brush's converged build, read off a straight stroke (`probe`). Toward full it has built
 * to 1; a buildToOpacity to the strongest opacity a stamp brought. `densest`: a glaze's densest stamp, its cap too, as
 * a body has no tip to take off.
 */
export type StampWashBodyLevels = { built: number; densest: number };

export function stampWashBodyLevels(towardFull: boolean, probe: readonly PlacedStamp[]): StampWashBodyLevels {
  const densest = probe.reduce((most, s) => Math.max(most, s.alpha * s.opacity), 0);
  return { built: towardFull ? 1 : probe.reduce((most, s) => Math.max(most, s.opacity), 0), densest };
}

/** A straight stroke of `brush` four diameters long, for its converged build (stampWashBodyLevels). */
export function stampWashProbe(brush: StampBrush, diameter: number, seed: string): PlacedStamp[] {
  const untapered = { ...brush, taper: { ...brush.taper, start: 0, end: 0, size: 1, opacity: 1 }, falloff: 0 };
  return placeStrokeStamps([{ x: 0, y: 0 }, { x: diameter * 4, y: 0 }], untapered, diameter, seed);
}

/**
 * A fill's front along the normal to `direction`: its paint at (x, y) as a share, 0 ahead and 1 a diameter behind.
 * It runs from `from` to `to`, the ends of all it paints, a scattered stamp's reach past the outline too, so
 * `progress` 0 shows none of it and 1 all.
 */
export type StampWashFront = { normal: readonly [number, number]; from: number; to: number; soft: number };

export function stampWashFront(polygon: readonly StampPoint[], stamps: readonly PlacedStamp[], direction: number, diameter: number): StampWashFront {
  const normal = [-Math.sin(direction), Math.cos(direction)] as const;
  let from = Infinity, to = -Infinity;
  const reach = (x: number, y: number, r: number) => {
    const along = x * normal[0] + y * normal[1];
    from = Math.min(from, along - r);
    to = Math.max(to, along + r);
  };
  for (const { x, y } of polygon) reach(x, y, 0);
  // A diameter from its centre: past a square tip's corners at any turn.
  for (const { x, y, diameter: d } of stamps) reach(x, y, d);
  return { normal, from, to, soft: diameter };
}

/** The share of a fill's paint at (x, y) shown with its front at `progress`; the renderer's washFrontShare. */
export const STAMP_WASH_FRONT_SHARE = {
  cpu: (front: StampWashFront, progress: number, x: number, y: number) => {
    const at = front.from + progress * (front.to - front.from + front.soft);
    return Math.min(1, Math.max(0, (at - (x * front.normal[0] + y * front.normal[1])) / front.soft));
  },
  wgsl: /* wgsl */ `fn washFrontShare(p: vec2f, normal: vec2f, start: f32, end: f32, soft: f32, progress: f32) -> f32 {
  let at = start + progress * (end - start + soft);
  return clamp((at - dot(p, normal)) / soft, 0.0, 1.0);
}`,
};

/**
 * How a fill lays its paint. `wash`: a converged body under the brush's edge (placeStampWash), as wet paint floods a
 * shape. `strokes`: real strokes of the brush in a pattern, as a crayon or a pencil fills one (stampFillStrokePath).
 */
export type StampFillApplication = { kind: 'wash' } | ({ kind: 'strokes' } & StampFillStrokes);

/**
 * `backAndForth`: one stroke turning at each end of a row. `zigzag`: one stroke running diagonally from one side to
 * the other, a sharp turn at each. `hatch`: parallel marks, each lifted and laid the same way. `crossHatch`: a hatch,
 * then another across it. `scribble`: one stroke looping as it goes back and forth.
 */
export type StampFillPattern = 'backAndForth' | 'zigzag' | 'hatch' | 'crossHatch' | 'scribble';

/**
 * A strokes fill. `spacing`: diameters between rows, centre to centre (STAMP_FILL_PATTERNS' when left out), past 1
 * leaving paper between the marks. `variation`, 0..1 (0.3 when left out): how unevenly a hand lays them, each row's
 * place and tilt and each mark's ends. `hand`: how each mark is painted (the pattern's own when left out).
 */
export type StampFillStrokes = { pattern: StampFillPattern; spacing?: number; variation?: number; hand?: StampStrokeHand };

/**
 * A hatch mark's pressure: firm at its ends, a little fuller midway. A taper would shrink its ends short of the
 * outline, where a fill's marks must reach.
 */
const HATCH_PRESSURE = (along: number) => 0.8 + 0.2 * Math.sin(Math.PI * along);

/** Each pattern's spacing and hand: a hatch mark swells a little; a continuous stroke presses into its turns. */
export const STAMP_FILL_PATTERNS: Record<StampFillPattern, { spacing: number; hand: StampStrokeHand }> = {
  backAndForth: { spacing: 0.9, hand: { curvature: 0.4, wobble: { pressure: 0.15, position: 0.04 } } },
  zigzag: { spacing: 1, hand: { curvature: 0.4, wobble: { pressure: 0.15, position: 0.04 } } },
  hatch: { spacing: 1.2, hand: { profile: HATCH_PRESSURE, wobble: { pressure: 0.1, position: 0.03 } } },
  crossHatch: { spacing: 1.5, hand: { profile: HATCH_PRESSURE, wobble: { pressure: 0.1, position: 0.03 } } },
  scribble: { spacing: 1.5, hand: { curvature: 0.3, wobble: { pressure: 0.15, position: 0.03 } } },
};

/** A cross-hatch's second layer turns this far from the first: square reads as a grid, not a hand's. */
const CROSS_HATCH_TURN = Math.PI / 3;

/**
 * `region` in `strokes` at `diameter`: one path, lifting between marks, each already painted by its hand, its rows
 * along `direction` (radians, 0 left and right) laid one after another. A mark's edge meets the outline; where the
 * region is thinner than a diameter the marks run down its middle, and may spill past its sides.
 */
export function stampFillStrokePath(region: StampRegion, diameter: number, direction: number, strokes: StampFillStrokes, seed: string): StampStrokePoint[] {
  const { pattern, variation = 0.3 } = strokes;
  const { spacing, hand } = { ...STAMP_FILL_PATTERNS[pattern], ...strokes };
  if (!(spacing > 0) || !(variation >= 0 && variation <= 1)) throw new Error(`stamp paint: a strokes fill needs a positive spacing and a variation of 0..1, not ${spacing} and ${variation}`);
  const inside = strokeRoom(region, diameter), random = seededRandom(`${seed}|fill strokes`);
  const step = spacing * diameter;
  const rows = (angle: number, extra = 0) => fillRows(inside, angle, step, variation, extra, random);
  let marks: StampStrokePoint[][];
  if (pattern === 'hatch') marks = hatchMarks(rows(direction));
  else if (pattern === 'crossHatch') marks = [...hatchMarks(rows(direction)), ...hatchMarks(rows(direction + CROSS_HATCH_TURN))];
  // A scribble's loops are a row apart wide, so each overlaps the next row's, and wider than the brush, so they read.
  else if (pattern === 'scribble') marks = chainRows(rows(direction, step)).map((chain) => scribbled(serpentine(chain), step, variation, random));
  else marks = chainRows(rows(direction)).map(pattern === 'zigzag' ? zigzag : serpentine);
  const path: StampStrokePoint[] = [];
  marks.filter((mark) => mark.length > 1).forEach((mark, i) => {
    const [first, ...rest] = handStampStroke(mark, hand, diameter, `${seed}|mark ${i}`);
    path.push(i > 0 ? { ...first, lift: true } : first, ...rest);
  });
  return path;
}

/** Where a mark's centre may lie in `region`: half a diameter inside, or down the middle where it's thinner. */
type StrokeRoom = { polygon: readonly StampPoint[]; cell: number; inset: number; inside: (x: number, y: number, extra: number) => boolean };

function strokeRoom(region: StampRegion, diameter: number): StrokeRoom {
  const polygon = stampRegionPolygon(region), inset = diameter / 2, cell = Math.max(1, inset / 4);
  const distance = stampDistanceGrid(polygon, stampPolygonBox(polygon, 2 * cell), cell);
  const thickness = stampGridLocalMax(distance, inset);
  return { polygon, cell, inset, inside: (x, y, extra) => stampGridAt(distance, x, y) > Math.min(inset, stampGridAt(thickness, x, y) / 2) + extra };
}

/** A row of a strokes fill: its spans, each from its start to its end, in painting coordinates. */
type FillRow = { start: StampPoint; end: StampPoint }[];

/**
 * Rows `step` apart across `room` along `angle`, the first and last half a diameter in from its extremes, each split
 * into spans where a mark's centre (`extra` further in) may lie. `variation` moves each inner row and tilts and
 * shortens each span, never past the room's ends.
 */
function fillRows({ polygon, cell, inset, inside }: StrokeRoom, angle: number, step: number, variation: number, extra: number, random: () => number): FillRow[] {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const local = polygon.map(({ x, y }) => ({ x: x * cos + y * sin, y: -x * sin + y * cos }));
  const toPainting = (x: number, y: number) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
  const top = Math.min(...local.map((p) => p.y)), bottom = Math.max(...local.map((p) => p.y));
  const margin = Math.min(inset + extra + cell, (bottom - top) / 2), first = top + margin, last = bottom - margin;
  const count = Math.max(1, Math.round((last - first) / step) + 1);
  const shake = (amount: number) => (random() * 2 - 1) * amount * variation;
  return Array.from({ length: count }, (_, k) => {
    const y = count === 1 ? (first + last) / 2 : first + ((last - first) * k) / (count - 1);
    const row = k > 0 && k < count - 1 ? y + shake(0.25 * step) : y;
    return rowSpans(local, angle, row, inset + extra + cell, cell, (x, yy) => inside(x, yy, extra)).map(([a, b]) => {
      const pull = Math.min((b - a) / 3, 0.35 * inset * 2 * variation);
      return { start: toPainting(a + random() * pull, row + shake(0.12 * step)), end: toPainting(b - random() * pull, row + shake(0.12 * step)) };
    });
  });
}

/** Each span a mark of its own, all laid the same way. */
const hatchMarks = (rows: readonly FillRow[]) => rows.flatMap((row) => row.map(({ start, end }): StampStrokePoint[] => [start, end]));

/** How far along the line from `p` to `q` point `r` lies, as a share of it. */
const shareAlong = (p: StampPoint, q: StampPoint, r: StampPoint) => ((r.x - p.x) * (q.x - p.x) + (r.y - p.y) * (q.y - p.y)) / ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 || 1);

/**
 * The rows' spans joined into chains a continuous stroke can follow: each span into the first unused span of the next
 * row that overlaps it along the row, a new chain where none does, as a hand goes on across a shape and comes back for
 * what it passed.
 */
function chainRows(rows: readonly FillRow[]): FillRow[] {
  const used = rows.map((row) => row.map(() => false)), chains: FillRow[] = [];
  rows.forEach((row, k) => row.forEach((span, j) => {
    if (used[k][j]) return;
    const chain = [span];
    used[k][j] = true;
    for (let r = k + 1, last = span; r < rows.length; r++) {
      // Overlapping along the row: the next span's ends, measured along this one, don't both fall off one side.
      const next = rows[r].findIndex((other, i) => !used[r][i] && Math.max(shareAlong(last.start, last.end, other.start), shareAlong(last.start, last.end, other.end)) > 0 && Math.min(shareAlong(last.start, last.end, other.start), shareAlong(last.start, last.end, other.end)) < 1);
      if (next < 0) break;
      used[r][next] = true;
      last = rows[r][next];
      chain.push(last);
    }
    chains.push(chain);
  }));
  return chains;
}

/** A chain as one stroke along each span in turn, turning back at each end. */
const serpentine = (chain: FillRow): StampStrokePoint[] => chain.flatMap(({ start, end }, i) => (i % 2 ? [end, start] : [start, end]));

/** A chain as one stroke from one side to the other and back, a corner on each row; a lone span is run along. */
const zigzag = (chain: FillRow): StampStrokePoint[] => (chain.length < 2 ? serpentine(chain) : chain.map(({ start, end }, i) => (i % 2 ? end : start)));

/**
 * `path` with loops of about `radius` wound along it, turning one way, each advancing about its radius:
 * a scribble's coil. `variation` swells and shrinks them. The path lies `radius` inside where a mark may, so they stay in.
 */
function scribbled(path: readonly StampStrokePoint[], radius: number, variation: number, random: () => number): StampStrokePoint[] {
  const out: StampStrokePoint[] = [];
  // Sampled every 10° of a loop, so it reads round.
  const turn = (2 * Math.PI) / radius, step = radius / 36;
  let travelled = 0, size = radius;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], span = Math.hypot(b.x - a.x, b.y - a.y);
    for (let d = 0; d < span; d += step, travelled += step) {
      if (Math.floor((travelled + step) * turn / (2 * Math.PI)) > Math.floor(travelled * turn / (2 * Math.PI))) size = radius * (1 + (random() * 2 - 1) * 0.3 * variation);
      const k = d / span, phase = travelled * turn;
      out.push({ x: a.x + (b.x - a.x) * k + size * Math.cos(phase), y: a.y + (b.y - a.y) * k + size * Math.sin(phase) });
    }
  }
  return out;
}

/**
 * Rows `step` apart across `polygon` along `angle`, each split into runs by `spans` (in the rows' frame, where each
 * row is horizontal), joined back and forth into one path that lifts between runs.
 */
function rowRuns(polygon: readonly StampPoint[], angle: number, step: number, spans: (local: readonly StampPoint[], y: number) => [number, number][]): StampStrokePoint[] {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const local = polygon.map(({ x, y }) => ({ x: x * cos + y * sin, y: -x * sin + y * cos }));
  const toPainting = (x: number, y: number) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
  const top = Math.min(...local.map((p) => p.y)), bottom = Math.max(...local.map((p) => p.y));
  const path: StampStrokePoint[] = [];
  let rightward = true;
  for (let y = top + step / 2; y < bottom; y += step) {
    const runs = spans(local, y);
    for (const [a, b] of rightward ? runs : runs.toReversed()) {
      const [start, end] = rightward ? [a, b] : [b, a];
      path.push({ ...toPainting(start, y), ...(path.length && { lift: true }) }, toPainting(end, y));
    }
    rightward = !rightward;
  }
  return path;
}

/**
 * Where the row at `y`, in the frame turned by `angle`, is `inside`, as spans in that frame: walked `step` px at a time
 * from `reach` before the region's leftmost point to `reach` past its rightmost.
 */
function rowSpans(local: readonly StampPoint[], angle: number, y: number, reach: number, step: number, inside: (x: number, y: number) => boolean): [number, number][] {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const x0 = Math.min(...local.map((p) => p.x)) - reach, x1 = Math.max(...local.map((p) => p.x)) + reach;
  const spans: [number, number][] = [];
  let start: number | null = null;
  for (let x = x0; x <= x1 + step; x += step) {
    const within = x <= x1 && inside(x * cos - y * sin, x * sin + y * cos);
    if (within && start === null) start = x;
    if (!within && start !== null) {
      spans.push([start, x - step]);
      start = null;
    }
  }
  return spans.filter(([a, b]) => b > a);
}

/** A seed for a region's ragged edge from its ID, as a u32 the renderer's noise reads. */
export const stampRegionSeed = (id: string) => Math.floor(seededRandom(`${id}|region`)() * 0x100000000) >>> 0;

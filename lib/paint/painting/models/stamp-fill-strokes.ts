// stamp-fill-strokes.ts: a fill laid in strokes, as a crayon, a pencil or a hatching brush covers a shape: real marks
// of the brush in a pattern (StampFillPattern), each a mark of its own (stampFillMarks) that a fill paints as one
// stroke deposit, lifting between them (stampFillStrokePath).
//
// Rows, contours and guided curves all end where a mark's edge meets the outline, its brush's visible offset in
// (StampBrushProfile's), or down the middle where the region is thinner than the brush; reaching past it, they run on
// outside it, for a clip to trim.

import { lerp } from '#lib/picture/motion/models/motion.ts';
import { seededRandom } from '#lib/picture/motion/models/random.ts';
import type { StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';
import { stampBrushEdgeReachOf, type StampBrushEdgeReach } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { handStampStroke, type StampStrokeHand } from '#lib/paint/brush/models/stamp-stroke-hand.ts';
import {
  stampEdgeContourField, stampFootprintExtent, stampFootprintKeepsIn, stampMarkReach, stampMarkSupport, stampOutlineOf, type StampFootprint, type StampMarkHeading,
} from './stamp-footprint.ts';
import {
  stampDistanceGrid, stampGridAt, stampGridContours, stampGridLocalMax, stampPolygonBox, stampPolygonDistance, stampRegionPolygon, type StampDistanceGrid, type StampPoint, type StampRegion,
} from './stamp-region.ts';

/** How a strokes fill lays its marks: in rows, in rings round the outline, or shaped by guides. */
export type StampFillPattern =
  /**
   * `backAndForth`: a stroke turning at each row's end. `zigzag`: a stroke running diagonally side to side.
   * `shading`: short wrist-swing strokes in overlapping patches, lifting every few, as a crayon shades. Each turns
   * back as its `turns` say.
   */
  | { kind: 'backAndForth' | 'zigzag' | 'shading'; turns?: StampFillTurns }
  /**
   * `hatch`: parallel marks, each lifted. `crossHatch`: a hatch, then another across it. `scribble`: a stroke looping
   * back and forth. `contour`: closed loops along the outline, each ring `spacing` diameters inside the last.
   */
  | { kind: 'hatch' | 'crossHatch' | 'scribble' | 'contour' }
  /** Marks wrapping round a form as its `guides` do, as cross-contour hatching does (StampFillGuides). */
  | ({ kind: 'guided' } & StampFillGuides);

/**
 * A curve an author draws for marks to follow, `id` unique among its fellows: what its marks are keyed by, so adding
 * or reordering guides leaves the others' marks where they were.
 */
export type StampGuide = { id: string; path: readonly StampPoint[] };

/**
 * A guided fill's curves: cross-sections in order across the shape, all running the same way, each from outside the
 * region to outside it again, so every mark spans it. Marks are blended between each guide and the next by arc
 * length, `spacing` apart where the pair lie furthest apart, keyed by the pair's IDs. Crossing guides aren't matched.
 */
export type StampFillGuides = { guides: readonly StampGuide[] };

/**
 * A strokes fill. `spacing`: diameters between rows, centre to centre (the pattern's own when left out), past 1
 * leaving paper between marks. `variation`, 0..1 (0.3): how unevenly a hand lays them, each row's place and tilt and
 * each mark's ends. `hand`: how each mark is painted (the pattern's own).
 */
export type StampFillStrokes = {
  pattern: StampFillPattern;
  spacing?: number;
  variation?: number;
  hand?: StampStrokeHand;
  /** StampFillReach. */
  reach?: StampFillReach;
};

/**
 * How far a strokes fill's marks reach. `inside` (when left out): their edges meet the outline. `past`: their centres
 * run out to `past` diameters beyond it, for a clip (`clipped`, `within`) to trim. At 0 their middles reach the
 * outline; at a diameter or so a hand's taper and lift fall outside, so the clipped edge is crisp and full.
 */
export type StampFillReach = 'inside' | { past: number };

/**
 * Where a back and forth, zigzag or shading turns back. `eased` (when left out): the hand nearly lifts, as a crayon or
 * pencil shading does, so a turn is the mark's lightest part. `pressed`: the brush stays pressed through the turn, as
 * one covering a shape in body colour does; a pressure-sized brush eased there would leave the outline bare.
 */
export type StampFillTurns = 'eased' | 'pressed';

/** A strokes fill's mark, already painted by its hand. */
export type StampFillMark = {
  /**
   * Its own, and what seeds its hand: a contour's ring and loop, a guided mark's guides and place between them, each
   * kept as the fill's other marks change. A row pattern's marks share one hand's random walk, so theirs is their order.
   */
  key: string;
  /** The run a hand lays it in: a shading patch's column, a cross-hatch's layer, a contour's ring, a guided fill's pair. */
  patch?: number;
  path: StampStrokePoint[];
};

/**
 * A hatch mark's pressure: firm at its ends, a little fuller midway. A taper would shrink its ends short of the
 * outline, where a fill's marks must reach.
 */
const HATCH_PRESSURE = (along: number) => 0.8 + 0.2 * Math.sin(Math.PI * along);
const HATCH_HAND: StampStrokeHand = { profile: HATCH_PRESSURE, wobble: { pressure: 0.1, position: 0.03 } };

/**
 * Each pattern's spacing and hand: a hatch mark swells a little. A pattern that turns back (back and forth, zigzag,
 * shading) is pressed at each reversal as its `turns` say (reversalLegs), so its hand names no curvature: that presses
 * into tight turns and lightens runs, as a brush rounding a corner does, and leaves a fill a hollow frame.
 */
export const STAMP_FILL_PATTERNS: Record<StampFillPattern['kind'], { spacing: number; hand: StampStrokeHand }> = {
  backAndForth: { spacing: 0.9, hand: { wobble: { pressure: 0.15, position: 0.04 } } },
  zigzag: { spacing: 1, hand: { wobble: { pressure: 0.15, position: 0.04 } } },
  shading: { spacing: 0.5, hand: { wobble: { pressure: 0.2, position: 0.05 } } },
  hatch: { spacing: 1.2, hand: HATCH_HAND },
  crossHatch: { spacing: 1.5, hand: HATCH_HAND },
  scribble: { spacing: 1.5, hand: { curvature: 0.3, wobble: { pressure: 0.15, position: 0.03 } } },
  contour: { spacing: 1, hand: { wobble: { pressure: 0.15, position: 0.04 } } },
  guided: { spacing: 1.2, hand: HATCH_HAND },
};

/** A cross-hatch's second layer turns this far from the first: square reads as a grid, not a hand's. */
const CROSS_HATCH_TURN = Math.PI / 3;

/** A mark before its hand paints it: keyed and patched where its pattern gives it one. */
type LaidMark = { key?: string; patch?: number; path: StampStrokePoint[] };

/**
 * A strokes fill's brush as its marks keep inside: its `diameter`, its visible `offset` there, px, how far a firm
 * mark's paint reaches from its centreline (stampBrushEdgeOffsetMean), and that reach by heading and side.
 */
export type StampFillMarkSize = { diameter: number; offset: number; edge: StampBrushEdgeReach };

/**
 * `region` in `strokes` at `size`, mark by mark, each painted by its hand, seeded by `seed` and its key. Rows run
 * along `direction` (radians, 0 left and right); contours and guides follow the shape. A mark's edge meets the
 * outline (or runs past it, as `reach` says); in a region thinner than its paint the marks run down its middle.
 */
export function stampFillMarks(region: StampRegion, size: StampFillMarkSize, direction: number, strokes: StampFillStrokes, seed: string): StampFillMark[] {
  const { diameter } = size;
  const { pattern, variation = 0.3, reach = 'inside' } = strokes;
  const { spacing, hand } = { ...STAMP_FILL_PATTERNS[pattern.kind], ...strokes };
  if (!(spacing > 0) || !(variation >= 0 && variation <= 1)) throw new Error(`stamp paint: a strokes fill needs a positive spacing and a variation of 0..1, not ${spacing} and ${variation}`);
  if (reach !== 'inside' && !(reach.past >= 0 && Number.isFinite(reach.past))) throw new Error(`stamp paint: a strokes fill reaches a finite 0 or more diameters past its outline, not ${reach.past}`);
  const room = strokeRoom(region, size, reach), random = seededRandom(`${seed}|fill strokes`);
  const step = spacing * diameter;
  // A row of marks that turn back, or a scribble's loops, heads either way along it.
  const rows = (angle: number, heading: StampMarkHeading, extra = 0) => fillRows(room, angle, heading, step, variation, extra, random);
  const unkeyed = (paths: StampStrokePoint[][], patch?: number) => paths.map((path): LaidMark => ({ path, ...(patch !== undefined && { patch }) }));
  let laid: LaidMark[];
  switch (pattern.kind) {
    case 'hatch': laid = unkeyed(hatchMarks(rows(direction, direction))); break;
    case 'crossHatch': laid = [...unkeyed(hatchMarks(rows(direction, direction)), 0), ...unkeyed(hatchMarks(rows(direction + CROSS_HATCH_TURN, direction + CROSS_HATCH_TURN)), 1)]; break;
    // A scribble's loops are a row apart wide, so each overlaps the next row's, and wider than the brush, so they read.
    case 'scribble': laid = unkeyed(chainRows(rows(direction, 'any', step)).map((chain) => scribbled(serpentine(chain), step, variation, random))); break;
    case 'contour': laid = contourMarks(room, step, variation, seed); break;
    case 'guided': laid = guidedMarks(room, pattern.guides, diameter, step, variation, seed); break;
    case 'backAndForth': case 'zigzag': case 'shading': {
      const turn = REVERSAL_PRESSURE[pattern.turns ?? 'eased'];
      const legs = (path: readonly StampStrokePoint[]) => reversalLegs(path, turn, diameter, variation, random);
      laid = pattern.kind === 'shading'
        ? shadingPatches(rows(direction, 'any'), direction, diameter, variation, random).map(({ column, patch }): LaidMark => ({ patch: column, path: legs(serpentine(patch)) }))
        : unkeyed(chainRows(rows(direction, 'any')).map(pattern.kind === 'zigzag' ? zigzag : serpentine).map(legs));
    }
  }
  return laid.filter(({ path }) => path.length > 1).map(({ key, patch, path }, i) => {
    const own = key ?? `mark ${i}`, mark: StampFillMark = { key: own, path: handStampStroke(path, hand, diameter, `${seed}|${own}`) };
    if (patch !== undefined) mark.patch = patch;
    return mark;
  });
}

/** stampFillMarks as one path, lifting between marks, in the order they're laid. */
export function stampFillStrokePath(region: StampRegion, size: StampFillMarkSize, direction: number, strokes: StampFillStrokes, seed: string): StampStrokePoint[] {
  const path: StampStrokePoint[] = [];
  stampFillMarks(region, size, direction, strokes, seed).forEach(({ path: [first, ...rest] }, i) => path.push(i > 0 ? { ...first, lift: true } : first, ...rest));
  return path;
}

/**
 * Where a mark's centre may lie in `region`: where its footprint, heading as it does, clears the outline (the same
 * footprint a flood's plan reads), or down the middle where the region is thinner; or `-inset` px outside it when its
 * marks reach past. `inset`: the mean reach; `widest`: the most any way; `reach`: a mark's toward a way.
 */
type StrokeRoom = {
  polygon: readonly StampPoint[]; distance: StampDistanceGrid; cell: number; inset: number; widest: number; keepsIn: boolean;
  reach: (heading: StampMarkHeading, angle: number) => number;
  footprint: (heading: StampMarkHeading) => StampFootprint;
  inside: (x: number, y: number, extra: number, heading: StampMarkHeading) => boolean;
};

/** Steps of a turn a strokes fill's room keeps a heading's footprint to: a guided mark asks at every point along it. */
const ROOM_HEADINGS = 256;

function strokeRoom(region: StampRegion, { diameter, offset, edge }: StampFillMarkSize, reach: StampFillReach): StrokeRoom {
  const polygon = stampRegionPolygon(region), cell = Math.max(1, diameter / 8);
  const keepsIn = reach === 'inside', inset = keepsIn ? offset : -reach.past * diameter;
  const markEdge = keepsIn ? edge : stampBrushEdgeReachOf(() => inset);
  const any = stampMarkSupport(markEdge, 'any'), widest = Math.max(inset, ...any);
  const distance = stampDistanceGrid(polygon, stampPolygonBox(polygon, 2 * cell - Math.min(0, inset)), cell);
  // Past the outline the room is the distance alone: thickness at radius 0 is the distance itself, never the lesser.
  const thickness = stampGridLocalMax(distance, Math.max(0, widest));
  const outline = stampOutlineOf(polygon, Math.max(0, stampFootprintExtent(any).farthest) + 2 * cell);
  const room = stampFootprintKeepsIn(outline, distance, markEdge, 2 * cell);
  // A past reach is a disc, whatever the heading: the half-disc end-caps of stampMarkReach read only reaches ≥ 0.
  const way = (heading: StampMarkHeading) => (keepsIn ? heading : 'any');
  // A heading rounded to ROOM_HEADINGS, so marks asking at every point share a footprint.
  const held = (heading: StampMarkHeading) => {
    const w = way(heading);
    return typeof w === 'number' ? ((((Math.round((w / (2 * Math.PI)) * ROOM_HEADINGS) % ROOM_HEADINGS) + ROOM_HEADINGS) % ROOM_HEADINGS) * 2 * Math.PI) / ROOM_HEADINGS : w;
  };
  return {
    polygon, distance, cell, inset, widest, keepsIn,
    footprint: (heading) => room.footprint(held(heading)),
    reach: (heading, angle) => stampMarkReach(markEdge, way(heading), angle),
    inside: (x, y, extra, heading) => room.keepsIn(x, y, held(heading), extra) || stampGridAt(distance, x, y) > stampGridAt(thickness, x, y) / 2 + extra,
  };
}

/** A row of a strokes fill: its spans, each from its start to its end, in painting coordinates. */
type FillRow = { start: StampPoint; end: StampPoint }[];

/**
 * Rows `step` apart across `room` along `angle`, marks on them heading `heading`, the first and last at their reach in
 * from the region's extremes, split into spans where a mark's centre (`extra` further in) may lie. `variation` moves
 * inner rows and tilts and shortens spans, never past the room's ends; one reaching past the outline the clip ends.
 */
function fillRows({ polygon, cell, inset, widest, reach, inside }: StrokeRoom, angle: number, heading: StampMarkHeading, step: number, variation: number, extra: number, random: () => number): FillRow[] {
  const frame = stampRowFrame(polygon, angle), { top, bottom } = frame, toPainting = frame.painting;
  const across = Math.max(Math.abs(inset), widest) + extra + cell, left = frame.left - across, right = frame.right + across;
  // Above a row, in this frame, is a quarter turn back from `angle` (y down); below, a quarter turn on.
  const half = (bottom - top) / 2, first = top + Math.min(reach(heading, angle - Math.PI / 2) + extra + cell, half), last = bottom - Math.min(reach(heading, angle + Math.PI / 2) + extra + cell, half);
  const count = Math.max(1, Math.round((last - first) / step) + 1);
  const shake = (amount: number) => (random() * 2 - 1) * amount * variation;
  return Array.from({ length: count }, (_, k) => {
    const y = count === 1 ? (first + last) / 2 : first + ((last - first) * k) / (count - 1);
    const row = k > 0 && k < count - 1 ? y + shake(0.25 * step) : y;
    return stampRowSpans(frame, left, right, row, cell, (x, yy) => inside(x, yy, extra, heading)).map(([a, b]) => {
      const pull = Math.min((b - a) / 3, 0.35 * Math.max(0, inset) * 2 * variation);
      // Start before end, each end's pull before its tilt: the order of draws every fill's marks were laid by.
      const start = toPainting(a + random() * pull, row + shake(0.12 * step));
      return { start, end: toPainting(b - random() * pull, row + shake(0.12 * step)) };
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

/** A shading stroke's length, in diameters: a wrist's swing, the hand moving on along the patch between swings. */
const SHADING_STROKE = 6;
/** How far a shading patch reaches into its neighbour's, as a share of its stroke, so patches meet without a seam. */
const SHADING_OVERLAP = 0.2;
/** Strokes a hand lays before it lifts and starts again: from the first to the second, at random. */
const SHADING_RUN = [4, 9] as const;

/**
 * Rows cut into patches a shading stroke long along them, each patch its rows' pieces in turn, a run of a few strokes
 * before the hand lifts, with the column it stands in. Each row's cuts move at random, so seams don't line up; each
 * piece reaches past its cut into the next patch, its eased ends (reversalLegs) blending in.
 */
function shadingPatches(rows: readonly FillRow[], angle: number, diameter: number, variation: number, random: () => number): { column: number; patch: FillRow }[] {
  const along = (p: StampPoint) => p.x * Math.cos(angle) + p.y * Math.sin(angle);
  const stroke = SHADING_STROKE * diameter, reach = SHADING_OVERLAP * stroke;
  const found: { column: number; row: number; piece: FillRow[number]; short: boolean }[] = [];
  rows.forEach((row, r) => {
    const phase = (random() * 2 - 1) * 0.25 * stroke * variation;
    for (const { start, end } of row) {
      const a = along(start), b = along(end), at = (x: number) => {
        const k = Math.min(1, Math.max(0, (x - a) / (b - a || 1)));
        return { x: start.x + (end.x - start.x) * k, y: start.y + (end.y - start.y) * k };
      };
      const [lo, hi] = a < b ? [a, b] : [b, a];
      for (let column = Math.floor((lo - phase) / stroke); column * stroke + phase < hi; column++) {
        const from = Math.max(lo, column * stroke + phase - reach), to = Math.min(hi, (column + 1) * stroke + phase + reach);
        found.push({ column, row: r, piece: { start: at(from), end: at(to) }, short: to - from < 1.5 * diameter });
      }
    }
  });
  // A short piece (a sliver at a row's end, or a corner's short row) lies under its neighbours' stamps, and drawn
  // would spill its stamp past the outline; only a region with no longer piece is drawn in short ones.
  const kept = found.some(({ short }) => !short) ? found.filter(({ short }) => !short) : found;
  const columns = new Map<number, { row: number; piece: FillRow[number] }[]>();
  for (const { column, row, piece } of kept) (columns.get(column) ?? columns.set(column, []).get(column)!).push({ row, piece });
  const patches: { column: number; patch: FillRow }[] = [];
  for (const [column, pieces] of columns) {
    let patch: FillRow = [], last = -2, run = 0;
    for (const { row, piece } of pieces) {
      if (row !== last + 1 || patch.length >= run) {
        if (patch.length) patches.push({ column, patch });
        patch = [];
        run = SHADING_RUN[0] + Math.floor(random() * (SHADING_RUN[1] - SHADING_RUN[0] + 1));
      }
      patch.push(piece);
      last = row;
    }
    if (patch.length) patches.push({ column, patch });
  }
  return patches;
}

/**
 * A reversing stroke's legs (a path turning back at each point) with the pressure a hand gives them: firm through the
 * middle, at `turn` at each turn and end. Eased, a turnaround is a stroke's lightest part, never a bead where it doubles
 * back. `variation` presses each leg a little harder or lighter.
 */
function reversalLegs(path: readonly StampStrokePoint[], turn: number, diameter: number, variation: number, random: () => number): StampStrokePoint[] {
  const out: StampStrokePoint[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], length = Math.hypot(b.x - a.x, b.y - a.y);
    const firm = 1 - 0.35 * variation * random(), ease = Math.min(0.35 * length, 2 * diameter) / (length || 1);
    const point = (k: number, pressure: number) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, pressure });
    if (i === 1) out.push(point(0, turn));
    // A leg shorter than a stroke's ease either side is the turn itself, the step from one row to the next.
    if (length >= 1.5 * diameter) out.push(point(ease, firm), point(1 - ease, firm));
    out.push(point(1, turn));
  }
  return out;
}

/** The pressure at a turn: eased, the stick or brush nearly lifts; pressed, it doesn't. */
const REVERSAL_PRESSURE: Record<StampFillTurns, number> = { eased: 0.25, pressed: 1 };

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
 * Rings `step` apart inward from the room's edge (its visible offset in, or as far out as the marks reach past the
 * outline), levels of the region's distance, closed and outer first; a region thinner than the brush gets one down its
 * middle. `variation` moves each inner ring in or out,
 * drawn from its own key.
 */
function contourMarks({ distance, inset, keepsIn, footprint }: StrokeRoom, step: number, variation: number, seed: string): LaidMark[] {
  const deepest = distance.values.reduce((most, value) => Math.max(most, value), 0);
  const levels: number[] = [];
  for (let level = inset; level < deepest; level += step) levels.push(level);
  if (!levels.length) levels.push(deepest / 2);
  return levels.flatMap((level, ring) => {
    const shaken = ring > 0 ? level + (seededRandom(`${seed}|contour ${ring}`)() * 2 - 1) * 0.25 * step * variation : level;
    // The outer ring, at the room's edge, keeps the mark's footprint inside, as a flood's edge run does.
    const field = ring === 0 && level === inset && keepsIn ? stampEdgeContourField(distance, footprint('outline'), inset).grid : distance;
    return stampGridContours(field, shaken).map((loop, k): LaidMark => ({ key: `contour ${ring}.${k}`, patch: ring, path: [...loop, loop[0]] }));
  });
}

/** Most points a guide is resampled to: a long guide's marks still resolve their bends at a few px. */
const GUIDE_POINTS = 2000;

/**
 * StampFillGuides' marks, each cut to where its centre may lie. Reaching past the outline, each blended curve first runs
 * on straight as far as the reach, since guides need only end outside the outline. `variation` moves each inner mark
 * between its pair, drawn from its key. A pair's marks read only their two guides, so adding one leaves them be.
 */
function guidedMarks(room: StrokeRoom, guides: StampFillGuides['guides'], diameter: number, step: number, variation: number, seed: string): LaidMark[] {
  checkGuides(room.polygon, guides);
  const marks: LaidMark[] = [];
  for (let g = 0; g + 1 < guides.length; g++) {
    const pair = `${guides[g].id}~${guides[g + 1].id}`, [from, to] = [guides[g].path, guides[g + 1].path];
    const arcs = [arcLengths(from), arcLengths(to)];
    const samples = Math.min(GUIDE_POINTS, Math.max(2, Math.ceil(Math.max(arcs[0].at(-1)!, arcs[1].at(-1)!) / (diameter / 4)) + 1));
    const a = resampledGuide(from, arcs[0], samples), b = resampledGuide(to, arcs[1], samples);
    const widest = a.reduce((most, p, i) => Math.max(most, Math.hypot(b[i].x - p.x, b[i].y - p.y)), 0);
    const count = Math.max(1, Math.ceil(widest / step));
    // The pair's second guide is the next pair's first; only the last pair lays it.
    for (let k = 0; k <= (g + 2 === guides.length ? count : count - 1); k++) {
      const share = k / count + (k > 0 && k < count ? ((seededRandom(`${seed}|guided ${pair}.${k}`)() * 2 - 1) * 0.25 * variation) / count : 0);
      const curve = a.map((p, i) => ({ x: lerp(p.x, b[i].x, share), y: lerp(p.y, b[i].y, share) }));
      insideRuns(extendedEnds(curve, -room.inset), room).forEach((run, piece) => marks.push({ key: `guided ${pair}.${k}.${piece}`, patch: g, path: run }));
    }
  }
  return marks;
}

/** Refuses guides that can't lay a fill: fewer than two, one ending inside the shape, or one running against the last. */
function checkGuides(polygon: readonly StampPoint[], guides: StampFillGuides['guides']) {
  if (guides.length < 2) throw new Error(`stamp paint: a guided fill needs at least two guides to lay marks between, not ${guides.length}`);
  stampCheckedGuides(guides, 'a guided fill');
  guides.forEach(({ id, path }, g) => {
    for (const end of [path[0], path.at(-1)!]) {
      if (stampPolygonDistance(polygon, end.x, end.y) > 0) throw new Error(`stamp paint: a guided fill's guide ${id} ends inside the region at ${end.x}, ${end.y}; guides span the shape, from outside it to outside it`);
    }
    if (g === 0) return;
    const [ax, ay] = guideWay(guides[g - 1].path), [bx, by] = guideWay(path);
    if (ax * bx + ay * by <= 0) throw new Error(`stamp paint: a guided fill's guide ${id} runs against guide ${guides[g - 1].id}; guides all run the same way`);
  });
}

/** `guides` refused, for `what`, unless each has a unique ID (non-empty, no "|", "/" or "~") and two finite points or more. */
export function stampCheckedGuides(guides: readonly StampGuide[], what: string): readonly StampGuide[] {
  const ids = new Set<string>();
  for (const { id, path } of guides) {
    if (!id || /[|/~]/.test(id) || ids.has(id)) throw new Error(`stamp paint: ${what}'s guide ${JSON.stringify(id)} needs an ID of its own: non-empty, unique, no "|", "/" or "~"`);
    ids.add(id);
    if (path.length < 2 || !path.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))) throw new Error(`stamp paint: ${what}'s guide ${id} needs at least two finite points`);
  }
  return guides;
}

/** The way `guide` runs, from its first point to its last. */
const guideWay = (guide: readonly StampPoint[]) => [guide.at(-1)!.x - guide[0].x, guide.at(-1)!.y - guide[0].y];

/** The arc length to each of `curve`'s points. */
function arcLengths(curve: readonly StampPoint[]): number[] {
  const arcs = [0];
  for (let i = 1; i < curve.length; i++) arcs.push(arcs[i - 1] + Math.hypot(curve[i].x - curve[i - 1].x, curve[i].y - curve[i - 1].y));
  return arcs;
}

/** `guide` at `samples` points evenly spaced along its length (`arcs`, its arcLengths). */
function resampledGuide(guide: readonly StampPoint[], arcs: readonly number[], samples: number): StampPoint[] {
  const length = arcs.at(-1)!;
  let span = 1;
  return Array.from({ length: samples }, (_, i) => {
    const at = (length * i) / (samples - 1);
    while (span < guide.length - 1 && arcs[span] < at) span++;
    const k = (at - arcs[span - 1]) / (arcs[span] - arcs[span - 1] || 1);
    return { x: lerp(guide[span - 1].x, guide[span].x, k), y: lerp(guide[span - 1].y, guide[span].y, k) };
  });
}

/** Bisections that place a run's end between its last point inside and first outside: to a 64th of the gap. */
const RUN_END_BISECTIONS = 6;

/** The stretches of `curve` where a mark's centre may lie in `room`, each end found between its samples. */
function insideRuns(curve: readonly StampPoint[], room: StrokeRoom): StampStrokePoint[][] {
  // Each point heads as the curve runs through it.
  const headingAt = (i: number) => {
    const a = curve[Math.max(0, i - 1)], b = curve[Math.min(curve.length - 1, i + 1)];
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  const within = ({ x, y }: StampPoint, heading: number) => room.inside(x, y, 0, heading);
  // A run's end, between its last point inside and the curve's next outside, heading as the curve runs there.
  const edge = (inner: StampPoint, outer: StampPoint, from: StampPoint, to: StampPoint) => {
    const heading = Math.atan2(to.y - from.y, to.x - from.x);
    let a = inner, b = outer;
    for (let i = 0; i < RUN_END_BISECTIONS; i++) {
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (within(middle, heading)) a = middle; else b = middle;
    }
    return a;
  };
  const runs: StampStrokePoint[][] = [];
  let run: StampStrokePoint[] | null = null;
  for (let i = 0; i < curve.length; i++) {
    const point = curve[i];
    if (!within(point, headingAt(i))) {
      if (run) runs.push([...run, edge(curve[i - 1], point, curve[i - 1], point)]);
      run = null;
      continue;
    }
    run ??= i > 0 ? [edge(point, curve[i - 1], curve[i - 1], point)] : [];
    run.push(point);
  }
  if (run) runs.push(run);
  return runs.filter((points) => points.length > 1);
}

/** `run` with a straight piece `reach` px long on each end, along its end's own heading; as it is for no reach. */
function extendedEnds(run: StampStrokePoint[], reach: number): StampStrokePoint[] {
  if (!(reach > 0)) return run;
  const beyond = (end: StampPoint, inward: StampPoint) => {
    const dx = end.x - inward.x, dy = end.y - inward.y, d = Math.hypot(dx, dy) || 1;
    return { x: end.x + (dx / d) * reach, y: end.y + (dy / d) * reach };
  };
  // Two samples in, so the heading isn't a bisected end's short last step.
  const near = Math.min(2, run.length - 1);
  return [beyond(run[0], run[near]), ...run, beyond(run.at(-1)!, run.at(-1 - near)!)];
}

/**
 * The frame rows along `angle` lie in, each horizontal (y down): `polygon`'s extremes in it, and a point of it in the
 * painting.
 */
export type StampRowFrame = { top: number; bottom: number; left: number; right: number; painting: (x: number, y: number) => StampPoint };

/** `polygon` in the frame of rows along `angle` (StampRowFrame). */
export function stampRowFrame(polygon: readonly StampPoint[], angle: number): StampRowFrame {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
  for (const { x, y } of polygon) {
    const u = x * cos + y * sin, v = -x * sin + y * cos;
    top = Math.min(top, v); bottom = Math.max(bottom, v); left = Math.min(left, u); right = Math.max(right, u);
  }
  return { top, bottom, left, right, painting: (x, y) => ({ x: x * cos - y * sin, y: x * sin + y * cos }) };
}

/**
 * Where the row at `y` in `frame` is `inside` (asked in the painting), as spans in the frame: walked `step` px at a
 * time from x0 to x1, the region's extremes and as far past as a mark may lie.
 */
export function stampRowSpans(frame: StampRowFrame, x0: number, x1: number, y: number, step: number, inside: (x: number, y: number) => boolean): [number, number][] {
  const spans: [number, number][] = [];
  let start: number | null = null;
  for (let x = x0; x <= x1 + step; x += step) {
    const at = x <= x1 ? frame.painting(x, y) : null, within = at !== null && inside(at.x, at.y);
    if (within && start === null) start = x;
    if (!within && start !== null) {
      spans.push([start, x - step]);
      start = null;
    }
  }
  return spans.filter(([a, b]) => b > a);
}

// subject-burst-rays.ts: ink-punch burst rays radiating from a subject, as ordinary layers built from its geometry: a
// helper for a look's draw step, not a kind of its own. A style or project writes another extra the same way.
//
// Everything the rays deal (angles, inks, widths, lengths) comes from the redraw token, and where they stand from the
// subject: one token holds the same rays while the actor moves, and a new one redraws them.

import type { BrushRef, DirectApplication, Hex, LayerKey, LayerNode, Subpath } from '#lib/paint/document/models/painting-document.ts';
import { stampBoxGrown, stampPolygonInside, stampRingArea, stampRingsDistance, type StampBox, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { subjectAreaBox, type SubjectArea } from '#lib/paint/subject/models/subject-geometry.ts';
import type { Subject } from '#lib/paint/subject/models/subject.ts';
import { seededRandom } from '#lib/picture/motion/models/random.ts';
import { redrawSeed, type RedrawToken } from '#lib/timing/drawings/models/drawing-schedule.ts';
import { subjectPaintKey } from './subject-painter.ts';

/** How burst rays are dealt. Shares are of the subject's size: its silhouette's larger side. */
export type BurstRaysOptions = {
  /** The dry-ink brush a style binds. One whose size follows a point's `scale` tapers the rays. */
  readonly brush: BrushRef;
  /** The inks dealt to each fan's rays, no two alike in a fan. */
  readonly inks: readonly [Hex, ...Hex[]];
  /** The drawing's redraw token: equal tokens deal equal rays. */
  readonly token: RedrawToken;
  /** About how many rays per full turn, in fans of one to three. */
  readonly density: number;
  /**
   * The box the rays are seen in, document px: fans are dealt only toward where a ray shows past the body's air, so a
   * crop that leaves one open side still gets its burst. Left out, every direction is open.
   */
  readonly within?: StampBox;
  /** How far from the actor's middle the rays run, in subject sizes; the document clips any past its edge. 1.4 when left out. */
  readonly reach?: number;
  /** A ray's widest, as a share of the subject's size. 0.012 when left out. */
  readonly width?: number;
  /** The air between the body and a ray's inner tip, as a share of the subject's size, before the deal adds to it. 0.04 when left out. */
  readonly air?: number;
  /** The feature group no ray tip may crowd, kept clear by three times the air: `face` when left out; null for none. */
  readonly quiet?: string | null;
  /** The layer's key. `<subject>.burst-rays` when left out. */
  readonly key?: LayerKey;
};

/** How a ray's width runs from its inner tip (0) to its outer end (1): a needle at the body, fullest two-thirds out, nearly a point again at the end. */
const RAY_PROFILE: readonly (readonly [number, number])[] = [[0, 0.05], [0.3, 0.5], [0.7, 1], [1, 0.12]];
/** Directions a fan may be dealt toward, round the full turn. */
const RAY_DIRECTIONS = 120;
/** How many rays a fan holds, by the share of fans: singles, pairs and the odd triple, as an inker flicks them. */
const FAN_SIZES: readonly (readonly [size: number, share: number])[] = [[1, 0.35], [2, 0.45], [3, 0.2]];
/** Points each ray's stroke is laid through. */
const RAY_POINTS = 12;

function rayScaleAt(t: number) {
  const k = RAY_PROFILE.findIndex(([at]) => at >= t);
  if (k <= 0) return RAY_PROFILE[0][1];
  const [a, sa] = RAY_PROFILE[k - 1], [b, sb] = RAY_PROFILE[k];
  return sa + ((t - a) / (b - a)) * (sb - sa);
}

/** How far along one axis a ray from `at` moving `d` a step is between `low` and `high`: its entry and exit. */
function slab(d: number, at: number, low: number, high: number): readonly [number, number] {
  if (d === 0) return at >= low && at <= high ? [-Infinity, Infinity] : [Infinity, -Infinity];
  const a = (low - at) / d, b = (high - at) / d;
  return a < b ? [a, b] : [b, a];
}

/** How far from `from` along unit `(dx, dy)` the ray last leaves `box`; 0 when it never enters it. */
function boxExit(box: StampBox, from: StampPoint, dx: number, dy: number): number {
  const [inX, outX] = slab(dx, from.x, box.x0, box.x1), [inY, outY] = slab(dy, from.y, box.y0, box.y1);
  const enter = Math.max(inX, inY, 0), exit = Math.min(outX, outY);
  return exit >= enter ? exit : 0;
}

const boxHolds = ({ x0, y0, x1, y1 }: StampBox, { x, y }: StampPoint) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const boxDistance = ({ x0, y0, x1, y1 }: StampBox, { x, y }: StampPoint) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));

/**
 * The area's middle: its rings' centroids weighted by area, a hole's taken away. Steadier than its box's middle,
 * which a waving hand drags about.
 */
function areaCentroid({ rings }: SubjectArea): StampPoint {
  let weight = 0, x = 0, y = 0;
  for (const ring of rings) {
    const depth = rings.filter((other) => other !== ring && stampPolygonInside(other, ring[0].x, ring[0].y)).length;
    const signed = stampRingArea(ring), sign = (depth % 2 ? -1 : 1) * Math.sign(signed);
    // The shoelace centroid: each edge's triangle with the origin, weighted by its signed area.
    let cx = 0, cy = 0;
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length], cross = a.x * b.y - b.x * a.y;
      cx += (a.x + b.x) * cross; cy += (a.y + b.y) * cross;
    });
    weight += sign * signed; x += (sign * cx) / 6; y += (sign * cy) / 6;
  }
  if (weight === 0) {
    const box = subjectAreaBox({ rings });
    return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  }
  return { x: x / weight, y: y / weight };
}

/**
 * How far out along the ray a tip clears `around` by `airPx` and the quiet box by its own: past the last point either
 * crowds. Only the stretch inside their grown boxes is walked, since past it everything is clear.
 */
function rayClearance(around: SubjectArea, quiet: { box: StampBox; airPx: number } | undefined, airPx: number, focus: StampPoint, dx: number, dy: number): number {
  const body = stampBoxGrown(subjectAreaBox(around), airPx);
  const walk = Math.max(boxExit(body, focus, dx, dy), quiet ? boxExit(stampBoxGrown(quiet.box, quiet.airPx), focus, dx, dy) : 0);
  const step = Math.max(1, airPx / 4);
  let clear = 0;
  for (let r = 0; r <= walk; r += step) {
    const p = { x: focus.x + dx * r, y: focus.y + dy * r };
    const crowded = (boxHolds(body, p) && stampRingsDistance(around.rings, p.x, p.y) > -airPx) || (quiet !== undefined && boxDistance(quiet.box, p) < quiet.airPx);
    if (crowded) clear = r + step;
  }
  return clear;
}

/** The box round everything of `subject` in feature group `group` that shows: its regions, lines and landmarks. */
function featureGroupBox(subject: Subject, group: string): StampBox | undefined {
  const points = [...subject.features.values()].flatMap((feature): readonly StampPoint[] => {
    if (!feature.groups.some((id) => id === group) || feature.visibility.kind === 'hidden') return [];
    const { geometry } = feature.visibility;
    if ('rings' in geometry) return geometry.rings.flat();
    if ('runs' in geometry) return geometry.runs.flatMap(({ points: run }) => run);
    return [geometry.at];
  });
  if (!points.length) return undefined;
  const xs = points.map(({ x }) => x), ys = points.map(({ y }) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** A ray dealt toward `angle`: where its inner tip may start, clear of the body and face, and how far it may run. */
type RayRoom = { readonly angle: number; readonly start: number; readonly room: number };

/**
 * Ink-punch burst rays round `subject`: fans of one to three near-parallel rays in distinct inks, aimed at its middle,
 * each starting clear of its silhouette (and further clear of its face) and running far out, tapered to a needle at the
 * body. One layer of dry ink, an application per ink. A hidden subject has none.
 */
export function burstRays(subject: Subject, options: BurstRaysOptions): LayerNode[] {
  if (subject.silhouette.kind === 'hidden') return [];
  const { brush, inks, token, density, within, reach = 1.4, width = 0.012, air = 0.04, quiet = 'face' } = options;
  const key = options.key ?? subjectPaintKey(subject.id, ['burst-rays']);
  const around = subject.silhouette.geometry, box = subjectAreaBox(around);
  const unit = Math.max(box.x1 - box.x0, box.y1 - box.y0), widthPx = width * unit;
  // The brush's half-width counts toward the air, so the painted edge keeps it, not just the centre line.
  const airPx = air * unit + widthPx / 2, runPx = reach * unit;
  const focus = areaCentroid(around);
  const face = quiet === null ? undefined : featureGroupBox(subject, quiet);
  const quietBox = face && { box: face, airPx: 3 * air * unit + widthPx / 2 };
  const random = seededRandom(redrawSeed(key, token));
  const turn = random() * 2 * Math.PI;
  // Each direction's room: past its clearance, to the end of its run or the edge of the box it's seen in.
  const rooms: RayRoom[] = Array.from({ length: RAY_DIRECTIONS }, (_, i) => {
    const angle = turn + (i * 2 * Math.PI) / RAY_DIRECTIONS, dx = Math.cos(angle), dy = Math.sin(angle);
    const start = rayClearance(around, quietBox, airPx, focus, dx, dy);
    const seen = within ? boxExit(within, focus, dx, dy) : runPx;
    return { angle, start, room: Math.min(runPx, seen) - start };
  });
  const open = rooms.filter(({ room }) => room >= 10 * widthPx);
  const fans = Math.max(1, Math.round(density / 1.85));
  const strokes = inks.map((): Subpath[] => []);
  for (let f = 0; f < fans; f++) {
    // Every fan draws all its numbers whether it lands or not, so a closed side never shifts another fan's deal.
    const aim = turn + ((f + 0.7 * (random() - 0.5)) * 2 * Math.PI) / fans;
    const pick = random(), size = FAN_SIZES.find((_, i) => pick < FAN_SIZES.slice(0, i + 1).reduce((sum, [, share]) => sum + share, 0))?.[0] ?? 1;
    const spread = (0.012 + 0.02 * random()) * (random() < 0.5 ? -1 : 1), firstInk = Math.floor(random() * inks.length);
    const members = Array.from({ length: 3 }, () => ({ stagger: random(), thickness: 0.6 + 0.8 * random(), length: 0.5 + 0.5 * random() }));
    // The open direction nearest the fan's aim, within half a fan's share of the turn.
    const nearest = open.reduce<RayRoom | undefined>((best, room) => (!best || angleGap(room.angle, aim) < angleGap(best.angle, aim) ? room : best), undefined);
    if (!nearest || angleGap(nearest.angle, aim) > Math.PI / fans) continue;
    for (let m = 0; m < size; m++) {
      const angle = nearest.angle + m * spread, dx = Math.cos(angle), dy = Math.sin(angle);
      const { stagger, thickness, length } = members[m];
      const start = Math.max(nearest.start, rayClearance(around, quietBox, airPx, focus, dx, dy)) + stagger * 2 * airPx;
      const seen = within ? boxExit(within, focus, dx, dy) : runPx;
      // Some rays end in sight, some run on past the edge.
      const end = start + Math.max(10 * widthPx, (Math.max(runPx, seen) - start) * length);
      strokes[(firstInk + m) % inks.length].push(Array.from({ length: RAY_POINTS + 1 }, (_, k) => {
        const t = k / RAY_POINTS, r = start + t * (end - start);
        return { x: focus.x + dx * r, y: focus.y + dy * r, pressure: 1, scale: thickness * rayScaleAt(t) };
      }));
    }
  }
  const applications = inks.flatMap((hex, i): DirectApplication[] => (strokes[i].length ? [{
    key: `${key}.ink-${i}`, kind: 'stroke', subpaths: strokes[i], brush, diameterPx: widthPx, seed: `${key}.ink-${i}`,
    charge: { kind: 'paint', mix: { parts: [{ pigment: hex, amount: 1 }], strength: 1 } },
  }] : []));
  return applications.length ? [{ key, washes: [{ key: `${key}.wash`, wetHistory: false, applications }] }] : [];
}

/** How far apart two angles are round the turn, 0..π. */
function angleGap(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
}

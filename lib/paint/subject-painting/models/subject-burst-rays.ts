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
  /** The inks dealt round the rays, none twice running. */
  readonly inks: readonly [Hex, ...Hex[]];
  /** The drawing's redraw token: equal tokens deal equal rays. */
  readonly token: RedrawToken;
  /** Rays per full turn, before the deal leaves about one in six out. */
  readonly density: number;
  /** How far from the actor's middle the rays run, in subject sizes; the document clips any past its edge. 1.4 when left out. */
  readonly reach?: number;
  /** A ray's widest, as a share of the subject's size. 0.018 when left out. */
  readonly width?: number;
  /** The air between the body and a ray's inner tip, as a share of the subject's size, before the deal adds to it. 0.08 when left out. */
  readonly air?: number;
  /** The feature group no ray tip may crowd, kept clear by two and a half times the air: `face` when left out; null for none. */
  readonly quiet?: string | null;
  /** The layer's key. `<subject>.burst-rays` when left out. */
  readonly key?: LayerKey;
};

/** How a ray's width runs from its inner tip (0) to its outer end (1): a needle at the body, fullest two-thirds out. */
const RAY_PROFILE: readonly (readonly [number, number])[] = [[0, 0.06], [0.25, 0.45], [0.65, 1], [1, 0.55]];
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
    const area = Math.abs(stampRingArea(ring)) * (depth % 2 ? -1 : 1);
    const mean = ring.reduce((sum, p) => ({ x: sum.x + p.x / ring.length, y: sum.y + p.y / ring.length }), { x: 0, y: 0 });
    weight += area; x += area * mean.x; y += area * mean.y;
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

/**
 * Ink-punch burst rays round `subject`: aimed at its middle, each starting clear of its silhouette (and further clear
 * of its face) and running far out, tapered to a needle at the body. One layer of dry ink, an application per ink.
 * A hidden subject has none.
 */
export function burstRays(subject: Subject, options: BurstRaysOptions): LayerNode[] {
  if (subject.silhouette.kind === 'hidden') return [];
  const { brush, inks, token, density, reach = 1.4, width = 0.018, air = 0.08, quiet = 'face' } = options;
  const key = options.key ?? subjectPaintKey(subject.id, ['burst-rays']);
  const around = subject.silhouette.geometry, box = subjectAreaBox(around);
  const unit = Math.max(box.x1 - box.x0, box.y1 - box.y0), widthPx = width * unit, airPx = air * unit;
  const focus = areaCentroid(around);
  const face = quiet === null ? undefined : featureGroupBox(subject, quiet);
  const random = seededRandom(redrawSeed(key, token));
  const turn = random() * 2 * Math.PI, count = Math.round(density);
  const strokes = inks.map((): Subpath[] => []);
  let ink = Math.floor(random() * inks.length);
  for (let i = 0; i < count; i++) {
    // Stratified angles, jittered within their share of the turn. Every ray draws all its numbers, kept or not, so
    // leaving one out never shifts another's deal.
    const angle = turn + ((i + 0.8 * (random() - 0.5)) * 2 * Math.PI) / count;
    const kept = random() > 1 / 6, thickness = 0.6 + 0.8 * random(), extra = 1 + 1.2 * random(), outer = 0.7 + 0.5 * random();
    ink = (ink + 1 + Math.floor(random() * (inks.length - 1))) % inks.length;
    if (!kept) continue;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const start = rayClearance(around, face && { box: face, airPx: 2.5 * airPx }, airPx * extra, focus, dx, dy);
    const end = reach * unit * outer;
    if (end - start < 4 * widthPx) continue;
    strokes[ink].push(Array.from({ length: RAY_POINTS + 1 }, (_, k) => {
      const t = k / RAY_POINTS, r = start + t * (end - start);
      return { x: focus.x + dx * r, y: focus.y + dy * r, pressure: 1, scale: thickness * rayScaleAt(t) };
    }));
  }
  const applications = inks.flatMap((hex, i): DirectApplication[] => (strokes[i].length ? [{
    key: `${key}.ink-${i}`, kind: 'stroke', subpaths: strokes[i], brush, diameterPx: widthPx, seed: `${key}.ink-${i}`,
    charge: { kind: 'paint', mix: { parts: [{ pigment: hex, amount: 1 }], strength: 1 } },
  }] : []));
  return applications.length ? [{ key, washes: [{ key: `${key}.wash`, wetHistory: false, applications }] }] : [];
}

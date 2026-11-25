// subject-paint-lines.ts: lines as a hand draws them. A long line is laid in runs about a hand's sweep long, each
// starting where the last ended and tapering at both ends, so an outline never reads as one machine-even stroke.
// The taper is written into each run's pressure, as a hand profile would lay it on that run alone (a stroke's profile
// spans the gaps between runs): a run under a dozen diameters long tapers less, as a quick dab does.

import type { Subpath } from '#lib/paint/document/models/painting-document.ts';
import { stampRingsDistance, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { subjectAreaBox, type SubjectArea, type SubjectPath, type SubjectRing } from '#lib/paint/subject/models/subject-geometry.ts';
import type { MaterialId } from '#lib/paint/subject/models/subject-id.ts';
import type { Subject } from '#lib/paint/subject/models/subject.ts';
import type { SubjectPainterContext, VisibleSubjectPart } from '../subject-painter.ts';
import { subjectSmoothStep } from './subject-paint-kit.ts';

/** `points` cut into runs about `lengthPx` long, each starting where the last ended; a closed line returns to its start. */
function runsAlong(points: readonly StampPoint[], closed: boolean, lengthPx: number): StampPoint[][] {
  const line = closed ? [...points, points[0]] : points;
  const runs: StampPoint[][] = [[line[0]]];
  let run = 0;
  for (let i = 1; i < line.length; i++) {
    runs[runs.length - 1].push(line[i]);
    run += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
    if (run >= lengthPx && i < line.length - 1) {
      runs.push([line[i]]);
      run = 0;
    }
  }
  return runs.filter((each) => each.length > 1);
}

/** The length, in diameters, from which a run takes the taper's full depth: stampStrokeHand's `fullProfileAt`. */
const FULL_TAPER_DIAMETERS = 12;

/** A run with a hand's pressure: touching down light, firm through the middle, lifting a little slower than it landed. */
const taperedRun = (diameterPx: number) => (points: readonly StampPoint[]): Subpath => {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const total = lengths[lengths.length - 1] || 1, depth = Math.min(1, total / (FULL_TAPER_DIAMETERS * diameterPx));
  return points.map(({ x, y }, i) => {
    const u = lengths[i] / total, taper = 0.25 + 0.75 * Math.min(subjectSmoothStep(u / 0.25), subjectSmoothStep((1 - u) / 0.3));
    return { x, y, pressure: 1 - depth * (1 - taper) };
  });
};

/** A path feature's visible runs as runs about `lengthPx` long, tapered for a brush `diameterPx` across. */
export const subjectPathRuns = (path: SubjectPath, lengthPx: number, diameterPx: number): Subpath[] =>
  path.runs.flatMap(({ points, closed }) => runsAlong(points, closed, lengthPx)).map(taperedRun(diameterPx));

/** Open lines (a silhouette's stretches) as runs about `lengthPx` long, tapered for a brush `diameterPx` across. */
export const subjectStretchRuns = (stretches: readonly (readonly StampPoint[])[], lengthPx: number, diameterPx: number): Subpath[] =>
  stretches.flatMap((points) => runsAlong(points, false, lengthPx)).map(taperedRun(diameterPx));

/** `ring` with points added along each edge no further apart than `stepPx`, so a long edge can change owner midway. */
function densifiedRing(ring: SubjectRing, stepPx: number): StampPoint[] {
  return ring.flatMap((a, k) => {
    const b = ring[(k + 1) % ring.length], count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / stepPx));
    return Array.from({ length: count }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / count, y: a.y + ((b.y - a.y) * i) / count }));
  });
}

/** A part and the stretches of the silhouette that are its edge. */
export type SubjectSilhouetteStretches = { readonly part: VisibleSubjectPart; readonly stretches: readonly StampPoint[][] };

/**
 * The silhouette cut into the stretches each part painted in `slot` owns, so each is inked with its part's options and
 * edge: a point belongs to the visible part whose edge lies nearest. Replaced parts count too, so their stretch is left
 * to the replacement, never a neighbour. Each stretch runs on to where the next begins.
 */
export function subjectSilhouetteStretches<S extends Subject, O, Slot extends string>(context: SubjectPainterContext<S, O, Slot>, slot: Slot, stepPx: number): SubjectSilhouetteStretches[] {
  const { silhouette } = context.subject;
  if (silhouette.kind === 'hidden') return [];
  const parts = [...context.subject.parts.values()].filter((part): part is VisibleSubjectPart => part.visibility.kind === 'visible');
  const boxes = parts.map((part) => subjectAreaBox(part.visibility.geometry));
  const ownerAt = ({ x, y }: StampPoint) => {
    let best = -1, nearest = Infinity;
    parts.forEach((part, i) => {
      const box = boxes[i], outside = Math.hypot(Math.max(box.x0 - x, 0, x - box.x1), Math.max(box.y0 - y, 0, y - box.y1));
      if (outside >= nearest) return;
      const distance = Math.abs(stampRingsDistance(part.visibility.geometry.rings, x, y));
      if (distance < nearest) [best, nearest] = [i, distance];
    });
    return best;
  };
  const owned = new Map<number, StampPoint[][]>();
  for (const ring of silhouette.geometry.rings) {
    const points = densifiedRing(ring, stepPx), owners = points.map(ownerAt);
    const start = owners.findIndex((owner, k) => owner !== owners[(k + points.length - 1) % points.length]);
    if (start < 0) {
      owned.set(owners[0], [...(owned.get(owners[0]) ?? []), [...points, points[0]]]);
      continue;
    }
    let stretch: StampPoint[] = [];
    for (let k = 0; k < points.length; k++) {
      const i = (start + k) % points.length, next = (i + 1) % points.length;
      stretch.push(points[i]);
      if (owners[next] === owners[i]) continue;
      owned.set(owners[i], [...(owned.get(owners[i]) ?? []), [...stretch, points[next]]]);
      stretch = [];
    }
  }
  return parts.flatMap((part, i) => {
    const stretches = owned.get(i);
    return stretches && context.paints(part.ref, slot) ? [{ part, stretches }] : [];
  });
}

/** `points` with points added along each segment no further apart than `stepPx`; the last point kept. */
function densifiedLine(points: readonly StampPoint[], stepPx: number): StampPoint[] {
  return [...points.slice(0, -1).flatMap((a, k) => {
    const b = points[k + 1], count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / stepPx));
    return Array.from({ length: count }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / count, y: a.y + ((b.y - a.y) * i) / count }));
  }), points[points.length - 1]];
}

/** An area wearing one material, boxed to skip it fast. */
const materialPiece = (area: SubjectArea, material: MaterialId) => ({ rings: area.rings, material, box: subjectAreaBox(area) });

/**
 * The stretches of `path` that part two materials. Where one material lies either side, the line is a seam between
 * pieces of one form (a primitive's arm on its body), which a painter carries by value. Outside every part counts as
 * another material. Gaps and stretches under `minPx` are closed and dropped, so a wobbling verdict leaves no stub.
 */
export function subjectMaterialEdgeStretches(subject: Subject, path: SubjectPath, stepPx: number, minPx: number): StampPoint[][] {
  const pieces = [
    ...[...subject.features.values()].flatMap((feature) => (feature.kind === 'region' && feature.material !== undefined && feature.visibility.kind === 'visible' ? [materialPiece(feature.visibility.geometry, feature.material)] : [])),
    ...[...subject.parts.values()].flatMap((part) => (part.visibility.kind === 'visible' ? [materialPiece(part.visibility.geometry, part.material)] : [])),
  ];
  // Decals first: a region wearing its own material is what shows there, over its owner part.
  const materialAt = ({ x, y }: StampPoint): MaterialId | undefined =>
    pieces.find(({ rings, box }) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 && stampRingsDistance(rings, x, y) > 0)?.material;
  const probe = Math.max(3, 1.5 * stepPx);
  return path.runs.flatMap(({ points, closed }) => {
    const line = densifiedLine(closed ? [...points, points[0]] : points, stepPx);
    const parts = line.map((p, k) => {
      const a = line[Math.max(0, k - 1)], b = line[Math.min(line.length - 1, k + 1)], length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
      const left = materialAt({ x: p.x + nx * probe, y: p.y + ny * probe }), right = materialAt({ x: p.x - nx * probe, y: p.y - ny * probe });
      return left === undefined || right === undefined || left !== right;
    });
    return materialEdgeRuns(line, parts, minPx);
  });
}

/** The runs of `line` where `kept` holds, gaps shorter than `minPx` closed first and then runs shorter than it dropped. */
function materialEdgeRuns(line: readonly StampPoint[], kept: readonly boolean[], minPx: number): StampPoint[][] {
  const spans: { from: number; to: number; kept: boolean; length: number }[] = [];
  line.forEach((p, k) => {
    const step = k ? Math.hypot(p.x - line[k - 1].x, p.y - line[k - 1].y) : 0, last = spans[spans.length - 1];
    if (last && last.kept === kept[k]) [last.to, last.length] = [k, last.length + step];
    else spans.push({ from: k, to: k, kept: kept[k], length: step });
  });
  const closed = spans.map((span, i) => Object.assign(span, { kept: span.kept || (i > 0 && i < spans.length - 1 && span.length < minPx) }));
  const runs: StampPoint[][] = [];
  closed.forEach((span, i) => {
    if (!span.kept) return;
    const points = line.slice(span.from, span.to + 1);
    if (i > 0 && closed[i - 1].kept) runs[runs.length - 1].push(...points);
    else runs.push(points);
  });
  return runs.filter((run) => run.length > 1 && run.reduce((sum, p, k) => sum + (k ? Math.hypot(p.x - run[k - 1].x, p.y - run[k - 1].y) : 0), 0) >= minPx);
}

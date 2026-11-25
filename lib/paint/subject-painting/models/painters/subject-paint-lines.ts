// subject-paint-lines.ts: lines as a hand draws them. A long line is laid in runs about a hand's sweep long, each
// starting where the last ended and tapering at both ends, so an outline never reads as one machine-even stroke.
// The taper is written into each run's pressure, as a hand profile would lay it on that run alone (a stroke's profile
// spans the gaps between runs): a run under a dozen diameters long tapers less, as a quick dab does.

import type { Footprint, Subpath } from '#lib/paint/document/models/painting-document.ts';
import { stampGrownPolygon, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { SubjectPath, SubjectRing } from '#lib/paint/subject/models/subject-geometry.ts';
import type { Subject } from '#lib/paint/subject/models/subject.ts';
import type { SubjectPainterContext } from '../subject-painter.ts';
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

/** Rings (a silhouette's) as runs about `lengthPx` long, tapered for a brush `diameterPx` across. */
const subjectRingRuns = (rings: readonly SubjectRing[], lengthPx: number, diameterPx: number): Subpath[] =>
  rings.flatMap((ring) => runsAlong(ring, true, lengthPx)).map(taperedRun(diameterPx));

/** A path feature's visible runs as runs about `lengthPx` long, tapered for a brush `diameterPx` across. */
export const subjectPathRuns = (path: SubjectPath, lengthPx: number, diameterPx: number): Subpath[] =>
  path.runs.flatMap(({ points, closed }) => runsAlong(points, closed, lengthPx)).map(taperedRun(diameterPx));

/**
 * The silhouette's outline as tapered runs, for the parts painted in `slot`, or undefined when none are. A part a
 * replacement draws by hand there keeps the outline off it: `reserves` covers it grown by two diameters.
 */
export function subjectSilhouetteStroke<S extends Subject, O, Slot extends string>(context: SubjectPainterContext<S, O, Slot>, slot: Slot, runPx: number, diameterPx: number) {
  const parts = context.paintedParts(slot), { silhouette } = context.subject;
  if (!parts.length || silhouette.kind === 'hidden') return undefined;
  const reserves: Footprint[] = [...context.subject.parts.values()]
    .flatMap((part) => (part.visibility.kind === 'visible' && !context.paints(part.ref, slot) ? part.visibility.geometry.rings : []))
    .map((ring) => ({ kind: 'region', region: { kind: 'polygon', rings: [stampGrownPolygon(ring, 2 * diameterPx)] } }));
  return { targets: parts.map(({ ref }) => ref), subpaths: subjectRingRuns(silhouette.geometry.rings, runPx, diameterPx), reserves };
}

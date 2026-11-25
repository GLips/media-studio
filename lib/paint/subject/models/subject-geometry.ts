// subject-geometry.ts: a subject's projected geometry, in document px (x right, y down), and whether it shows at all.
// It uses the engine's plain points, not the document's regions, so a subject depends on no painting format; a
// painter converts at its boundary (subject-document-geometry.ts).

import { stampPolygonBox, stampRingArea, stampRingsCross, type StampBox, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { subjectError, type SubjectDiagnostic } from './subject-diagnostic.ts';

/** A closed ring, its first point not repeated. */
export type SubjectRing = readonly StampPoint[];

/**
 * An area with its holes and pieces: rings read even-odd, so a ring inside another is a hole and rings side by side are
 * pieces of one area. Rings never cross. A part split by an occluder is one area of several rings, never several parts.
 */
export type SubjectArea = { readonly rings: readonly [SubjectRing, ...SubjectRing[]] };

/** One visible run of a line. `closed` only when the whole loop shows, its first point not repeated. */
export type SubjectPathRun = { readonly points: readonly StampPoint[]; readonly closed: boolean };

/** A line as it shows: the runs an occluder left of it. */
export type SubjectPath = { readonly runs: readonly [SubjectPathRun, ...SubjectPathRun[]] };

/** A landmark as it shows: one point on the page, as an eye's centre or a cheek. */
export type SubjectLandmarkPoint = { readonly at: StampPoint };

/** Whether something shows in this view. Hidden keeps its identity and owns nothing to paint. */
export type Visibility<G> = { readonly kind: 'hidden' } | { readonly kind: 'visible'; readonly geometry: G };
/** What shows, with its geometry: the visible case of Visibility. */
export type Visible<G> = Extract<Visibility<G>, { kind: 'visible' }>;

/** Nothing of it shows in this view; it keeps its id, matches selectors and draws nothing. */
export const SUBJECT_HIDDEN: Visibility<never> = { kind: 'hidden' };
/** `geometry` as showing. An adapter tracing a view uses subjectAreaVisibility or subjectPathVisibility, hidden when empty. */
export const subjectVisible = <G>(geometry: G): Visible<G> => ({ kind: 'visible', geometry });

/** Traced rings as an area: hidden when the trace found none, as an occluded part's does. */
export const subjectAreaVisibility = (rings: readonly SubjectRing[]): Visibility<SubjectArea> =>
  (rings.length ? subjectVisible({ rings: [rings[0], ...rings.slice(1)] }) : SUBJECT_HIDDEN);

/** Visible runs as a path: hidden when an occluder left none. */
export const subjectPathVisibility = (runs: readonly SubjectPathRun[]): Visibility<SubjectPath> =>
  (runs.length ? subjectVisible({ runs: [runs[0], ...runs.slice(1)] }) : SUBJECT_HIDDEN);

export const isFiniteSubjectPoint = ({ x, y }: StampPoint) => Number.isFinite(x) && Number.isFinite(y);

/** The box round every ring of `area`. */
export const subjectAreaBox = (area: SubjectArea, pad = 0): StampBox => stampPolygonBox(area.rings.flat(), pad);

/** Problems with `area`: rings of fewer than 3 finite points, rings enclosing nothing, and rings that cross. */
export function subjectAreaProblems(area: SubjectArea, address: string): SubjectDiagnostic[] {
  const problems: SubjectDiagnostic[] = [];
  area.rings.forEach((ring, i) => {
    if (ring.length < 3 || !ring.every(isFiniteSubjectPoint) || stampRingArea(ring) === 0) {
      problems.push(subjectError('invalid-geometry', `${address}.rings[${i}]`, 'a ring needs at least 3 finite points enclosing some area', 'drop the ring, or trace it again'));
    }
  });
  if (problems.length) return problems;
  area.rings.forEach((a, i) => area.rings.slice(i + 1).forEach((b, k) => {
    if (stampRingsCross(a, b)) {
      problems.push(subjectError('invalid-geometry', `${address}.rings[${i}]`, `ring ${i} crosses ring ${i + k + 1}; rings are read even-odd and may only nest or sit apart`, 'union crossing rings before building the subject'));
    }
  }));
  return problems;
}

/** Problems with `path`: runs with fewer than 2 finite points, or a closed run of fewer than 3. */
export function subjectPathProblems(path: SubjectPath, address: string): SubjectDiagnostic[] {
  const problems: SubjectDiagnostic[] = [];
  path.runs.forEach((run, i) => {
    if (run.points.length < (run.closed ? 3 : 2) || !run.points.every(isFiniteSubjectPoint)) {
      problems.push(subjectError('invalid-geometry', `${address}.runs[${i}]`, 'a run needs at least 2 finite points (3 when closed)', 'drop the run, or trace it again'));
    }
  });
  return problems;
}

export function subjectLandmarkProblems(landmark: SubjectLandmarkPoint, address: string): SubjectDiagnostic[] {
  return isFiniteSubjectPoint(landmark.at) ? [] : [subjectError('invalid-geometry', `${address}.at`, 'a landmark needs a finite point', 'project it again, or mark it hidden')];
}

/** `check`'s problems with the geometry, when it shows; none when hidden. */
export const subjectVisibilityProblems = <G>(visibility: Visibility<G>, address: string, check: (geometry: G, address: string) => SubjectDiagnostic[]) =>
  (visibility.kind === 'visible' ? check(visibility.geometry, `${address}.visibility.geometry`) : []);

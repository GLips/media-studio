// subject-evidence.ts: what a projection measured about the subject's surface and light, each in one validated
// bundle. Evidence is not treatment: a normal field or a light direction says what is there, and a painter decides
// whether that becomes a soft gradation or a cel band.
//
// One convention throughout, so no reader guesses: view space with x right on the page, y down the page and z toward
// the viewer; normals and light directions are unit vectors in it.

import { subjectError, type SubjectDiagnostic } from './subject-diagnostic.ts';

export type SubjectVector3 = { readonly x: number; readonly y: number; readonly z: number };

/** The one coordinate convention evidence is written in, named so an adapter states it rather than assumes it. */
export type SubjectEvidenceConvention = 'view-x-right-y-down-z-toward-viewer';

/** Samples at cell corners from (x0, y0), `cell` document px apart, `columns` × `rows`, row by row. */
export type SubjectSampleLayout = { readonly x0: number; readonly y0: number; readonly cell: number; readonly columns: number; readonly rows: number };

/**
 * The visible surface, sampled. `coverage`: signed, positive inside the silhouette, about px from its edge. `normals`:
 * three per sample, unit length wherever coverage is positive (interpolated normals are renormalised before they get
 * here). `depth`: distance from the eye along the view, in px, finite wherever coverage is positive.
 */
export type SurfaceEvidence = {
  readonly convention: SubjectEvidenceConvention;
  readonly layout: SubjectSampleLayout;
  readonly coverage: Float32Array;
  readonly normals: Float32Array;
  readonly depth: Float32Array;
};

/** A light: the unit direction toward it, and its strength against the key's 1. */
export type SubjectLight = { readonly direction: SubjectVector3; readonly intensity: number };

/**
 * The light the subject was seen under. `terminator`: the cosine to the key below which the design reads as shade,
 * when the subject's own look authors one (a toon's threshold); a painter picks its own otherwise.
 */
export type IlluminationEvidence = {
  readonly convention: SubjectEvidenceConvention;
  readonly key: SubjectLight;
  readonly fills: readonly SubjectLight[];
  readonly terminator?: number;
};

export type SubjectEvidenceKind = 'surface' | 'illumination';

/** How far from 1 a unit vector's length may stray: float32 round-off, not an unnormalised interpolation. */
const UNIT_TOLERANCE = 1e-3;

const isUnit = (x: number, y: number, z: number) => Math.abs(Math.hypot(x, y, z) - 1) <= UNIT_TOLERANCE;

export function surfaceEvidenceProblems(surface: SurfaceEvidence, address: string): SubjectDiagnostic[] {
  const { layout, coverage, normals, depth } = surface;
  const counts = [layout.columns, layout.rows];
  if (!counts.every((n) => Number.isInteger(n) && n > 0) || !(layout.cell > 0) || !Number.isFinite(layout.x0) || !Number.isFinite(layout.y0)) {
    return [subjectError('invalid-evidence', `${address}.layout`, 'a sample layout needs whole positive columns and rows, a cell above 0 and a finite origin', 'rebuild the layout from the projection\'s grid')];
  }
  const size = layout.columns * layout.rows;
  const lengths: [string, Float32Array, number][] = [['coverage', coverage, size], ['normals', normals, 3 * size], ['depth', depth, size]];
  const wrong = lengths.filter(([, values, expected]) => values.length !== expected);
  if (wrong.length) {
    return wrong.map(([name, values, expected]) => subjectError('invalid-evidence', `${address}.${name}`, `${name} holds ${values.length} values; the layout needs ${expected}`, 'sample every field on the one layout'));
  }
  const isBad = (at: number) => !Number.isFinite(coverage[at])
    || (coverage[at] > 0 && (!isUnit(normals[3 * at], normals[3 * at + 1], normals[3 * at + 2]) || !Number.isFinite(depth[at])));
  let firstBad = -1, badCount = 0;
  for (let at = 0; at < size; at++) {
    if (!isBad(at)) continue;
    badCount++;
    if (firstBad < 0) firstBad = at;
  }
  return badCount
    ? [subjectError('invalid-evidence', `${address}.normals`, `${badCount} covered samples (first at ${firstBad}) have a non-unit normal, or a non-finite depth or coverage`, 'renormalise interpolated normals, and write depth wherever coverage is positive')]
    : [];
}

export function illuminationEvidenceProblems(illumination: IlluminationEvidence, address: string): SubjectDiagnostic[] {
  const problems: SubjectDiagnostic[] = [];
  const lights: [string, SubjectLight][] = [['key', illumination.key], ...illumination.fills.map((light, i): [string, SubjectLight] => [`fills[${i}]`, light])];
  for (const [name, { direction: d, intensity }] of lights) {
    if (!isUnit(d.x, d.y, d.z)) problems.push(subjectError('invalid-evidence', `${address}.${name}.direction`, 'a light direction is a unit vector toward the light', 'normalise it'));
    if (!(intensity > 0) || !Number.isFinite(intensity)) problems.push(subjectError('invalid-evidence', `${address}.${name}.intensity`, 'a light\'s intensity is finite and above 0', 'drop the light, or give it a strength'));
  }
  const { terminator } = illumination;
  if (terminator !== undefined && !(terminator >= -1 && terminator <= 1)) {
    problems.push(subjectError('invalid-evidence', `${address}.terminator`, 'a terminator is a cosine, -1..1', 'give the look\'s threshold as a cosine to the key'));
  }
  return problems;
}

/** The key light's direction on the page (y down), unit length; undefined when it points straight along the view. */
export function subjectKeyPageDirection(illumination: IlluminationEvidence): { x: number; y: number } | undefined {
  const { x, y } = illumination.key.direction, length = Math.hypot(x, y);
  return length > UNIT_TOLERANCE ? { x: x / length, y: y / length } : undefined;
}

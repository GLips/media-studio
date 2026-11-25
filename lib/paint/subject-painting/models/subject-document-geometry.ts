// subject-document-geometry.ts: a subject's geometry in the painting document's terms, at the painter boundary. A
// subject knows nothing of documents; a painter converts what it lays here, so every painter converts alike.

import type { Region, Subpath } from '#lib/paint/document/models/painting-document.ts';
import { subjectAreasUnion } from '#lib/paint/subject/models/subject-area-union.ts';
import type { SubjectArea, SubjectPath } from '#lib/paint/subject/models/subject-geometry.ts';

/** One area as a polygon region, read even-odd: its holes stay holes. */
export const subjectAreaRegion = (area: SubjectArea): Region => ({ kind: 'polygon', rings: area.rings });

/**
 * Areas as one polygon region, as a painter washes several parts together: their union, so parts meeting along a seam
 * lay one shape. Empty when they enclose nothing.
 */
export const subjectAreasRegion = (areas: readonly SubjectArea[]): Region => ({ kind: 'polygon', rings: subjectAreasUnion(areas)?.rings ?? [] });

/** A path's runs as stroke subpaths at `pressure`, a closed run returning to its first point. */
export const subjectPathSubpaths = (path: SubjectPath, pressure = 1): Subpath[] => path.runs.map(({ points, closed }) =>
  [...points, ...(closed ? [points[0]] : [])].map(({ x, y }) => ({ x, y, pressure })));

// subject-document-geometry.ts: a subject's geometry in the painting document's terms, at the painter boundary. A
// subject knows nothing of documents; a painter converts what it lays here, so every painter converts alike.

import type { Region, Subpath } from '#lib/paint/document/models/painting-document.ts';
import type { SubjectArea, SubjectPath } from '#lib/paint/subject/models/subject-geometry.ts';

/**
 * One area as a polygon region, read even-odd: its holes stay holes. Parts washed together go through
 * subjectAreasUnion first, since their touching seams would read as crossing rings.
 */
export const subjectAreaRegion = (area: SubjectArea): Region => ({ kind: 'polygon', rings: area.rings });

/** A path's runs as stroke subpaths at `pressure`, a closed run returning to its first point. */
export const subjectPathSubpaths = (path: SubjectPath, pressure = 1): Subpath[] => path.runs.map(({ points, closed }) =>
  [...points, ...(closed ? [points[0]] : [])].map(({ x, y }) => ({ x, y, pressure })));

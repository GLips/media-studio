// subject-area-union.ts: several areas as one, for a painter that washes parts together. Parts' areas meet along
// their seams, and touching rings read even-odd side by side are a crossing the painting check refuses, so the union
// is drawn afresh: each area filled even-odd on a fine grid, the fills combined, and the result traced as rings.

import { stampPolygonBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { SubjectSampleLayout } from './subject-evidence.ts';
import type { SubjectArea, SubjectRing } from './subject-geometry.ts';
import { traceSubjectMaskRings } from './subject-three-raster.ts';

/** The grid the union is drawn on, px: under a brush's finest edge, so tracing moves no edge a viewer would see. */
const SUBJECT_UNION_CELL_PX = 1;

/** Marks in `inside` the samples of row `j` that `rings` enclose, read even-odd. */
function fillSubjectAreaRow(layout: SubjectSampleLayout, rings: readonly SubjectRing[], j: number, inside: Uint8Array, row: Uint8Array) {
  const y = layout.y0 + j * layout.cell, crossings: number[] = [];
  for (const ring of rings) {
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      // Half-open in y, so a vertex on the row counts once.
      if ((a.y <= y) !== (b.y <= y)) crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  crossings.sort((p, q) => p - q);
  row.fill(0);
  for (let k = 0; k + 1 < crossings.length; k += 2) {
    const i0 = Math.max(0, Math.ceil((crossings[k] - layout.x0) / layout.cell)), i1 = Math.min(layout.columns - 1, Math.floor((crossings[k + 1] - layout.x0) / layout.cell));
    for (let i = i0; i <= i1; i++) row[i] = 1;
  }
  for (let i = 0; i < layout.columns; i++) inside[j * layout.columns + i] |= row[i];
}

/** `areas` as one area, holes each keeps included; undefined when they enclose nothing. One area comes back as it is. */
export function subjectAreasUnion(areas: readonly SubjectArea[]): SubjectArea | undefined {
  if (areas.length === 1) return areas[0];
  const points = areas.flatMap(({ rings }) => rings.flat());
  if (!points.length) return undefined;
  const box = stampPolygonBox(points, 2 * SUBJECT_UNION_CELL_PX), cell = SUBJECT_UNION_CELL_PX;
  const layout: SubjectSampleLayout = {
    x0: Math.floor(box.x0), y0: Math.floor(box.y0), cell,
    columns: Math.ceil((box.x1 - Math.floor(box.x0)) / cell) + 1, rows: Math.ceil((box.y1 - Math.floor(box.y0)) / cell) + 1,
  };
  const inside = new Uint8Array(layout.columns * layout.rows), row = new Uint8Array(layout.columns);
  for (const { rings } of areas) for (let j = 0; j < layout.rows; j++) fillSubjectAreaRow(layout, rings, j, inside, row);
  const rings = traceSubjectMaskRings(layout, (k) => inside[k] === 1);
  return rings.length ? { rings: [rings[0], ...rings.slice(1)] } : undefined;
}

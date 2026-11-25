// subject-paint-outline.ts: where a painter's paint may leave the figure. The silhouette is the figure's edge against
// the world (paper, or footage under a clear painting), and a painter may let paint run past it there: a wash bleeding
// into wet paper, a dry brush overshooting. Inside the figure, parts still meet as their intent says. So a paint area
// is its parts' region with each stretch lying on the silhouette edged apart, never a clip to the outline.

import { paintingRegionRings } from '#lib/paint/document/models/painting-area-compile.ts';
import type { Boundary, Edge, EdgedRegion, Region } from '#lib/paint/document/models/painting-document.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { Subject } from '#lib/paint/subject/models/subject.ts';

/** Asks whether a point lies on the subject's silhouette, within the tolerance its tracing leaves. */
export type SubjectOutlineReader = { readonly tolerance: number; readonly onOutline: (point: StampPoint) => boolean };

/**
 * The silhouette, indexed by grid cell. Parts and their unions are traced apart from the silhouette (a union on a 1 px
 * grid, a projection on its sample cell), so a part's edge on the silhouette wanders up to a cell and a half from it.
 */
export function subjectOutlineReader(subject: Subject): SubjectOutlineReader {
  if (subject.silhouette.kind === 'hidden') return { tolerance: 1, onOutline: () => false };
  const tolerance = Math.max(2.5, 1.5 * (subject.surface?.layout.cell ?? 1));
  const cells = new Map<string, [StampPoint, StampPoint][]>();
  for (const ring of subject.silhouette.geometry.rings) {
    ring.forEach((a, k) => {
      const b = ring[(k + 1) % ring.length];
      for (let i = Math.floor(Math.min(a.x, b.x) / tolerance); i <= Math.floor(Math.max(a.x, b.x) / tolerance); i++) {
        for (let j = Math.floor(Math.min(a.y, b.y) / tolerance); j <= Math.floor(Math.max(a.y, b.y) / tolerance); j++) {
          const key = `${i},${j}`, list = cells.get(key);
          if (list) list.push([a, b]);
          else cells.set(key, [[a, b]]);
        }
      }
    });
  }
  const near = ({ x, y }: StampPoint, [a, b]: [StampPoint, StampPoint]) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
    return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)) < tolerance;
  };
  const onOutline = (point: StampPoint) => {
    const i = Math.floor(point.x / tolerance), j = Math.floor(point.y / tolerance);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) if (cells.get(`${i + di},${j + dj}`)?.some((segment) => near(point, segment))) return true;
    }
    return false;
  };
  return { tolerance, onOutline };
}

/**
 * `ring` with points added along each edge no further apart than `step`. A traced ring is simplified to its corners,
 * and a seam's two corners may both lie on the silhouette while the edge between them crosses the figure.
 */
function densified(ring: readonly StampPoint[], step: number): StampPoint[] {
  return ring.flatMap((a, k) => {
    const b = ring[(k + 1) % ring.length], count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    return Array.from({ length: count }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / count, y: a.y + ((b.y - a.y) * i) / count }));
  });
}

/** The stretches of `rings` lying on the silhouette, each as a path of the ring's own points, so it sits on its outline. */
function outlineStretches(reader: SubjectOutlineReader, rings: readonly (readonly StampPoint[])[]): StampPoint[][] {
  return rings.map((ring) => densified(ring, reader.tolerance)).flatMap((ring) => {
    const on = ring.map(reader.onOutline);
    if (on.every(Boolean)) return [[...ring, ring[0]]];
    const start = on.indexOf(false);
    if (start < 0) return [];
    const stretches: StampPoint[][] = [];
    let current: StampPoint[] = [];
    for (let k = 1; k <= ring.length; k++) {
      const i = (start + k) % ring.length;
      // A stretch holds its on points alone: the next point off the silhouette may lie along an edge inside the figure.
      if (on[i]) current.push(ring[i]);
      else if (current.length) {
        stretches.push(current);
        current = [];
      }
    }
    return stretches.filter((stretch) => stretch.length > 1);
  });
}

/**
 * `region` edged `inside` along its outline within the figure and `outline` wherever it lies on the silhouette. No
 * `outline` leaves the whole outline `inside`'s, as a wash stopping at the figure's edge.
 */
export function subjectOutlineEdgedRegion(reader: SubjectOutlineReader, region: Region, edges: { readonly inside?: Edge; readonly outline?: Edge }): EdgedRegion {
  const { inside, outline } = edges;
  const boundaries: Boundary[] = outline ? outlineStretches(reader, paintingRegionRings(region)).map((path) => ({ path, edge: outline })) : [];
  return { region, ...(inside && { edge: inside }), ...(boundaries.length && { boundaries }) };
}

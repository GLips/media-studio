// subject-light-zones.ts: where the key light falls on a subject, read from its evidence. The surface's normals
// against the key give a cosine per sample; a painter asks for a band of it (the shade below the terminator, a core
// just past it) inside some parts' areas and gets rings to fill. How a band is painted, soft or as a cel, is the
// painter's: this only says where the light is.
//
// Negative space: fill lights move no band. A painter that models them reads `illumination.fills` itself.

import { stampGridContours, stampRingArea, type StampGrid } from '#lib/paint/painting/models/stamp-region.ts';
import type { SubjectWithEvidence } from '#lib/paint/subject/models/subject-check.ts';
import type { SubjectSampleLayout } from '#lib/paint/subject/models/subject-evidence.ts';
import type { SubjectArea, SubjectRing } from '#lib/paint/subject/models/subject-geometry.ts';

/** A subject a light-reading painter paints: its surface sampled and the light it was seen under. */
export type LitSubject = SubjectWithEvidence<'surface' | 'illumination'>;

/**
 * How a painter models the light. `soft`: graded shade melting into the light, read over the whole mass. `cel`: the shade
 * as one crisp band, the quiet cel of vid-144's hand-painted frog. `cel-full`: a half-tone, the shade and a core.
 */
export type SubjectLightTreatment = 'soft' | 'cel' | 'cel-full';

/** Every light treatment, softest first: `soft` (feathered turn and shade), `cel` (one crisp shade), `cel-full` (half-tone, shade and core). */
export const SUBJECT_LIGHT_TREATMENTS: readonly SubjectLightTreatment[] = ['soft', 'cel', 'cel-full'];

/** Where the key's cosine lies strictly between `above` and `below`; an end left out is open. */
export type SubjectLightBand = { readonly above?: number; readonly below?: number };

/**
 * The key's cosine per sample of the surface layout. Samples just outside the silhouette take their covered
 * neighbours' mean, so a band reaching the edge runs past it and a clip, not the sampling, sets the edge.
 * `terminator`: the subject's own when its look authors one, else the painter's.
 */
export type SubjectLightField = {
  readonly layout: SubjectSampleLayout;
  readonly cosine: Float32Array;
  readonly known: Uint8Array;
  readonly terminator: number;
};

/** Rounds of reaching uncovered samples from covered ones: past the one-sample growth a zone's mask takes. */
const EXTEND_ROUNDS = 3;

/**
 * `massPx`: how wide a reach the light is read over, px; 0 reads each sample's own normal. Read wider, the small turns
 * where a figure's pieces meet (an arm on a body, a primitive's seams) melt into the light on the whole mass, as a
 * painter squints to see it.
 */
export function subjectLightField(subject: LitSubject, painterTerminator: number, massPx = 0): SubjectLightField {
  const { layout, coverage, normals } = subject.surface, { direction } = subject.illumination.key;
  const size = layout.columns * layout.rows;
  const cosine = new Float32Array(size), known = new Uint8Array(size);
  for (let at = 0; at < size; at++) {
    if (!(coverage[at] > 0)) continue;
    cosine[at] = normals[3 * at] * direction.x + normals[3 * at + 1] * direction.y + normals[3 * at + 2] * direction.z;
    known[at] = 1;
  }
  const reach = Math.round(massPx / layout.cell / 2);
  if (reach > 0) massLightField(layout, cosine, known, reach);
  for (let round = 0; round < EXTEND_ROUNDS; round++) extendLightField(layout, cosine, known);
  return { layout, cosine, known, terminator: subject.illumination.terminator ?? painterTerminator };
}

/** Three box blurs `reach` samples wide each way, near a Gaussian, over known samples only: the silhouette's outside never darkens its edge. */
function massLightField({ columns, rows }: SubjectSampleLayout, cosine: Float32Array, known: Uint8Array, reach: number) {
  const sum = new Float32Array(cosine.length), weight = new Float32Array(cosine.length);
  for (let at = 0; at < cosine.length; at++) [sum[at], weight[at]] = known[at] ? [cosine[at], 1] : [0, 0];
  const pass = (values: Float32Array, along: 'row' | 'column') => {
    const out = new Float32Array(values.length), [lines, length] = along === 'row' ? [rows, columns] : [columns, rows];
    for (let line = 0; line < lines; line++) {
      const at = (k: number) => (along === 'row' ? line * columns + k : k * columns + line);
      let running = 0;
      for (let k = -reach; k < length + reach; k++) {
        if (k + reach < length && k + reach >= 0) running += values[at(k + reach)];
        if (k - reach - 1 >= 0 && k - reach - 1 < length) running -= values[at(k - reach - 1)];
        if (k >= 0 && k < length) out[at(k)] = running;
      }
    }
    return out;
  };
  let s = sum, w = weight;
  for (let round = 0; round < 3; round++) {
    s = pass(pass(s, 'row'), 'column');
    w = pass(pass(w, 'row'), 'column');
  }
  for (let at = 0; at < cosine.length; at++) if (known[at] && w[at] > 0) cosine[at] = s[at] / w[at];
}

/** One round: every unknown sample beside a known one takes its known neighbours' mean. */
function extendLightField({ columns, rows }: SubjectSampleLayout, cosine: Float32Array, known: Uint8Array) {
  const reached: [number, number][] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      if (known[j * columns + i]) continue;
      let sum = 0, count = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= columns || nj >= rows || !known[nj * columns + ni]) continue;
          sum += cosine[nj * columns + ni];
          count++;
        }
      }
      if (count) reached.push([j * columns + i, sum / count]);
    }
  }
  for (const [at, value] of reached) {
    cosine[at] = value;
    known[at] = 1;
  }
}

/** The samples of a window of the layout: `i0, j0` its first column and row in the layout's indices. */
type SampleWindow = { readonly i0: number; readonly j0: number; readonly columns: number; readonly rows: number };

/** The layout's window round `areas`, `pad` samples wider on every side. */
function windowRound(layout: SubjectSampleLayout, areas: readonly SubjectArea[], pad: number): SampleWindow {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { rings } of areas) {
    for (const ring of rings) {
      for (const { x, y } of ring) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  }
  const i0 = Math.floor((x0 - layout.x0) / layout.cell) - pad, j0 = Math.floor((y0 - layout.y0) / layout.cell) - pad;
  const i1 = Math.ceil((x1 - layout.x0) / layout.cell) + pad, j1 = Math.ceil((y1 - layout.y0) / layout.cell) + pad;
  return { i0, j0, columns: i1 - i0 + 1, rows: j1 - j0 + 1 };
}

/** Which of the window's samples lie inside `areas`, read even-odd, as scanlines cross their rings. */
function areaMask(layout: SubjectSampleLayout, window: SampleWindow, areas: readonly SubjectArea[]): Uint8Array {
  const mask = new Uint8Array(window.columns * window.rows);
  const rings = areas.flatMap(({ rings: areaRings }) => areaRings);
  for (let j = 0; j < window.rows; j++) {
    const y = layout.y0 + (window.j0 + j) * layout.cell;
    const crossings: number[] = [];
    for (const ring of rings) {
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k], b = ring[(k + 1) % ring.length];
        if ((a.y <= y) !== (b.y <= y)) crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil((crossings[k] - layout.x0) / layout.cell) - window.i0);
      const to = Math.min(window.columns - 1, Math.floor((crossings[k + 1] - layout.x0) / layout.cell) - window.i0);
      for (let i = from; i <= to; i++) mask[j * window.columns + i] = 1;
    }
  }
  return mask;
}

/** `mask` grown by one sample each way, so a band reaches past an area's edge for its clip to trim. */
function grownMask(mask: Uint8Array, { columns, rows }: SampleWindow): Uint8Array {
  const grown = new Uint8Array(mask.length);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      if (!mask[j * columns + i]) continue;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di, nj = j + dj;
          if (ni >= 0 && nj >= 0 && ni < columns && nj < rows) grown[nj * columns + ni] = 1;
        }
      }
    }
  }
  return grown;
}

/**
 * The rings, read even-odd, where the key's cosine lies in `band` over `areas` (a little past their edges: clip the
 * fill to the areas). Empty when the band misses them. Contours of one field never cross, so the rings make a region.
 */
export function subjectLightZoneRings(field: SubjectLightField, areas: readonly SubjectArea[], band: SubjectLightBand): SubjectRing[] {
  if (!areas.length) return [];
  const { layout } = field;
  // Two samples of border stay below the level, as stampGridContours needs to close every loop.
  const window = windowRound(layout, areas, 3);
  const mask = grownMask(areaMask(layout, window, areas), window);
  const values = new Float32Array(window.columns * window.rows).fill(-1);
  const above = band.above ?? -Infinity, below = band.below ?? Infinity;
  let any = false;
  for (let j = 1; j < window.rows - 1; j++) {
    for (let i = 1; i < window.columns - 1; i++) {
      const li = window.i0 + i, lj = window.j0 + j, at = j * window.columns + i;
      if (!mask[at] || li < 0 || lj < 0 || li >= layout.columns || lj >= layout.rows) continue;
      const from = lj * layout.columns + li;
      if (!field.known[from]) continue;
      const c = field.cosine[from];
      // Capped at 1 so an open end doesn't make the field infinite; the contour only needs the sign.
      values[at] = Math.min(1, c - above, below - c);
      if (values[at] > 0) any = true;
    }
  }
  if (!any) return [];
  const grid: StampGrid = { x0: layout.x0 + window.i0 * layout.cell, y0: layout.y0 + window.j0 * layout.cell, cell: layout.cell, columns: window.columns, rows: window.rows, values };
  // A ring under two cells across is the sampling's noise, not a shape of the light.
  const speck = 2 * layout.cell * layout.cell;
  return stampGridContours(grid, 0).filter((ring) => Math.abs(stampRingArea(ring)) > speck);
}

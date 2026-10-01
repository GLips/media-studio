// paint-figure-shapes.ts: the one value every figure source returns, and the shared stage that builds it from sampled
// fields: named parts (regions the engine fills, clips and masks with), the silhouette, interior lines and named
// anchors. Part and anchor names are literal unions inferred from the source's declaration, so a misspelt one
// doesn't compile.
//
// A source hands this stage, per part, `visible` (what of the part shows: signed, positive inside, about px from its
// edge) and `depth` (px from the eye; a 2D source ranks its parts), and `union`, the silhouette, signed as `visible`.

import { stampGridAt, type StampGrid, type StampPoint, type StampRegion } from '#lib/paint/painting/models/stamp-region.ts';
import { PAINT_FIGURE_TRACE_DEFAULTS, tracePaintFigurePieces, type PaintFigureTraceSettings } from './paint-figure-trace.ts';

/** One part as it shows: hidden in this pose and view, or shown as its visible pieces, largest first, holes filled. */
export type PaintFigurePart = { readonly kind: 'hidden' } | { readonly kind: 'shown'; readonly pieces: readonly [StampRegion, ...StampRegion[]] };

/** The part's largest visible piece, or undefined when its pose and view hide it. */
export const paintFigurePartRegion = (part: PaintFigurePart): StampRegion | undefined => (part.kind === 'shown' ? part.pieces[0] : undefined);

/** The part's visible pieces, largest first: none when it's hidden. */
export const paintFigurePartPieces = (part: PaintFigurePart): readonly StampRegion[] => (part.kind === 'shown' ? part.pieces : []);

/** The figure's outer edge: its largest piece as a region, every piece, and that region's loop closed as a path to stroke. */
export type PaintFigureSilhouette = {
  readonly region: StampRegion;
  readonly pieces: readonly StampRegion[];
  /** The region's loop, its first point repeated at the end. */
  readonly outline: readonly StampPoint[];
};

/** A figure from a shape source, in painting px. `P` names its parts, `A` its anchors. */
export type PaintFigureShapes<P extends string, A extends string> = {
  readonly parts: Readonly<Record<P, PaintFigurePart>>;
  readonly silhouette: PaintFigureSilhouette;
  /** Open paths where parts meet inside the silhouette, each drawn once, by the part in front. */
  readonly lines: readonly (readonly StampPoint[])[];
  readonly anchors: Readonly<Record<A, StampPoint>>;
};

/** Where a source sampled its fields: cell corners from (x0, y0), `cell` px apart, row by row. */
export type PaintFigureSampling = { readonly x0: number; readonly y0: number; readonly cell: number; readonly columns: number; readonly rows: number };

/** A source's sampled fields, parts in declaration order (which breaks ties between parts that meet at equal depth). */
export type PaintFigureFields<P extends string> = {
  readonly sampling: PaintFigureSampling;
  readonly union: Float32Array;
  readonly parts: readonly { readonly name: P; readonly visible: Float32Array; readonly depth: Float32Array }[];
};

const polygon = (points: readonly StampPoint[]): StampRegion => ({ kind: 'polygon', points });

/**
 * Snaps a box to whole cells, padded by `pad` cells, so a figure's grid never shifts by a fraction of a cell as it
 * moves, and a still part traces the same in every pose.
 */
export function paintFigureSampling(box: { x0: number; y0: number; x1: number; y1: number }, cell: number, pad = 3): PaintFigureSampling {
  const x0 = (Math.floor(box.x0 / cell) - pad) * cell, y0 = (Math.floor(box.y0 / cell) - pad) * cell;
  const columns = Math.ceil(box.x1 / cell) + pad - Math.floor(box.x0 / cell) + pad + 1;
  const rows = Math.ceil(box.y1 / cell) + pad - Math.floor(box.y0 / cell) + pad + 1;
  return { x0, y0, cell, columns, rows };
}

const gridOf = (sampling: PaintFigureSampling, values: Float32Array): StampGrid => ({ ...sampling, values });

/**
 * Interior lines from one part's traced loop: the runs inside the silhouette (by more than a cell) where this part is
 * nearer than the part across its edge, so each edge is drawn once, by the part in front. Where two parts meet at
 * one depth (cutting into each other), the earlier-declared part draws it.
 */
function partLines(loop: readonly StampPoint[], index: number, cell: number, union: StampGrid, grids: readonly { visible: StampGrid; depth: StampGrid }[]): StampPoint[][] {
  const drawsHere = (p: StampPoint) => {
    if (stampGridAt(union, p.x, p.y) <= cell) return false;
    let across = -1, best = -Infinity;
    grids.forEach((grid, k) => {
      if (k === index) return;
      const value = stampGridAt(grid.visible, p.x, p.y);
      if (value > best) { best = value; across = k; }
    });
    if (across < 0) return false;
    const nearer = stampGridAt(grids[across].depth, p.x, p.y) - stampGridAt(grids[index].depth, p.x, p.y);
    // Depth read between samples is coarse where a surface turns away, so a meeting counts as level within a few cells.
    return nearer > 4 * cell || (nearer >= -4 * cell && index < across);
  };
  const flags = loop.map(drawsHere);
  const runs: StampPoint[][] = [];
  let run: StampPoint[] = [];
  loop.forEach((p, i) => {
    if (flags[i]) run.push(p);
    else if (run.length) { runs.push(run); run = []; }
  });
  if (run.length) {
    // A run through the loop's first point continues from its last.
    if (flags[0] && runs.length) runs[0] = [...run, ...runs[0]];
    else runs.push(run);
  }
  const longEnough = (points: StampPoint[]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0) >= 3 * cell;
  return runs.filter((points) => points.length >= 3 && longEnough(points));
}

/** The shared stage: traces every part's visible field, the union and the lines between parts. */
export function paintFigureShapesFromFields<P extends string, A extends string>(
  fields: PaintFigureFields<P>,
  anchors: Readonly<Record<A, StampPoint>>,
  trace: PaintFigureTraceSettings = PAINT_FIGURE_TRACE_DEFAULTS,
): PaintFigureShapes<P, A> {
  const union = gridOf(fields.sampling, fields.union);
  const outlines = tracePaintFigurePieces(union, trace);
  if (outlines.length === 0) throw new Error('paintFigureShapesFromFields: the figure has no area; its parts are all empty');
  const grids = fields.parts.map((part) => ({ visible: gridOf(fields.sampling, part.visible), depth: gridOf(fields.sampling, part.depth) }));
  const traced = fields.parts.map((part, k) => ({ name: part.name, pieces: tracePaintFigurePieces(grids[k].visible, trace) }));
  // SAFETY: filled below from fields.parts, which a source builds with every name its declaration has, once each.
  const parts = {} as Record<P, PaintFigurePart>;
  for (const { name, pieces: [largest, ...rest] } of traced) parts[name] = largest ? { kind: 'shown', pieces: [polygon(largest), ...rest.map(polygon)] } : { kind: 'hidden' };
  const lines = traced.flatMap(({ pieces }, k) => pieces.flatMap((loop) => partLines(loop, k, fields.sampling.cell, union, grids)));
  return {
    parts,
    silhouette: { region: polygon(outlines[0]), pieces: outlines.map(polygon), outline: [...outlines[0], outlines[0][0]] },
    lines,
    anchors,
  };
}

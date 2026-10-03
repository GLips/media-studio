// stamp-flood-rows.ts: which way a flood's strokes run beside its outline (vid-119).
//
// A lopsided tip lays more paint on one side. Its edge contour and its rows follow one rule (stampFloodTurned): run
// so the shorter side faces the outline beside them, its body as near the line as its paint lets it. A row keeps in
// where its own footprint, the way it heads, clears the outline (stampFootprintKeepsIn).
import type { StampBrushEdgeReach } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { stampGridAt, type StampGrid, type StampPoint } from './stamp-region.ts';

/**
 * Whether a stroke of a lopsided tip runs back along its path so its shorter side, by its reach toward every way,
 * faces the outline, which lies on the path's `outline` side; its far side, often a faint tail (Sparse Bristle's
 * bristles), then lies over the inside.
 */
export function stampFloodTurned({ left, right }: StampBrushEdgeReach, outline: 'left' | 'right'): boolean {
  let leftward = 0, rightward = 0;
  for (let k = 0; k < left.length; k++) {
    leftward += left[k];
    rightward += right[k];
  }
  return (leftward < rightward ? 'left' : 'right') !== outline;
}

/**
 * Whether a row from `from` to `to` runs back, to turn a lopsided tip's shorter side to the nearer outline, as the
 * edge contour does; false for a row no outline lies beside.
 */
export type StampFloodRowTurned = (from: StampPoint, to: StampPoint) => boolean;

/**
 * A flood's StampFloodRowTurned: the side the outline lies on, summed along the row where either side's paint could
 * reach it (within `margin`) and it lies more beside the row than ahead, as the distance falls toward it. Where an
 * outline only crosses a row it weighs nothing, so a row with none beside it keeps its way.
 */
export function stampFloodRowTurned(field: StampGrid, edge: StampBrushEdgeReach, margin: number): StampFloodRowTurned {
  // Read a quarter of `near` apart, a cell at least: which side the outline lies on changes over no less.
  const near = Math.max(...edge.left, ...edge.right) + margin, step = Math.max(field.cell, near / 4);
  return (from, to) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y), ux = (to.x - from.x) / length, uy = (to.y - from.y) / length;
    // A cell to its right, y down.
    const nx = -uy * field.cell, ny = ux * field.cell, beside = field.cell * Math.SQRT2;
    let toward = 0;
    for (let t = 0; t <= length; t += step) {
      const x = from.x + ux * t, y = from.y + uy * t, at = stampGridAt(field, x, y);
      if (!(at > 0 && at < near)) continue;
      const across = stampGridAt(field, x - nx, y - ny) - stampGridAt(field, x + nx, y + ny);
      // The distance rises a px a px away from the outline: this much over the two cells, it lies within 45° of beside.
      if (Math.abs(across) > beside) toward += across;
    }
    return toward !== 0 && stampFloodTurned(edge, toward > 0 ? 'right' : 'left');
  };
}

// painting-area-compile.ts: a document's regions and edges as the engine's areas (stamp-area.ts). A region's rings
// read even-odd; an edge's line is the region's outline. `crisp` is the outline, a pixel's antialiasing wide;
// `feather` ramps coverage over its width inside the line; `bleed` ramps it over its reach centred past the line, as a
// flood's lost edge does (stampFloodBarrier). A roughness moves the line by noise seeded by its own seed, never a key.

import { compileStampArea, stampRegionSeed, type CompiledStampArea } from '#lib/paint/painting/models/stamp-area.ts';
import type { StampBoundaries, StampBoundary } from '#lib/paint/painting/models/stamp-area-boundaries.ts';
import { stampPolygonInside, stampRegionPolygon, type StampEdge, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { Boundary, Edge, EdgedRegion, Region } from './painting-document.ts';

/** `region`'s rings, an ellipse traced as stampRegionPolygon traces one. */
export function paintingRegionRings(region: Region): (readonly StampPoint[])[] {
  if (region.kind === 'polygon') return [...region.rings];
  const { center, radiusX, radiusY } = region;
  return [stampRegionPolygon({ kind: 'ellipse', x: center.x, y: center.y, radiusX, radiusY })];
}

/** Each ring of `rings` that an even number of the others hold: an outline or an island, never a hole. */
export function paintingOuterRings(rings: readonly (readonly StampPoint[])[]): (readonly StampPoint[])[] {
  return rings.filter((ring, i) => {
    const [{ x, y }] = ring;
    return rings.filter((other, j) => j !== i && stampPolygonInside(other, x, y)).length % 2 === 0;
  });
}

/** `edge` as the engine's edge on an area: its width, its ragged line, and how far its ramp's middle lies inside. */
export function paintingStampEdge(edge: Edge | undefined): { edge?: StampEdge; inset: number } {
  const ragged = edge?.roughness && { amount: edge.roughness.amountPx, scale: edge.roughness.featurePx };
  if (!edge || edge.kind === 'crisp') return { ...(ragged && { edge: { ragged } }), inset: 0 };
  if (edge.kind === 'feather') return { edge: { soft: edge.widthPx, ...(ragged && { ragged }) }, inset: edge.widthPx / 2 };
  return { edge: { soft: edge.reachPx, ...(ragged && { ragged }) }, inset: -edge.reachPx / 2 };
}

/** A boundary's edge as a treatment of its stretch: kept crisp, feathered over its width, merged open over its reach. */
function stampBoundaryOf({ path, edge }: Boundary): StampBoundary {
  if (edge.kind === 'crisp') return { path, treatment: 'keep' };
  return edge.kind === 'feather' ? { path, treatment: 'feather', reach: edge.widthPx } : { path, treatment: 'merge', reach: edge.reachPx };
}

/** `boundaries` named by their place, as compileStampBoundaries reads them; none for none. */
export const paintingStampBoundaries = (boundaries: readonly Boundary[] | undefined): StampBoundaries | undefined =>
  (boundaries?.length ? Object.fromEntries(boundaries.map((boundary, i) => [`boundaries[${i}]`, stampBoundaryOf(boundary)])) : undefined);

/** `area` compiled, `what` naming it in errors: its rings, its outline's edge and its stretches, its roughness seeded by its own seed. */
export function compilePaintingArea({ region, edge, boundaries }: EdgedRegion, what: string): CompiledStampArea {
  const stamped = paintingStampEdge(edge), treated = paintingStampBoundaries(boundaries);
  return compileStampArea({
    rings: paintingRegionRings(region), ...(stamped.edge && { edge: stamped.edge }), inset: stamped.inset, ...(treated && { boundaries: treated }),
    seed: edge?.roughness ? stampRegionSeed(edge.roughness.seed) : 0,
  }, what);
}

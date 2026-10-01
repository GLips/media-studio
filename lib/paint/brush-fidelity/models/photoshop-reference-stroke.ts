// photoshop-reference-stroke.ts: a brush painted as the Photoshop rig paints its reference S-curve, so the fidelity
// sheet sets like beside like: the rig's own polyline, in the Procreate preview's frame the reference is cropped to,
// under Photoshop's simulated pressure, at the reference's diameter.
//
// Simulated pressure (photoshop-stroke-pressure.ts) drives pen-pressure dynamics, count included, as a pen would; a
// brush with none paints untapered.

import { photoshopMarkStrokes, type PhotoshopBox } from '#lib/paint/photoshop-brushes/models/photoshop-capture-plan.ts';
import { PROCREATE_PREVIEW_SIZE } from '#lib/paint/procreate-brushes/models/procreate-preview-stroke.ts';
import type { PhotoshopPressureContext } from '#lib/paint/photoshop-brushes/models/photoshop-brush.ts';
import { photoshopPressuredPath } from '#lib/paint/photoshop-brushes/models/photoshop-stroke-pressure.ts';
import type { StampBrush, StampBrushLayer } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampDualNeedsDual } from '#lib/paint/brush/models/coverage-formulas.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';

/**
 * Where a brush's S-curve sits among a pack's reference sheets, its diameter in preview pixels once cropped, and how
 * the pen drove it: a Brush Pose's overrides linger after a posed cell of the same brush on the same sheet; applying a
 * brush, as the rig does per sheet, clears them.
 */
export type PhotoshopReferenceStroke = {
  sheet: string; box: PhotoshopBox; diameter: number; pressure: PhotoshopPressureContext; opacity: number;
  /** The other cells' paint that can reach the S-curve's frame (photoshopReferenceForeignStrokes). */
  foreign: PhotoshopForeignPaint;
};

/**
 * The farthest `brush`'s paint lands from its path at full size, in its diameters: a stamp strays up to its scatter,
 * and its tip, turned any way, reaches half its image's diagonal. Where a dual's mode leaves nothing without the dual,
 * paint lands only where both do, so the nearer bounds it.
 */
export function stampBrushPaintReach(brush: StampBrush<unknown>): number {
  const { dual } = brush;
  return dual && stampDualNeedsDual(dual.blend) ? Math.min(layerReach(brush), dual.scale * layerReach(dual)) : layerReach(brush);
}

const layerReach = (layer: StampBrushLayer<unknown>) => Math.SQRT1_2 + Math.max(layer.scatter.radius, layer.scatter.lateral);

/** A stroke of another cell on the sheet, in the preview frame's pixels, and how far from it its paint can land. */
export type PhotoshopForeignStroke = { points: [number, number][]; reach: number };

/** Other cells' `strokes` near an S-curve, and its core: how far from its path, in preview pixels, an unscattered tip paints. */
export type PhotoshopForeignPaint = { strokes: PhotoshopForeignStroke[]; ownCore: number };

/**
 * The rig lays cells edge to edge, so a neighbour's stray paint lands in the S-curve's (Spatter Spread's overlap
 * scatters dots 50 px into it, Stain Damp Paper 2's line a blot). Every other cell's stroke near `frame`, in the
 * preview's pixels, reaching its brush's reach (reachOf) times the diameter it was painted at.
 */
export function photoshopReferenceForeignStrokes(
  cells: readonly { item: string; box: PhotoshopBox; strokes: readonly (readonly [number, number])[][] }[], own: PhotoshopBox, frame: { x: number; y: number; width: number; height: number },
  diameterOf: (item: string) => number, reachOf: (item: string) => number,
): PhotoshopForeignStroke[] {
  const scale = PROCREATE_PREVIEW_SIZE.width / frame.width;
  return cells.filter(({ box }) => box.x !== own.x || box.y !== own.y).flatMap(({ item, strokes }) => {
    const reach = reachOf(item) * diameterOf(item);
    return strokes.flatMap((stroke) => {
      // Only a stroke whose paint can reach the frame.
      const near = stroke.some(([x, y]) => x > frame.x - reach && x < frame.x + frame.width + reach && y > frame.y - reach && y < frame.y + frame.height + reach);
      if (!near) return [];
      // Points a quarter of the reach apart are plenty to clear by; the rig's curves come 8 px apart.
      const kept = stroke.filter((p, i) => i === 0 || i === stroke.length - 1 || i % Math.max(1, Math.floor(reach / 32)) === 0);
      return [{ points: kept.map(([x, y]): [number, number] => [(x - frame.x) * scale, (y - frame.y) * scale]), reach: reach * scale }];
    });
  });
}

/**
 * `coverage` (the preview frame's, `width` × `height`) with what other cells could have laid cleared, from the target
 * and ours alike, but for the S-curve's core: a neighbour's scatter can span a frame (Large Roses with Chroma's). Not
 * by which path is nearer: Stain Damp Paper 2's stray blot lies nearer its S-curve than its own line.
 */
export function clearPhotoshopForeignPaint(coverage: Uint8Array, width: number, height: number, { strokes, ownCore }: PhotoshopForeignPaint): Uint8Array {
  const own = pathSegments(photoshopReferenceStrokePath().map(({ x, y }): [number, number] => [x, y]));
  for (const { points, reach } of strokes) {
    const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - reach)), x1 = Math.min(width - 1, Math.ceil(Math.max(...xs) + reach));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - reach)), y1 = Math.min(height - 1, Math.ceil(Math.max(...ys) + reach));
    const segments = pathSegments(points);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!coverage[y * width + x]) continue;
        const px = x + 0.5, py = y + 0.5;
        const near = (path: [number, number][][], r: number) => path.some(([[ax, ay], [bx, by]]) => segmentDistance(px, py, ax, ay, bx, by) <= r);
        if (near(segments, reach) && !near(own, ownCore)) coverage[y * width + x] = 0;
      }
    }
  }
  return coverage;
}

const pathSegments = (points: [number, number][]): [number, number][][] => (points.length === 1 ? [[points[0], points[0]]] : points.slice(1).map((p, i) => [points[i], p]));

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** The rig's S-curve in the preview's pixels, each point carrying the simulated pressure at its share of the length. */
export function photoshopReferenceStrokePath(): StampStrokePoint[] {
  const [points] = photoshopMarkStrokes('sCurve', { x: 0, y: 0, ...PROCREATE_PREVIEW_SIZE }, 0);
  return photoshopPressuredPath(points, { kind: 'simulated' });
}

/**
 * `brush` painted along the rig's S-curve at `diameter` (in the preview's pixels), in black, under simulated pressure:
 * the brush as read under its reference stroke's `pressure`. A glaze at the tool `opacity` Photoshop painted it at
 * (a tool preset's own, which scales a built stroke's coverage), so the painting's darkness is its coverage.
 */
export function photoshopReferencePainting(brush: StampBrush, diameter: number, opacity: number): CompiledStampPaint {
  const material = { kind: 'color', color: '#000000' } as const;
  return compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('reference', { composite: 'glaze', opacity }, (group) => group.pass('stroke', {}, (pass) => {
    pass.stroke('stroke', { brush, material, diameter, path: photoshopReferenceStrokePath() });
  }))));
}

// paint-motion.ts: a scene's motion built over its painting: compiled (paint-motion-compile.ts), then each node's warp
// checked for folds over a span of the scene. The check reads the warp each frame emits, boil wobble included, through
// the lattice the renderer lays it on (stampWarpTriangles over the group's painted box), so it judges the triangles
// that will actually be drawn.

import { STAMP_WARP_CELL, stampWarpCells, stampWarpTriangles } from '#lib/paint/painting/models/stamp-group-warp.ts';
import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { PAINT_ANIMATION_FPS } from '#lib/paint/painting/models/stamp-group-motion.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { paintAnimationFrameStart, type AnimationFrame } from './paint-clock.ts';
import { paintDeformMap, paintDeformShifts, paintWarpChainKey, paintWarpChainMap, type PaintWarpChain } from './paint-deform.ts';
import { compilePaintMotion, paintGroupPaintedBox, type PaintMotion, type PaintMotionNode, type PaintMotionPlay } from './paint-motion-compile.ts';
import { paintNodeWarpAt } from './paint-motion-frame.ts';

/** A motion built: usable, or the problems that keep it from being. */
export type PaintMotionBuild = { readonly ok: true; readonly motion: PaintMotion } | { readonly ok: false; readonly problems: readonly string[] };

/**
 * The worst-squeezed triangle of `map` over `box` on the renderer's lattice: its rest centroid and the ratio of its
 * area after to before. At or below 0 the map folds there: paint passes over paint, and the lattice shows a seam.
 */
export function paintWarpWorstFold(map: (rest: StampPoint) => StampPoint, box: StampBox): { at: StampPoint; det: number } {
  // As the renderer lays it: a pixel past the painted box, cells STAMP_WARP_CELL apart, at most STAMP_WARP_MOST_CELLS.
  const rest = { x: box.x0 - 1, y: box.y0 - 1, w: box.x1 - box.x0 + 2, h: box.y1 - box.y0 + 2 };
  const { columns, rows } = stampWarpCells(rest.w, rest.h, STAMP_WARP_CELL);
  const triangles = stampWarpTriangles(map, rest, columns, rows);
  let worst = { at: { x: box.x0, y: box.y0 }, det: Infinity };
  // Each triangle is three vertices of (scene x, scene y, rest x, rest y).
  for (let v = 0; v < triangles.length; v += 12) {
    const corner = (k: number, offset: number) => triangles[v + 4 * k + offset];
    const area = (offset: number) => (corner(1, offset) - corner(0, offset)) * (corner(2, offset + 1) - corner(0, offset + 1)) - (corner(1, offset + 1) - corner(0, offset + 1)) * (corner(2, offset) - corner(0, offset));
    const det = area(0) / area(2);
    if (det < worst.det) worst = { at: { x: (corner(0, 2) + corner(1, 2) + corner(2, 2)) / 3, y: (corner(0, 3) + corner(1, 3) + corner(2, 3)) / 3 }, det };
  }
  return worst;
}

/** What moves the paint at `rest` most along `chain`, each step read where the steps before it carried the point. */
function mostMoving(chain: PaintWarpChain, rest: StampPoint): { name: string; shift: number } {
  let point = rest, most = { name: 'nothing', shift: -1 };
  for (const step of chain) {
    for (const shift of paintDeformShifts(step, point)) if (shift.shift > most.shift) most = shift;
    point = paintDeformMap(step)(point);
  }
  return most;
}

/**
 * Every node whose warp folds its painted box at some animation frame from `from` to `to` scene seconds, once each,
 * naming the frame, the point and what moves paint most there. Frames sharing a warp key are checked once.
 */
export function paintMotionFolds(motion: PaintMotion, { from, to }: { from: number; to: number }): string[] {
  const fps = motion.animationFps, found: string[] = [];
  for (const node of motion.nodes.values()) {
    const box = paintGroupPaintedBox(node.group);
    if (!box) continue;
    const checked = new Set<string>();
    for (let frame = Math.ceil(from * fps - 1e-6); frame / fps <= to; frame++) {
      // SAFETY: a whole frame number on the animation grid.
      const t = paintAnimationFrameStart(frame as AnimationFrame, fps), { warp } = paintNodeWarpAt(motion, node, paintMoment(t)), key = paintWarpChainKey(warp);
      if (!warp.length || checked.has(key)) continue;
      checked.add(key);
      const { at, det } = paintWarpWorstFold(paintWarpChainMap(warp), box);
      if (det > 0) continue;
      const most = mostMoving(warp, at);
      found.push(`${node.id}: at ${t.toFixed(3)}s its warp folds near (${at.x.toFixed(0)}, ${at.y.toFixed(0)}), area ×${det.toFixed(2)}; ${most.name} moves paint there most (${most.shift.toFixed(1)} px)`);
      break;
    }
  }
  return found;
}

/**
 * `nodes` and `plays` built over `painting` (paint-motion-compile.ts names what's checked), and over `foldCheck`'s
 * scene seconds, any frame whose warp folds, naming what moves paint most there. A camera is built apart
 * (paint-camera-build.ts): it shows planes, never a node's lay.
 */
export function buildPaintMotion(
  painting: CompiledStampPaint,
  o: { nodes: readonly PaintMotionNode[]; plays: readonly PaintMotionPlay[]; animationFps?: number; foldCheck?: { from: number; to: number } },
): PaintMotionBuild {
  const problems: string[] = [], animationFps = o.animationFps ?? PAINT_ANIMATION_FPS;
  const motion = compilePaintMotion(painting, { nodes: o.nodes, plays: o.plays, animationFps }, problems);
  if (!problems.length && o.foldCheck) problems.push(...paintMotionFolds(motion, o.foldCheck));
  return problems.length ? { ok: false, problems } : { ok: true, motion };
}

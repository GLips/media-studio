// constructed-figure.ts: a figure blocked in flat, as an illustrator constructs one: named parts of ellipses and
// capsules (tapered, chained from joints by angle), their silhouette a smooth union so a head grows out of a body
// rather than sitting on it like a snowman. Later parts lie in front; a fillet pixel belongs to the nearest part.
//
// Negative space: one view only. A pose is a new declaration (a joint angle changed, a part scaled), which is cheap;
// for a turn of the figure, use posed 3D primitives.

import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintFigureSampling, paintFigureShapesFromFields, type PaintFigureShapes } from './paint-figure-shapes.ts';
import { PAINT_FIGURE_TRACE_DEFAULTS, type PaintFigureTraceSettings } from './paint-figure-trace.ts';

/** A construction shape, px. An ellipse turns `turn` degrees clockwise; a capsule tapers from `radius` to `toRadius`. */
export type PaintFigureConstruction =
  | { readonly kind: 'ellipse'; readonly x: number; readonly y: number; readonly radiusX: number; readonly radiusY: number; readonly turn?: number }
  | { readonly kind: 'capsule'; readonly from: StampPoint; readonly to: StampPoint; readonly radius: number; readonly toRadius?: number };

/** A part: the union of its shapes, melted into the parts before it over `blend` px (0, a hard join, by default). */
export type ConstructedFigurePart = { readonly shapes: readonly PaintFigureConstruction[]; readonly blend?: number };

/** Parts back to front, anchors in px; `cell` is the sampling grid, px (2 by default). */
export type ConstructedFigure<P extends string, A extends string> = {
  readonly parts: Readonly<Record<P, ConstructedFigurePart>>;
  readonly anchors: Readonly<Record<A, StampPoint>>;
  readonly cell?: number;
  readonly trace?: PaintFigureTraceSettings;
};

/** A limb as a chain of tapered capsules from `root`: each segment turns `turn` degrees from the last (0 is +x, 90 down). */
export function figureConstructionChain(root: StampPoint, segments: readonly { length: number; turn: number; radius: number; toRadius?: number }[]): { capsules: PaintFigureConstruction[]; joints: StampPoint[] } {
  const joints: StampPoint[] = [root], capsules: PaintFigureConstruction[] = [];
  let heading = 0;
  for (const { length, turn, radius, toRadius } of segments) {
    heading += (turn * Math.PI) / 180;
    const from = joints[joints.length - 1], to = { x: from.x + Math.cos(heading) * length, y: from.y + Math.sin(heading) * length };
    capsules.push({ kind: 'capsule', from, to, radius, ...(toRadius !== undefined && { toRadius }) });
    joints.push(to);
  }
  return { capsules, joints };
}

/** Signed distance, negative inside. The ellipse's is scaled from its unit circle's: exact on its edge, monotone off it. */
function constructionDistance(shape: PaintFigureConstruction, x: number, y: number): number {
  if (shape.kind === 'ellipse') {
    const turn = ((shape.turn ?? 0) * Math.PI) / 180, c = Math.cos(turn), s = Math.sin(turn);
    const dx = x - shape.x, dy = y - shape.y, u = dx * c + dy * s, v = -dx * s + dy * c;
    return (Math.hypot(u / shape.radiusX, v / shape.radiusY) - 1) * Math.min(shape.radiusX, shape.radiusY);
  }
  // Inigo Quilez's uneven capsule, in the frame where `from` is the origin and `to` lies along +y.
  const { from, to, radius } = shape, toRadius = shape.toRadius ?? radius;
  const h = Math.hypot(to.x - from.x, to.y - from.y) || 1e-9, ax = (to.x - from.x) / h, ay = (to.y - from.y) / h;
  const px = Math.abs((x - from.x) * ay - (y - from.y) * ax), py = (x - from.x) * ax + (y - from.y) * ay;
  const b = Math.max(-0.999, Math.min(0.999, (radius - toRadius) / h)), a = Math.sqrt(1 - b * b), k = -b * px + a * py;
  if (k < 0) return Math.hypot(px, py) - radius;
  if (k > a * h) return Math.hypot(px, py - h) - toRadius;
  return a * px + b * py - radius;
}

function constructionBox(shape: PaintFigureConstruction): [number, number, number, number] {
  if (shape.kind === 'ellipse') {
    const r = Math.max(shape.radiusX, shape.radiusY);
    return [shape.x - r, shape.y - r, shape.x + r, shape.y + r];
  }
  const r = Math.max(shape.radius, shape.toRadius ?? shape.radius);
  return [Math.min(shape.from.x, shape.to.x) - r, Math.min(shape.from.y, shape.to.y) - r, Math.max(shape.from.x, shape.to.x) + r, Math.max(shape.from.y, shape.to.y) + r];
}

/** Polynomial smooth minimum: within `k` of each other two distances melt into a fillet; `k` 0 is a plain min. */
const smoothMin = (a: number, b: number, k: number) => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};

/** The constructed figure's shapes, px: parts as they show, the melted silhouette, the lines between parts, anchors. */
export function constructedFigureShapes<P extends string, A extends string>(figure: ConstructedFigure<P, A>): PaintFigureShapes<P, A> {
  // SAFETY: the keys of a Record<P, …> are P.
  const names = Object.keys(figure.parts) as P[];
  const cell = figure.cell ?? 2;
  const parts = names.map((name) => figure.parts[name]);
  const boxes = parts.flatMap((part) => part.shapes.map((shape) => { const [x0, y0, x1, y1] = constructionBox(shape), grow = part.blend ?? 0; return [x0 - grow, y0 - grow, x1 + grow, y1 + grow]; }));
  const sampling = paintFigureSampling({ x0: Math.min(...boxes.map((b) => b[0])), y0: Math.min(...boxes.map((b) => b[1])), x1: Math.max(...boxes.map((b) => b[2])), y1: Math.max(...boxes.map((b) => b[3])) }, cell);
  const count = sampling.columns * sampling.rows;
  const union = new Float32Array(count), visible = parts.map(() => new Float32Array(count));
  // Later parts are nearer: a constant depth per part, a cell apart and more, ranks them for the lines.
  const depth = parts.map((_, k) => new Float32Array(count).fill((parts.length - k) * 100 * cell));
  const inside = new Float64Array(parts.length);
  for (let j = 0; j < sampling.rows; j++) {
    for (let i = 0; i < sampling.columns; i++) {
      const x = sampling.x0 + i * cell, y = sampling.y0 + j * cell, at = j * sampling.columns + i;
      let melted = Infinity;
      for (let k = 0; k < parts.length; k++) {
        let distance = Infinity;
        for (const shape of parts[k].shapes) distance = Math.min(distance, constructionDistance(shape, x, y));
        inside[k] = -distance;
        melted = k === 0 ? distance : smoothMin(melted, distance, parts[k].blend ?? 0);
      }
      union[at] = -melted;
      for (let k = 0; k < parts.length; k++) {
        // Shown where the union is, no later part covers it, and it is inside itself or the nearest part to a fillet.
        let fillet = Infinity;
        for (let other = 0; other < parts.length; other++) if (other !== k) fillet = Math.min(fillet, inside[k] - inside[other]);
        let field = Math.min(-melted, Math.max(inside[k], fillet));
        for (let other = k + 1; other < parts.length; other++) field = Math.min(field, -inside[other]);
        visible[k][at] = field;
      }
    }
  }
  return paintFigureShapesFromFields(
    { sampling, union, parts: names.map((name, k) => ({ name, visible: visible[k], depth: depth[k] })) },
    figure.anchors,
    figure.trace ?? PAINT_FIGURE_TRACE_DEFAULTS,
  );
}

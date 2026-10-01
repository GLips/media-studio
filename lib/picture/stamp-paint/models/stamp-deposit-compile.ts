// stamp-deposit-compile.ts: a deposit as written (stamp-paint-recipe.ts) checked and its stamps placed, seeded by
// its ID so adding a stroke changes no other.

import { seededRandom } from '#lib/picture/motion/models/random.ts';
import type { StampBrushLayer, StampBrushMedia } from './stamp-brush.ts';
import { placeAuthoredStamps, placeStrokeStamps, stampExpectedTint, type StampPlacementBrush, type StampStrokePoint } from './stamp-placement.ts';
import { handStampStroke } from './stamp-stroke-hand.ts';
import { STAMP_ACCUMULATIONS } from './stamp-deposit-stages.ts';
import { placeStampFlood, stampFillStrokePath, stampFloodBodyLevels, stampFloodFront, stampFloodProbe, type StampFillApplication } from './stamp-fill.ts';
import { stampPaintFieldAt, stampPaintFieldProblem } from './stamp-paint-field.ts';
import type { CompiledStampAction } from './stamp-paint-action.ts';
import { stampRegionPolygon, type StampPoint, type StampRegion } from './stamp-region.ts';
import type { CompiledStampDeposit, CompiledStampMask, StampPaintRecipeDeposit } from './stamp-paint-recipe.ts';

/**
 * `region` traced, `what` naming it: refused unless it's at least 3 finite points enclosing some area, as the
 * distance a fill, mask or `within` reads is only defined for one.
 */
export function checkedStampPolygon(region: StampRegion, what: string): readonly StampPoint[] {
  const polygon = stampRegionPolygon(region);
  let twiceArea = 0;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    twiceArea += a.x * b.y - b.x * a.y;
  });
  if (polygon.length < 3 || !polygon.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)) || !twiceArea) {
    throw new Error(`stamp paint: ${what}'s region isn't a shape: it needs at least 3 finite points enclosing some area`);
  }
  return polygon;
}

/** How a fill of wet or dry media is laid unless it says: wet paint floods a shape; a crayon shades it in short strokes. */
const STAMP_MEDIA_FILLS: Record<StampBrushMedia, StampFillApplication> = { wet: { kind: 'flood' }, dry: { kind: 'strokes', pattern: 'shading' } };

/** A deposit's eight draws from `seed`: its grains' offsets, then its colour jitter. */
function stampDepositDraws(seed: string) {
  const random = seededRandom(`${seed}|deposit|paint`);
  return Array.from({ length: 8 }, () => random());
}

/**
 * A deposit checked and its stamps placed, `full` its ID, its action by `compiledAction` from its colour jitter, under the
 * fluid `mask`, its randomness drawn from `seed`.
 */
export function compileDeposit<A extends CompiledStampAction>(
  full: string, { geometry, tool, action }: StampPaintRecipeDeposit, compiledAction: (colorDraws: readonly number[]) => A, mask: CompiledStampMask | null, seed: string,
): CompiledStampDeposit<A> {
  const { brush, opacity = 1, appliedAt, drawnOver, diameter } = tool;
  if (!(diameter > 0) || !Number.isFinite(diameter)) throw new Error(`stamp paint: ${full} has diameter ${diameter}, and a stamp needs a positive one`);
  if (drawnOver !== undefined && drawnOver < 0) throw new Error(`stamp paint: ${full} draws over ${drawnOver}s, and a draw takes no less than 0`);
  if (geometry.kind !== 'fill' && !(geometry.kind === 'stroke' ? geometry.path : geometry.at).length) throw new Error(`stamp paint: ${full} has no points to stamp`);
  if (geometry.kind === 'fill') checkedStampPolygon(geometry.region, full);
  if (geometry.kind === 'stroke' && geometry.path.some(({ speed }) => speed !== undefined && !(speed > 0))) throw new Error(`stamp paint: ${full} has a point whose speed isn't positive`);
  // Four draws place the grains, four jitter the colour. A boil's epoch draws only its grains afresh: colour is the
  // author's palette, which an epoch mustn't flicker.
  const own = stampDepositDraws(seed), jitter = (seed === full ? own : stampDepositDraws(full)).slice(4);
  const offset = (layer: StampBrushLayer | undefined, at: number): [number, number] => {
    const reach = layer?.grain?.offsetJitter ?? 0;
    return [own[at] * reach, own[at + 1] * reach];
  };
  const grainOffset = { main: offset(brush, 0), dual: offset(brush.dual, 2) };
  const blend = (action.kind === 'paint' && action.blend) || brush.blend;
  const common = {
    id: full, brush, action: compiledAction(jitter), grainOffset, diameter, blend, opacity, mask,
    ...(appliedAt !== undefined && { reveal: { at: appliedAt, over: drawnOver ?? 0 } }),
  };
  if (geometry.kind === 'fill') {
    const direction = geometry.direction ?? 0;
    const load = geometry.load ?? { kind: 'constant' as const, value: 1 };
    const problem = stampPaintFieldProblem(load, (value) => (value >= 0 && value <= 1 ? null : `a load of ${value}, outside 0..1`));
    if (problem) throw new Error(`stamp paint: ${full}'s load can't be painted: ${problem}`);
    const application = geometry.application ?? (brush.media && STAMP_MEDIA_FILLS[brush.media]);
    if (!application) throw new Error(`stamp paint: ${full} fills with ${JSON.stringify(brush.name)}, whose media no style declares, so it states its application`);
    if (application.kind === 'flood') {
      const { body, stamps, dualStamps } = placeStampFlood(geometry.region, brush, diameter, direction, seed);
      const levels = stampFloodBodyLevels(STAMP_ACCUMULATIONS[brush.accumulation.kind].towardFull, stampFloodProbe(brush, diameter, `${seed}|probe`));
      const flood = { ...body, load, levels, tint: stampExpectedTint(brush.color), front: stampFloodFront(body.polygon, [...stamps, ...dualStamps], direction, diameter) };
      return { ...common, kind: 'flood', flood, stamps, dualStamps };
    }
    const strokes = stampFillStrokePath(geometry.region, diameter, direction, application, seed);
    const place = (stamping: StampPlacementBrush, scale: number, placing: string) => (strokes.length ? placeStrokeStamps(strokes, stamping, diameter * scale, placing) : []);
    const stamps = place(brush, 1, seed);
    for (const stamp of stamps) stamp.opacity *= stampPaintFieldAt(load, stamp.x, stamp.y);
    return { ...common, kind: 'stroke', stamps, dualStamps: brush.dual ? place(brush.dual, brush.dual.scale, `${seed}|dual`) : [] };
  }
  // The hand's path is worked out once, so the main stamps and the dual's follow the same wobble.
  let path: readonly StampStrokePoint[] = [];
  if (geometry.kind === 'stroke') path = geometry.hand ? handStampStroke(geometry.path, geometry.hand, diameter, `${seed}|hand`) : geometry.path;
  const place = (stamping: StampPlacementBrush, scale: number, placing: string) => geometry.kind === 'stroke'
    ? placeStrokeStamps(path, stamping, diameter * scale, placing)
    : placeAuthoredStamps(geometry.at.map((at) => (at.diameter === undefined ? at : { ...at, diameter: at.diameter * scale })), stamping, diameter * scale, placing);
  return { ...common, kind: geometry.kind, stamps: place(brush, 1, seed), dualStamps: brush.dual ? place(brush.dual, brush.dual.scale, `${seed}|dual`) : [] };
}

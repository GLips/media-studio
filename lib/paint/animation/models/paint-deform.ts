// paint-deform.ts: a bend of a group's rest space as data. Each step a node's paint goes through in a frame (pins'
// moves, a flutter, a sway, a boil wobble, a rigid placement) is an immutable value naming every spatial parameter and
// its evaluated amount, rounded to the steps it's keyed in. Map, key and fold check are all read from it, and the key
// is its canonical text, so equal keys are equal maps by construction.
//
// Pins' displacements add, each its weight times its own move. Why not a normalised blend: a part-owned pin must scale
// its part exactly, and a blend scales the sac by less wherever a breathing chest pin also reaches.

import { stampGroupSceneFromLayer, type StampGroupPlacement } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { StampWarpMap } from '#lib/paint/painting/models/stamp-group-warp.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintBoilDisplacementMap, type PaintBoilWobble } from './paint-boil-displacement.ts';
import { paintKeyNumbers, type CompiledPaintPin, type PaintPlacementMove } from './paint-pins.ts';

/** Steps evaluated amounts are rounded to: 1/1000 px, and a millionth of a radian, of scale and of a flutter's spread. */
const PX_STEP = 1e-3, RATIO_STEP = 1e-6;
const rounded = (value: number, step: number) => Math.round(value / step) * step;

/** `px` rounded to the step a key holds pixels in. */
export const paintPxRounded = (px: number) => rounded(px, PX_STEP);
/** A ratio, an angle or a depth rounded to the step a key holds them in. */
export const paintRatioRounded = (value: number) => rounded(value, RATIO_STEP);
/** A sigma, px, that must stay above 0, rounded: never below one step, which the renderer would refuse as 0. */
export const paintSigmaRounded = (px: number) => Math.max(PX_STEP, paintPxRounded(px));

/** One pin moved: its name (for blame), the pin and its move, rounded (paintPlacementRounded). */
export type PaintPinMoved = { readonly name: string; readonly pin: CompiledPaintPin; readonly move: StampGroupPlacement };

/**
 * One step of a bend, `owner` naming the node it's from (for blame; never in the key). `spreadSteps` and `angleSteps`
 * are whole RATIO_STEPs of a flutter's spread and a sway's tip angle (radians).
 */
export type PaintDeform = { readonly owner: string } & (
  | { readonly kind: 'pins'; readonly moves: readonly PaintPinMoved[] }
  | { readonly kind: 'flutter'; readonly origin: StampPoint; readonly direction: number; readonly spreadSteps: number }
  | { readonly kind: 'sway'; readonly root: StampPoint; readonly direction: number; readonly length: number; readonly angleSteps: number }
  | { readonly kind: 'wobble'; readonly seed: string; readonly epoch: number; readonly wobble: PaintBoilWobble }
  | { readonly kind: 'place'; readonly placement: StampGroupPlacement; readonly pivot: StampPoint }
);

/** `move` whole and rounded to the steps its key is written in: the placement its map is built from. */
export function paintPlacementRounded(move: PaintPlacementMove): StampGroupPlacement {
  return { x: rounded(move.x ?? 0, PX_STEP), y: rounded(move.y ?? 0, PX_STEP), rotation: rounded(move.rotation ?? 0, RATIO_STEP), scale: rounded(move.scale ?? 1, RATIO_STEP) };
}

export const paintPlacementIsRest = ({ x, y, rotation, scale }: StampGroupPlacement) => x === 0 && y === 0 && rotation === 0 && scale === 1;

/** Whole RATIO_STEPs of `value`: how a sway's angle and a flutter's spread are held. */
export const paintRatioSteps = (value: number) => Math.round(value / RATIO_STEP);

const placementText = ({ x, y, rotation, scale }: StampGroupPlacement) => paintKeyNumbers(x, y, rotation, scale);

/** `deform`'s canonical text: every number its map is built from, so equal text is an equal map. */
export function paintDeformKey(deform: PaintDeform): string {
  switch (deform.kind) {
    case 'pins': return `pins[${deform.moves.map(({ pin, move }) => `${pin.text}=${placementText(move)}`).join(';')}]`;
    case 'flutter': return `flutter(${paintKeyNumbers(deform.origin.x, deform.origin.y, deform.direction, deform.spreadSteps)})`;
    case 'sway': return `sway(${paintKeyNumbers(deform.root.x, deform.root.y, deform.direction, deform.length, deform.angleSteps)})`;
    case 'wobble': return `wobble(${JSON.stringify(deform.seed)},${paintKeyNumbers(deform.epoch, deform.wobble.amount, deform.wobble.scale)})`;
    case 'place': return `place(${placementText(deform.placement)}@${paintKeyNumbers(deform.pivot.x, deform.pivot.y)})`;
    default: return deform satisfies never;
  }
}

/** The map moving each rest point by every moved pin, by its weight there. */
function pinsMap(moves: readonly PaintPinMoved[]): StampWarpMap {
  return (rest) => {
    let x = rest.x, y = rest.y;
    for (const { pin, move } of moves) {
      const w = pin.weight(rest);
      if (w <= 0) continue;
      const moved = stampGroupSceneFromLayer(move, rest, pin.pivot);
      x += (moved.x - rest.x) * w;
      y += (moved.y - rest.y) * w;
    }
    return { x, y };
  };
}

/** The squeeze a flutter makes: each point's distance across the axis through `origin` along `direction` times its spread. */
function flutterMap(origin: StampPoint, direction: number, spread: number): StampWarpMap {
  const ax = Math.cos(direction), ay = Math.sin(direction);
  return (rest) => {
    const dx = rest.x - origin.x, dy = rest.y - origin.y, along = dx * ax + dy * ay, across = (dy * ax - dx * ay) * spread;
    return { x: origin.x + along * ax - across * ay, y: origin.y + along * ay + across * ax };
  };
}

/**
 * The bend a sway makes when its tip has turned `angle`: each rest point turns about `root` by `angle` times how far
 * it lies along the axis, 0 at the root and all of it from the tip on, so a blade curls rather than shears and keeps
 * its length. Paint behind the root stays put.
 */
function swayMap(root: StampPoint, direction: number, length: number, angle: number): StampWarpMap {
  const ax = Math.cos(direction), ay = Math.sin(direction);
  return (rest) => {
    const dx = rest.x - root.x, dy = rest.y - root.y, along = Math.min(1, Math.max(0, (dx * ax + dy * ay) / length));
    if (along === 0) return rest;
    const turn = angle * along, cos = Math.cos(turn), sin = Math.sin(turn);
    return { x: root.x + cos * dx - sin * dy, y: root.y + sin * dx + cos * dy };
  };
}

/** `deform`'s map, built from its value alone. */
export function paintDeformMap(deform: PaintDeform): StampWarpMap {
  switch (deform.kind) {
    case 'pins': return pinsMap(deform.moves);
    case 'flutter': return flutterMap(deform.origin, deform.direction, deform.spreadSteps * RATIO_STEP);
    case 'sway': return swayMap(deform.root, deform.direction, deform.length, deform.angleSteps * RATIO_STEP);
    case 'wobble': return paintBoilDisplacementMap(deform.seed, deform.epoch, deform.wobble);
    case 'place': return (rest) => stampGroupSceneFromLayer(deform.placement, rest, deform.pivot);
    default: return deform satisfies never;
  }
}

/** How far each part of `deform` moves the paint at `rest`, px, each named, for naming what folds a warp. */
export function paintDeformShifts(deform: PaintDeform, rest: StampPoint): { name: string; shift: number }[] {
  const shift = (to: StampPoint) => Math.hypot(to.x - rest.x, to.y - rest.y);
  if (deform.kind === 'pins') return deform.moves.map(({ name, pin, move }) => ({ name: `${deform.owner}'s pin '${name}'`, shift: shift(stampGroupSceneFromLayer(move, rest, pin.pivot)) * pin.weight(rest) }));
  return [{ name: `${deform.owner}'s ${deform.kind}`, shift: shift(paintDeformMap(deform)(rest)) }];
}

/** A chain of steps, rest space first: one map and one key. */
export type PaintWarpChain = readonly PaintDeform[];

export function paintWarpChainMap(chain: PaintWarpChain): StampWarpMap {
  const maps = chain.map(paintDeformMap);
  return (rest) => maps.reduce((point, map) => map(point), rest);
}

export const paintWarpChainKey = (chain: PaintWarpChain) => chain.map(paintDeformKey).join('>');

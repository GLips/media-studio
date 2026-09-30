// stamp-dynamics.ts: how a brush's dynamics (StampDynamics, stamp-brush.ts) are read as a stroke is placed: what the
// placement knows at each step and each stamp (StampContext), what each sensor reads from it, and what each response
// makes of that. Placement (stamp-placement.ts) asks for a target's share or turn and never learns where a dynamic
// came from: an importer resolves every source of one (a Photoshop tool's pressure buttons, a pose) into the brush.
//
// A sensor is read either at the step, alike for every stamp of a spacing step (pressure, direction), or at the stamp
// (random, from the stamp's own draws). Size's step share sets the next step's spacing before a stamp's own chance
// shrinks it, so the two are asked for apart.

import type {
  StampAngleResponse, StampDynamics, StampResponseCurve, StampScaleResponse, StampScaleTarget,
} from './stamp-brush.ts';

/**
 * The draws each stamp makes from its own stream, in this order, every one always, so adding a use for one never
 * shifts another and every painting keeps its randomness; a new random target appends its slot. A stroke's stamps draw
 * the first three, where they land off the path; an authored stamp's place is the author's, so its stream starts at
 * `size`.
 */
export const STAMP_DRAW_SLOTS = [
  'lateral', 'scatterTurn', 'scatterReach', 'size', 'opacity', 'rotation', 'flipX', 'flipY', 'blur', 'flow', 'hue', 'saturation', 'lightness', 'darkness', 'roundness',
] as const;
export type StampDrawSlot = (typeof STAMP_DRAW_SLOTS)[number];
export type StampDraws = Record<StampDrawSlot, number>;
const STROKE_ONLY_DRAWS: ReadonlySet<StampDrawSlot> = new Set(['lateral', 'scatterTurn', 'scatterReach']);

/** A stamp's draws, each 0..1; an authored stamp's stroke-only slots read 0, undrawn. */
export function drawStampSlots(random: () => number, placing: 'stroke' | 'authored'): StampDraws {
  // fromEntries can't carry the slots' keys into its type; every slot is written, in order.
  return Object.fromEntries(STAMP_DRAW_SLOTS.map((slot) => [slot, placing === 'authored' && STROKE_ONLY_DRAWS.has(slot) ? 0 : random()])) as StampDraws;
}

/**
 * What the stroke is doing at one spacing step, the same for each of its stamps. Its counters are distinct inputs, and
 * a sensor names the one it reads: `step` counts spacing steps along the deposit (four scattered stamps at a step are
 * one step; Photoshop's fade, vid-105, would count these), `distance` is the path's length travelled to the step in
 * pixels, lifted gaps included (a falloff's input), and a stamp's `stamp` (StampContext) is its place among its step's
 * scattered stamps. An authored stamp is a step of its own, `step` its index, at no distance and no heading.
 */
export type StampStepContext = {
  /** The stroke's pressure here, 0..1: 1 where the path gives none. */
  pressure: number;
  /**
   * How much of pressure's shortfall shows, 0..1: 1 outside a taper, and within one as far as its `pressure` lets
   * the stroke's own through, the taper standing in for the rest. The pressure sensor reads it for every target.
   */
  pressureThrough: number;
  /** The direction of travel here, radians, unwrapped along the stroke so a partial follow never jumps at ±π. */
  heading: number;
  /** The deposit's first heading, which Photoshop's initial direction (vid-105) holds for the whole stroke. */
  initialHeading: number;
  step: number;
  distance: number;
  /** The step's own draw for its count, from the step's stream: 0, undrawn, when nothing reads it. */
  countDraw: number;
};

/** One stamp's context: its step's, its place among the step's scattered stamps, and its own draws. */
export type StampContext = StampStepContext & { stamp: number; draws: StampDraws };

/** `curve` at `input`: piecewise-linear between its points, flat past its ends. */
export function stampResponseCurve(curve: StampResponseCurve, input: number): number {
  const first = curve[0], last = curve[curve.length - 1];
  if (input <= first[0]) return first[1];
  if (input >= last[0]) return last[1];
  const next = curve.findIndex(([x]) => x > input), [x0, y0] = curve[next - 1], [x1, y1] = curve[next];
  return y0 + ((y1 - y0) * (input - x0)) / (x1 - x0);
}

/** The share a scale response keeps at signal `s` (0..1, how far its sensor takes the target from full). */
const scaleShare = (response: StampScaleResponse, s: number) => (response.kind === 'linear' ? 1 - response.amount * s : stampResponseCurve(response.points, s));
/** The turn an angle response gives at `signal`, radians. */
const angleTurn = (response: StampAngleResponse, signal: number) => (response.kind === 'linear' ? response.amount * signal : stampResponseCurve(response.points, signal));

/** Pressure's signal for a scale target: its shortfall from full, as far as a taper lets it through. */
const pressureLoss = (step: StampStepContext) => step.pressureThrough * (1 - step.pressure);

/** The share of `target` its step-read bindings keep (pressure), composed by product. */
export function stampStepShare(dynamics: StampDynamics, target: StampScaleTarget, step: StampStepContext): number {
  const pressure = dynamics[target]?.pressure;
  return pressure ? scaleShare(pressure, pressureLoss(step)) : 1;
}

/** The share of a stamp's `target` its stamp-read bindings keep (random: the stamp's own draw for the target). */
export function stampOwnShare(dynamics: StampDynamics, target: Exclude<StampScaleTarget, 'count'>, stamp: StampContext): number {
  const random = dynamics[target]?.random;
  return random ? scaleShare(random, stamp.draws[target]) : 1;
}

/** The turn a step's bindings give each of its stamps (direction: the heading), radians. */
export function stampStepTurn(dynamics: StampDynamics, step: StampStepContext): number {
  const direction = dynamics.rotation?.direction;
  return direction ? angleTurn(direction, step.heading) : 0;
}

/** The turn a stamp's own bindings give it (random: its draw, centred to −1..1), radians. */
export function stampOwnTurn(dynamics: StampDynamics, stamp: StampContext): number {
  const random = dynamics.rotation?.random;
  return random ? angleTurn(random, stamp.draws.rotation * 2 - 1) : 0;
}

/**
 * How many of a step's `count` stamps it keeps, never under 1. Each count binding keeps whole stamps of what the one
 * before kept: pressure by flooring (vid-97's count probes: 4 at pressure 0.98 keeps 3), then random by rounding, on
 * the step's own count draw. Kept stamps are the step's first, so neither moves the stamps it keeps.
 */
export function stampStepCount(dynamics: StampDynamics, count: number, step: StampStepContext): number {
  const { pressure, random } = dynamics.count ?? {};
  const pressed = pressure ? Math.max(1, Math.floor(count * scaleShare(pressure, pressureLoss(step)) + 1e-9)) : count;
  return random ? Math.max(1, Math.round(pressed * scaleShare(random, step.countDraw))) : pressed;
}

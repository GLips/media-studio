// stamp-dynamics.ts: how a brush's dynamics (StampDynamics, stamp-brush.ts) are read as a stroke is placed: what the
// placement knows at each step and each stamp (StampContext), what each sensor reads from it, and what each response
// makes of that. Placement (stamp-placement.ts) asks for a target's share or turn and never learns where a dynamic
// came from: an importer resolves every source (a Photoshop tool's pressure buttons, a pose) into the brush.
//
// A sensor is read at the step, alike for its every stamp (pressure, fade, direction), or at the stamp (random, from
// its own draws). Size's step share sets the next step's spacing before a stamp's chance shrinks it, so the two are
// asked for apart.

import type {
  StampAngleResponse, StampDynamics, StampResponseCurve, StampScaleResponse, StampScaleTarget, StampSensorParams, StampTargetSensors,
} from './stamp-brush.ts';

/**
 * The draws each stamp makes from its own stream, in this order, every one always, so adding a use for one never
 * shifts another and every painting keeps its randomness; a new random target appends its slot. The first three,
 * where a stroke's stamp lands off the path, an authored stamp doesn't draw.
 */
export const STAMP_DRAW_SLOTS = [
  'lateral', 'scatterTurn', 'scatterReach', 'size', 'opacity', 'rotation', 'flipX', 'flipY', 'blur', 'flow', 'hue', 'saturation', 'lightness', 'darkness', 'roundness',
  'grainDepth',
] as const;
export type StampDrawSlot = (typeof STAMP_DRAW_SLOTS)[number];
export type StampDraws = Record<StampDrawSlot, number>;

/**
 * A stamp's draws, each 0..1, written into `into`; an authored stamp's stroke-only slots read 0, undrawn. Written out
 * slot by slot in STAMP_DRAW_SLOTS' order (stamp-dynamics.test.ts holds the two together): a painting draws this for
 * every stamp, so it fills one record rather than making one.
 */
export function drawStampSlots(random: () => number, placing: 'stroke' | 'authored', into: StampDraws): StampDraws {
  const stroke = placing === 'stroke';
  into.lateral = stroke ? random() : 0;
  into.scatterTurn = stroke ? random() : 0;
  into.scatterReach = stroke ? random() : 0;
  into.size = random();
  into.opacity = random();
  into.rotation = random();
  into.flipX = random();
  into.flipY = random();
  into.blur = random();
  into.flow = random();
  into.hue = random();
  into.saturation = random();
  into.lightness = random();
  into.darkness = random();
  into.roundness = random();
  into.grainDepth = random();
  return into;
}

/** A record of draws to fill (drawStampSlots), all 0. */
export const stampDrawsRecord = (): StampDraws => ({
  lateral: 0, scatterTurn: 0, scatterReach: 0, size: 0, opacity: 0, rotation: 0, flipX: 0, flipY: 0, blur: 0, flow: 0, hue: 0, saturation: 0,
  lightness: 0, darkness: 0, roundness: 0, grainDepth: 0,
});

/**
 * The stroke at one spacing step, alike for its stamps. A sensor names the counter it reads: `step` counts steps
 * (scattered stamps share one; fade counts these), `distance` the pixels travelled, lifted gaps
 * included (a falloff's input). An authored stamp is its own step, at no distance or heading.
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
  /** The deposit's first heading, which the initial direction sensor holds for the whole stroke. */
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

// Each sensor's signal reads its binding's own parameters (StampSensorParams) beside the context.

/** Pressure's signal for a scale target: its shortfall from full, as far as a taper lets it through. */
const pressureLoss = (_params: StampSensorParams['pressure'], step: StampStepContext) => step.pressureThrough * (1 - step.pressure);
/**
 * Fade's signal for a scale target: how far the stroke is through its `steps`, 0 at the first step. Photoshop's fade
 * control, whose captures step it by the spacing step, scattered stamps alike.
 */
const fadeLoss = (params: StampSensorParams['fade'], step: StampStepContext) => (params.steps > 0 ? Math.min(1, step.step / params.steps) : 1);
/** Random's signal: the draw it's given, the target's own; centred to −1..1 for an angle. */
const randomDraw = (_params: StampSensorParams['random'], draw: number) => draw;

/** The targets a stamp's own draw can drive. */
type StampRandomTarget = { [T in StampScaleTarget]: 'random' extends StampTargetSensors[T] ? T : never }[StampScaleTarget];

/** The share of `target` its step-read bindings keep (pressure, then fade), composed by product. */
export function stampStepShare(dynamics: StampDynamics, target: StampScaleTarget, step: StampStepContext): number {
  return stampPressureShare(dynamics, target, step) * stampFadeShare(dynamics, target, step);
}

/** The share of `target` its pressure binding alone keeps. */
export function stampPressureShare(dynamics: StampDynamics, target: StampScaleTarget, step: StampStepContext): number {
  const pressure = dynamics[target]?.pressure;
  return pressure ? scaleShare(pressure, pressureLoss(pressure, step)) : 1;
}

/** The share of `target` its fade binding alone keeps. */
export function stampFadeShare(dynamics: StampDynamics, target: StampScaleTarget, step: StampStepContext): number {
  const fade = dynamics[target]?.fade;
  return fade ? scaleShare(fade, fadeLoss(fade, step)) : 1;
}

/** The share of a stamp's `target` its stamp-read bindings keep (random: the stamp's own draw for the target). */
export function stampOwnShare(dynamics: StampDynamics, target: Exclude<StampRandomTarget, 'count' | 'size'>, stamp: StampContext): number {
  const random = dynamics[target]?.random;
  return random ? scaleShare(random, randomDraw(random, stamp.draws[target])) : 1;
}

/**
 * A stamp's diameter from its step's `size`: its own draw takes it down, or with `around` spreads it either way, what
 * passes `full` (the deposit's diameter) folding back under it.
 */
export function stampOwnSize(dynamics: StampDynamics, size: number, full: number, stamp: StampContext): number {
  const random = dynamics.size?.random;
  if (!random) return size;
  const draw = randomDraw(random, stamp.draws.size);
  if (!random.around) return size * scaleShare(random, draw);
  const spread = size * scaleShare(random, 1 - 2 * draw);
  return spread > full ? Math.max(0, 2 * full - spread) : spread;
}

/**
 * The turn a step's bindings give each of its stamps, radians: direction by the heading, initial direction by the
 * first, and pressure and fade by how far each holds from none (pressure's full, fade's first step), 0..1.
 */
export function stampStepTurn(dynamics: StampDynamics, step: StampStepContext): number {
  const { direction, initialDirection, pressure, fade } = dynamics.rotation ?? {};
  return (direction ? angleTurn(direction, step.heading) : 0)
    + (initialDirection ? angleTurn(initialDirection, step.initialHeading) : 0)
    + (pressure ? angleTurn(pressure, 1 - pressureLoss(pressure, step)) : 0)
    + (fade ? angleTurn(fade, 1 - fadeLoss(fade, step)) : 0);
}

/** The turn a stamp's own bindings give it (random: its draw, centred to −1..1), radians. */
export function stampOwnTurn(dynamics: StampDynamics, stamp: StampContext): number {
  const random = dynamics.rotation?.random;
  return random ? angleTurn(random, randomDraw(random, stamp.draws.rotation) * 2 - 1) : 0;
}

/**
 * How many stamps a step lays. A count any binding drives lays one at the first step (the `count …` and `random
 * count …` probes). Step-read bindings keep 1 + floor((count − 1) × their share); random then keeps its share by
 * rounding, never under 1, or with `around` 0 to twice as many. Stamps are the step's first, so none moves another's.
 */
export function stampStepCount(dynamics: StampDynamics, count: number, step: StampStepContext): number {
  const { pressure, fade, random } = dynamics.count ?? {};
  if (step.step === 0 && (pressure || fade || random)) return 1;
  const share = pressure || fade ? stampStepShare(dynamics, 'count', step) : 1;
  const pressed = pressure || fade ? 1 + Math.floor((count - 1) * share + 1e-9) : count;
  if (!random) return pressed;
  const draw = randomDraw(random, step.countDraw);
  if (!random.around) return Math.max(1, Math.round(pressed * scaleShare(random, draw)));
  // Beside a control, a jitter over 50% also empties (2j − 1)(1 − share)³ of the steps, the draw's low end (`random
  // count … by pressure`: at 100% none at full pressure, 0.15 at half, 0.45 at a quarter; at 50% none at all).
  const empty = Math.max(0, 1 - 2 * scaleShare(random, 1)) * (1 - share) ** 3;
  if (draw < empty) return 0;
  return Math.round(pressed * scaleShare(random, 1 - (2 * (draw - empty)) / (1 - empty)));
}

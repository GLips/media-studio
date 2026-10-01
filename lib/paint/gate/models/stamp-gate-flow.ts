// stamp-gate-flow.ts: the flow stage (stamp-wet-flow.ts) run alone over a layer the gate writes: grainy workable
// paint in a wetted wash, a fresh disc of paint, water or a lift beside it, and a stripe the footprint closes to
// paint. Its look is still being tuned, so it's held to properties:
//
// - every pigment channel's sum holds within STAMP_GATE_FLOW_TOLERANCE;
// - no pixel holds less than none;
// - nothing changes on the closed stripe or past it;
// - crayon, which has no water, changes nothing; a medium that flows moves some paint.

import { stampLinearDynamics } from '#lib/paint/brush/models/stamp-brush.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { stampGateBrush, stampGatePolygon } from './stamp-gate-paintings.ts';
import type { StampGateWashCheck } from './stamp-gate-washes.ts';

/** How far a channel's sum may drift, relative to it: the layer's half-float store of the moves. */
export const STAMP_GATE_FLOW_TOLERANCE = 1e-3;

export const STAMP_GATE_FLOW_SIZE = { width: 256, height: 192 };
/** The layer's array layers: coverage, six pigment channels and the open share. */
const STAMP_GATE_FLOW_LAYERS = 2;
/** The open share's channel, the layer's last. */
const OPEN = 4 * STAMP_GATE_FLOW_LAYERS - 1;
/** The columns the footprint closes to paint, and past which nothing may change. */
const STRIPE = { x0: 170, x1: 176 };
const DISC = { x: 110, y: 96, radius: 30 };

export type StampGateFlowMedium = 'watercolour' | 'gouache' | 'crayon';
export type StampGateFlowKind = 'paint' | 'water' | 'lift';
export const STAMP_GATE_FLOW_IDS = (['watercolour', 'gouache', 'crayon'] as const).flatMap((medium) => (['paint', 'water', 'lift'] as const).map((kind) => `flow/${medium}-${kind}`));

/** A flow case's medium and what its fresh deposit lays, from its ID. */
export function stampGateFlowCase(id: string): { medium: StampGateFlowMedium; kind: StampGateFlowKind } {
  const match = /^flow\/(watercolour|gouache|crayon)-(paint|water|lift)$/.exec(id);
  if (!match) throw new Error(`stamp gate: no flow case ${JSON.stringify(id)}; the gate runs ${STAMP_GATE_FLOW_IDS.join(', ')}`);
  // SAFETY: the pattern admits only these words.
  return { medium: match[1] as StampGateFlowMedium, kind: match[2] as StampGateFlowKind };
}

const BRUSH = stampGateBrush('Flow', { flow: 1, spacing: 0.25, dynamics: stampLinearDynamics({}) });
const material = { kind: 'mixture', parts: [{ pigment: W.ultramarine, amount: 1 }], strength: 1 } as const;

/**
 * The painting the stage is loaded for: in one wetted wash, the old paint laid first (so it's still workable), then
 * the fresh deposit, its second, that the stage runs after.
 */
export function stampGateFlowPainting(kind: StampGateFlowKind): CompiledStampPaint {
  const { width, height } = STAMP_GATE_FLOW_SIZE;
  return compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => {
    group.wash('w', { preparation: { region: stampGatePolygon(0, 0, width, 0, width, height, 0, height) } }, (wash) => {
      wash.stamps('old', { brush: BRUSH, material, diameter: 200, at: [{ x: 40, y: 96 }] });
      if (kind === 'paint') wash.stamps('fresh', { brush: BRUSH, material, diameter: 2 * DISC.radius, at: [DISC] });
      else if (kind === 'water') wash.water('fresh', { kind: 'stamps', brush: BRUSH, diameter: 2 * DISC.radius, at: [DISC] });
      else wash.lift('fresh', { kind: 'stamps', brush: BRUSH, diameter: 2 * DISC.radius, at: [DISC] });
    });
  })));
}

const hashed = (x: number, y: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * The layer as the fresh deposit left it, the fresh paint it laid (both by array layer, RGBA per pixel) and the
 * footprint (r: what it laid, g: where paint may land): old paint in a ragged grainy band with a hard edge, the fresh
 * disc beside it, a pigment standing alone past the stripe.
 */
export function stampGateFlowLayer(kind: StampGateFlowKind): { layer: Float32Array[]; fresh: Float32Array[]; footprint: Float32Array } {
  const { width, height } = STAMP_GATE_FLOW_SIZE, size = width * height * 4;
  const layer = [new Float32Array(size), new Float32Array(size)], fresh = [new Float32Array(size), new Float32Array(size)], footprint = new Float32Array(size);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const inDisc = Math.hypot(x - DISC.x, y - DISC.y) < DISC.radius ? 1 : 0;
    const old = x < 90 + 10 * Math.sin(y / 9) ? 0.6 * (0.7 + 0.6 * hashed(x >> 1, y >> 1)) : 0;
    const laid = kind === 'paint' ? inDisc * 0.9 * (0.6 + 0.8 * hashed(x, y)) : 0;
    layer[0].set([Math.min(1, (old > 0 ? 0.8 : 0) + inDisc * 0.9), old + laid, old * 0.5, 0.2 * hashed(x, y)], i);
    layer[1].set([laid * 0.3, x > 180 ? 0.7 : 0, 0, old + laid > 0 || x > 180 ? 1 : 0], i);
    fresh[0].set([inDisc * 0.9 * (old > 0 ? 0.2 : 1), laid, 0, 0], i);
    fresh[1].set([laid * 0.3, 0, 0, 0], i);
    footprint.set([inDisc, x >= STRIPE.x0 && x < STRIPE.x1 ? 0 : 1, 0, 0], i);
  }
  return { layer, fresh, footprint };
}

/** `v` as an IEEE half float's bits, rounded to nearest; the layer is written in half floats. */
export function stampGateHalfBits(v: number): number {
  const bits = new Uint32Array(new Float32Array([v]).buffer)[0];
  const sign = (bits >>> 16) & 0x8000, exponent = ((bits >>> 23) & 0xff) - 112, mantissa = bits & 0x7fffff;
  if (exponent <= 0) return sign;
  if (exponent >= 31) return sign | 0x7c00;
  // Rounding may carry into the exponent, which the bits then hold correctly.
  return sign + ((exponent << 10) | (mantissa >> 13)) + ((mantissa >> 12) & 1);
}

/** An IEEE half float's bits as a number. */
export function stampGateHalfValue(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1, exponent = (bits >> 10) & 0x1f, mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  return exponent === 31 ? sign * Infinity : sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

/**
 * Whether the stage held flow case `id`'s layer, read back `before` and `after` it ran (array layer by array layer,
 * RGBA per pixel), to the properties; in crayon, whether it changed nothing.
 */
export function checkStampGateFlow(id: string, before: ArrayLike<number>, after: ArrayLike<number>): StampGateWashCheck {
  const { width, height } = STAMP_GATE_FLOW_SIZE, pixels = width * height, { medium } = stampGateFlowCase(id);
  const sums = Array.from({ length: STAMP_GATE_FLOW_LAYERS * 4 }, () => ({ before: 0, after: 0 }));
  let least = Infinity, fenced = 0, moved = 0;
  for (let l = 0; l < STAMP_GATE_FLOW_LAYERS; l++) for (let p = 0; p < pixels; p++) for (let c = 0; c < 4; c++) {
    const i = (l * pixels + p) * 4 + c, change = Math.abs(after[i] - before[i]);
    sums[l * 4 + c].before += before[i];
    sums[l * 4 + c].after += after[i];
    least = Math.min(least, after[i]);
    moved += change;
    if (p % width >= STRIPE.x0) fenced = Math.max(fenced, change);
  }
  // Pigment channels only: coverage and the open share follow what moved, by the compositor's rule.
  const pigments = sums.filter((_, channel) => channel !== 0 && channel !== OPEN);
  const drift = Math.max(...pigments.map((s) => (s.before > 0 ? Math.abs(s.after - s.before) / s.before : s.after)));
  const problems = [
    ...(drift > STAMP_GATE_FLOW_TOLERANCE ? [`a channel's sum drifted ${drift.toExponential(2)}`] : []),
    ...(least < 0 ? [`a pixel holds ${least}`] : []),
    ...(fenced > 0 ? [`paint changed by ${fenced} on or past the closed stripe`] : []),
    ...(medium === 'crayon' && moved > 0 ? [`crayon's flow moved ${moved.toFixed(3)} in all`] : []),
    // So a stage that moves nothing can't pass.
    ...(medium !== 'crayon' && moved === 0 ? ['nothing moved'] : []),
  ];
  return {
    id: `${id}: conserved and fenced`, passed: !problems.length,
    detail: `${problems.length ? `${problems.join('; ')}. ` : ''}moved ${moved.toFixed(2)} in all, worst sum drift ${drift.toExponential(2)} (past ${STAMP_GATE_FLOW_TOLERANCE} fails), least ${least}, most change on or past the stripe ${fenced}`,
  };
}

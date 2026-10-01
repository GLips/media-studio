// stamp-gate-stripe.ts: the bloom and drying-rim stages (stamp-wet-bloom.ts, stamp-wet-rim.ts) each run alone over
// a layer the gate writes: two wet patches, each its own pigment, either side of a stripe of masking fluid, which
// holds no paint and closes the footprint to it. A drop of water lands by the stripe for the bloom; the rim gathers
// at the patches' edges along it. Held to properties, as their looks are still being tuned:
//
// - every pigment channel's sum holds within STAMP_GATE_FLOW_TOLERANCE, and no pixel holds less than none;
// - neither patch's pigment crosses the stripe, by any amount;
// - crayon, which has no water, changes nothing; a medium that flows moves some paint.

import { stampLinearDynamics } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/picture/paint/models/paint-watercolour-pigments.ts';
import type { PaintPigmentAppearance } from '#lib/picture/paint/models/paint-pigment.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type CompiledStampPaint, type PaintMaterial } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import { STAMP_GATE_FLOW_TOLERANCE, type StampGateFlowMedium } from './stamp-gate-flow.ts';
import { stampGateBrush, stampGatePolygon } from './stamp-gate-paintings.ts';
import type { StampGateWashCheck } from './stamp-gate-washes.ts';

export const STAMP_GATE_STRIPE_SIZE = { width: 192, height: 128 };
/** The layer's array layers: coverage, two pigments, and the open share in the last channel. */
export const STAMP_GATE_STRIPE_LAYERS = 2;
/** The masked columns, holding no paint and closed to it. */
const STRIPE = { x0: 92, x1: 100 };
/** The bloom's drop, its front reaching the stripe. */
const DROP = { x: 72, y: 64, diameter: 36 };
const PATCH = { y0: 16, y1: 112, left: 16, right: 176 };

export type StampGateStripeStage = 'bloom' | 'rim';
export const STAMP_GATE_STRIPE_IDS = (['bloom', 'rim'] as const).flatMap((stage) => (['watercolour', 'gouache', 'crayon'] as const).map((medium) => `stripe/${stage}-${medium}`));

/** A stripe case's stage and medium, from its ID. */
export function stampGateStripeCase(id: string): { stage: StampGateStripeStage; medium: StampGateFlowMedium } {
  const match = /^stripe\/(bloom|rim)-(watercolour|gouache|crayon)$/.exec(id);
  if (!match) throw new Error(`stamp gate: no stripe case ${JSON.stringify(id)}; the gate runs ${STAMP_GATE_STRIPE_IDS.join(', ')}`);
  // SAFETY: the pattern admits only these words.
  return { stage: match[1] as StampGateStripeStage, medium: match[2] as StampGateFlowMedium };
}

const BRUSH = stampGateBrush('Stripe', { flow: 1, spacing: 0.25, dynamics: stampLinearDynamics({}) });
const pure = (pigment: PaintPigmentAppearance): PaintMaterial => ({ kind: 'mixture', parts: [{ pigment, amount: 1 }], strength: 1 });

/**
 * The painting the stage loads for: one wash, its two patches puddled either side of the stripe (the rim's one
 * drying), then the drop, its last deposit, once they're damp.
 */
export function stampGateStripePainting(): CompiledStampPaint {
  const { y0, y1, left, right } = PATCH;
  return compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => {
    group.wash('w', {}, (wash) => {
      wash.mask('stripe', { region: stampGatePolygon(STRIPE.x0, 0, STRIPE.x1, 0, STRIPE.x1, 128, STRIPE.x0, 128) });
      wash.fill('left', { brush: BRUSH, diameter: 30, application: { kind: 'flood' }, region: stampGatePolygon(left, y0, STRIPE.x0, y0, STRIPE.x0, y1, left, y1), material: pure(W.ultramarine), water: 1 });
      wash.fill('right', { brush: BRUSH, diameter: 30, application: { kind: 'flood' }, region: stampGatePolygon(STRIPE.x1, y0, right, y0, right, y1, STRIPE.x1, y1), material: pure(W.burntSienna), water: 1 });
      wash.bloom('drop', { brush: BRUSH, diameter: DROP.diameter, at: [DROP] });
    });
  })));
}

/**
 * The layer as the drop left it (by array layer, RGBA per pixel) and its footprint (r: what the drop laid, g: where
 * paint may land): each patch's pigment in its own channel at a grainy amount, wholly open, none on the stripe.
 */
export function stampGateStripeLayer(): { layer: Float32Array[]; footprint: Float32Array } {
  const { width, height } = STAMP_GATE_STRIPE_SIZE, size = width * height * 4;
  const layer = [new Float32Array(size), new Float32Array(size)], footprint = new Float32Array(size);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, inPatch = y >= PATCH.y0 && y < PATCH.y1 && x >= PATCH.left && x < PATCH.right && (x < STRIPE.x0 || x >= STRIPE.x1);
    const amount = inPatch ? 0.5 + 0.2 * Math.sin(x * 0.7) * Math.cos(y * 0.9) : 0;
    layer[0].set([inPatch ? 0.8 : 0, x < STRIPE.x0 ? amount : 0, x >= STRIPE.x1 ? amount : 0, 0], i);
    layer[1].set([0, 0, 0, inPatch ? 1 : 0], i);
    const drop = Math.hypot(x + 0.5 - DROP.x, y + 0.5 - DROP.y) < DROP.diameter / 2 ? 1 : 0;
    footprint.set([drop, x >= STRIPE.x0 && x < STRIPE.x1 ? 0 : 1, 0, 0], i);
  }
  return { layer, footprint };
}

/**
 * Whether the stage held stripe case `id`'s layer, read back `before` and `after` it ran (array layer by array layer,
 * RGBA per pixel), to the properties.
 */
export function checkStampGateStripe(id: string, before: ArrayLike<number>, after: ArrayLike<number>): StampGateWashCheck {
  const { width, height } = STAMP_GATE_STRIPE_SIZE, pixels = width * height, { medium } = stampGateStripeCase(id);
  // Channel 1 the left patch's pigment, 2 the right's, both in the first array layer.
  const sums = [1, 2].map((c) => ({ before: 0, after: 0, crossed: 0, c }));
  let least = Infinity, moved = 0;
  for (let p = 0; p < pixels; p++) {
    const x = p % width;
    for (const s of sums) {
      const i = p * 4 + s.c;
      s.before += before[i];
      s.after += after[i];
      if (s.c === 1 ? x >= STRIPE.x0 : x < STRIPE.x1) s.crossed = Math.max(s.crossed, after[i]);
    }
  }
  for (let i = 0; i < after.length; i++) {
    least = Math.min(least, after[i]);
    moved += Math.abs(after[i] - before[i]);
  }
  const drift = Math.max(...sums.map((s) => Math.abs(s.after - s.before) / s.before));
  const crossed = Math.max(...sums.map((s) => s.crossed));
  const problems = [
    ...(drift > STAMP_GATE_FLOW_TOLERANCE ? [`a pigment's sum drifted ${drift.toExponential(2)}`] : []),
    ...(least < 0 ? [`a pixel holds ${least}`] : []),
    ...(crossed > 0 ? [`a patch's pigment crossed the stripe, ${crossed} at most`] : []),
    ...(medium === 'crayon' && moved > 0 ? [`in crayon it moved ${moved.toFixed(3)} in all`] : []),
    // So a stage that moves nothing can't pass.
    ...(medium !== 'crayon' && moved === 0 ? ['nothing moved'] : []),
  ];
  return {
    id: `${id}: conserved, each pigment its own side`, passed: !problems.length,
    detail: `${problems.length ? `${problems.join('; ')}. ` : ''}moved ${moved.toFixed(2)} in all, worst sum drift ${drift.toExponential(2)} (past ${STAMP_GATE_FLOW_TOLERANCE} fails), least ${least}, most across the stripe ${crossed}`,
  };
}

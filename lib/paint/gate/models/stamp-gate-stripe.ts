// stamp-gate-stripe.ts: the bloom and drying-rim stages (stamp-wet-bloom.ts, stamp-wet-rim.ts) each run alone over
// a layer the gate writes: two wet patches, each its own pigment, either side of a stripe of masking fluid, which
// holds no paint and closes the footprint to it. A drop of water lands by the stripe for the bloom; the rim gathers
// at the patches' edges along it. Held to properties, as their looks are still being tuned:
//
// - every pigment channel's sum holds within STAMP_GATE_FLOW_TOLERANCE, and no pixel holds less than none;
// - neither patch's pigment crosses the stripe, by any amount;
// - each medium moves some paint. Crayon refuses water ('water' capability), so it has no case here;
// - rim strength 0 moves nothing, 2 more than 1.

import { stampLinearDynamics } from '#lib/paint/brush/models/stamp-brush.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
import { compileStampPaintRecipe, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { STAMP_GATE_FLOW_TOLERANCE, STAMP_GATE_STAGE_ENVIRONMENT } from './stamp-gate-flow.ts';
import { stampGateBrush, stampGatePolygon } from './stamp-gate-paintings.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';
import { stampBloom } from '#lib/paint/painting/models/stamp-wet-techniques.ts';

export const STAMP_GATE_STRIPE_SIZE = { width: 192, height: 128 };
/** The layer's array layers: coverage, two pigments, and the open share in the last channel. */
export const STAMP_GATE_STRIPE_LAYERS = 2;
/** The masked columns, holding no paint and closed to it. */
const STRIPE = { x0: 92, x1: 100 };
/** The bloom's drop, its front reaching the stripe. */
const DROP = { x: 72, y: 64, diameter: 36 };
const PATCH = { y0: 16, y1: 112, left: 16, right: 176 };

export type StampGateStripeStage = 'bloom' | 'rim' | 'rim-strength';
/** The media a stripe case runs in: those that take water. */
type StampGateStripeMedium = 'watercolour' | 'gouache';
const STAMP_GATE_RIM_STRENGTH_ID = 'stripe/rim-strength';
export const STAMP_GATE_STRIPE_IDS = [
  ...(['bloom', 'rim'] as const).flatMap((stage) => (['watercolour', 'gouache'] as const).map((medium) => `stripe/${stage}-${medium}`)),
  STAMP_GATE_RIM_STRENGTH_ID,
];

/** The rim strengths stripe/rim-strength runs at, in order. */
export const STAMP_GATE_RIM_STRENGTHS = [0, 1, 2] as const;

/** A stripe case's stage and medium, from its ID. */
export function stampGateStripeCase(id: string): { stage: StampGateStripeStage; medium: StampGateStripeMedium } {
  if (id === STAMP_GATE_RIM_STRENGTH_ID) return { stage: 'rim-strength', medium: 'watercolour' };
  const match = /^stripe\/(bloom|rim)-(watercolour|gouache)$/.exec(id);
  if (!match) throw new Error(`stamp gate: no stripe case ${JSON.stringify(id)}; the gate runs ${STAMP_GATE_STRIPE_IDS.join(', ')}`);
  // SAFETY: the pattern admits only these words.
  return { stage: match[1] as StampGateStripeStage, medium: match[2] as StampGateStripeMedium };
}

const BRUSH = stampGateBrush('Stripe', { flow: 1, spacing: 0.25, dynamics: stampLinearDynamics({}) });
const pure = (pigment: PaintPigmentAppearance): PaintMaterial => ({ kind: 'mixture', parts: [{ pigment, amount: 1 }], strength: 1 });

/**
 * The painting the stage loads for: one wash, its two patches puddled either side of the stripe (the rim's one
 * drying, at strength `rim`, the medium's when left out), then the drop, its last deposit, once they're damp.
 */
export function stampGateStripePainting(rim?: number): CompiledStampPaint {
  const { y0, y1, left, right } = PATCH;
  return compileStampPaintRecipe(stampPaintRecipe(STAMP_GATE_STAGE_ENVIRONMENT, (paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => {
    group.passage('w', { ...(rim !== undefined && { rim }) }, (wash) => {
      wash.mask('stripe', { region: stampGatePolygon(STRIPE.x0, 0, STRIPE.x1, 0, STRIPE.x1, 128, STRIPE.x0, 128) });
      wash.fill('left', { brush: BRUSH, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(left, y0, STRIPE.x0, y0, STRIPE.x0, y1, left, y1), well: { paint: pure(W.ultramarine), water: 1 } });
      wash.fill('right', { brush: BRUSH, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(STRIPE.x1, y0, right, y0, right, y1, STRIPE.x1, y1), well: { paint: pure(W.burntSienna), water: 1 } });
      stampBloom(wash, 'drop', { brush: BRUSH, size: DROP.diameter, at: [DROP] });
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
 * The wash's wet field as the drop finds it (stamp-wet-field.ts, RGBA per pixel), as the floods left it: each patch
 * standing wet from its flood's painting second (`left`, `right`), still unsettled; and what the drying saw there, as
 * wet as can be, touched wholly by their 30 px tools.
 */
export function stampGateStripeField({ left, right }: { left: number; right: number }): { paper: Float32Array; rim: Float32Array } {
  const { width, height } = STAMP_GATE_STRIPE_SIZE, size = width * height * 4;
  const paper = new Float32Array(size), rim = new Float32Array(size);
  for (let y = PATCH.y0; y < PATCH.y1; y++) for (let x = PATCH.left; x < PATCH.right; x++) {
    if (x >= STRIPE.x0 && x < STRIPE.x1) continue;
    const i = (y * width + x) * 4;
    paper.set([1, x < STRIPE.x0 ? left : right, 0, 0], i);
    rim.set([1, 1, 30, 0], i);
  }
  return { paper, rim };
}

/** How much a stage moved in all, and its worst pigment sum's drift and least pixel, `before` and `after` it ran. */
function stripeMoves(before: ArrayLike<number>, after: ArrayLike<number>) {
  const pixels = STAMP_GATE_STRIPE_SIZE.width * STAMP_GATE_STRIPE_SIZE.height;
  const sums = [1, 2].map((c) => {
    let had = 0, has = 0;
    for (let p = 0; p < pixels; p++) {
      had += before[p * 4 + c];
      has += after[p * 4 + c];
    }
    return Math.abs(has - had) / had;
  });
  let least = Infinity, moved = 0;
  for (let i = 0; i < after.length; i++) {
    least = Math.min(least, after[i]);
    moved += Math.abs(after[i] - before[i]);
  }
  return { moved, drift: Math.max(...sums), least };
}

/** One run of stripe/rim-strength: its strength, the layer `before` and `after`, and whether the stage owned the patches' wet edges. */
export type StampGateRimStrengthRun = { rim: number; before: ArrayLike<number>; after: ArrayLike<number>; ownsEdges: boolean };

/**
 * Whether the rim at STAMP_GATE_RIM_STRENGTHS held: at 0 nothing moved and it still owned its deposits' wet edges (so
 * their brushes' rims stay off); at 2 more moved than at 1, which moved some; each conserved and none below nothing.
 */
export function checkStampGateRimStrength(id: string, runs: readonly StampGateRimStrengthRun[]): StampGateWashCheck {
  const read = runs.map((run) => ({ ...run, ...stripeMoves(run.before, run.after) }));
  const at = (rim: number) => read.find((run) => run.rim === rim)!;
  const none = at(0), medium = at(1), twice = at(2);
  const problems = [
    ...(none.moved > 0 ? [`at 0 it moved ${none.moved.toFixed(3)}`] : []),
    ...(none.ownsEdges ? [] : ["at 0 it gave its deposits' wet edges back to their brushes"]),
    ...(medium.moved > 0 ? [] : ['at 1 nothing moved']),
    ...(twice.moved > medium.moved ? [] : ['at 2 no more moved than at 1']),
    ...read.flatMap(({ rim, drift, least }) => [
      ...(drift > STAMP_GATE_FLOW_TOLERANCE ? [`at ${rim} a pigment's sum drifted ${drift.toExponential(2)}`] : []),
      ...(least < 0 ? [`at ${rim} a pixel holds ${least}`] : []),
    ]),
  ];
  return {
    id: `${id}: 0 moves nothing, 2 more than 1, conserved`, passed: !problems.length,
    detail: `${problems.length ? `${problems.join('; ')}. ` : ''}${read.map(({ rim, moved, drift }) => `at ${rim} moved ${moved.toFixed(2)}, drift ${drift.toExponential(2)}`).join('; ')} (past ${STAMP_GATE_FLOW_TOLERANCE} fails)`,
  };
}

/**
 * Whether the stage held stripe case `id`'s layer, read back `before` and `after` it ran (array layer by array layer,
 * RGBA per pixel), to the properties.
 */
export function checkStampGateStripe(id: string, before: ArrayLike<number>, after: ArrayLike<number>): StampGateWashCheck {
  const { width, height } = STAMP_GATE_STRIPE_SIZE, pixels = width * height;
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
    // So a stage that moves nothing can't pass.
    ...(moved === 0 ? ['nothing moved'] : []),
  ];
  return {
    id: `${id}: conserved, each pigment its own side`, passed: !problems.length,
    detail: `${problems.length ? `${problems.join('; ')}. ` : ''}moved ${moved.toFixed(2)} in all, worst sum drift ${drift.toExponential(2)} (past ${STAMP_GATE_FLOW_TOLERANCE} fails), least ${least}, most across the stripe ${crossed}`,
  };
}

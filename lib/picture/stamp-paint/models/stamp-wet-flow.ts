// stamp-wet-flow.ts: how wet paint moves once a wash deposit lands (the flow stage, studio/stamp-wet-flow.ts): its
// fresh paint feathers into water on the paper, soft the wetter it is and hard on dry paper, and paint already there
// evens out as its water stirs it, so strokes in one wash merge rather than band; after a lift, the wet paint round it
// runs back in across its edge. Each is a conserved diffusion that never crosses a dry gap or where paint may not
// land. docs/brush-engine.md ("The flow stage") has the scheme: potentials, ways, and strides growing by about √2.
//
// WGSL only, apart from planning the passes: the renderer is the one place it runs.

import type { PaintMedium } from '#lib/picture/paint/models/paint-medium.ts';
import type { CompiledStampDeposit } from './stamp-paint-recipe.ts';
import { STAMP_WET_LIFT_WGSL } from './stamp-wet-lift.ts';

/**
 * The furthest wet paint runs back into a lift, as a sigma in px: a broad lift on a flooded sheet would otherwise
 * take strides across the painting, and paint that has run this far reads as settled anyway.
 */
export const STAMP_LIFT_RUN_BACK_MOST_SIGMA = 16;

/**
 * How far a deposit's paint moves on flooded paper, as a diffusion's sigma in px: its medium's spread of its diameter,
 * reaching about 2 sigma; a lift's run-back a third of that spread, at most STAMP_LIFT_RUN_BACK_MOST_SIGMA.
 */
export function stampWetFlowSigma(deposit: CompiledStampDeposit, medium: PaintMedium): number {
  const { spread } = medium.wetting;
  return deposit.action.kind === 'lift' ? Math.min(STAMP_LIFT_RUN_BACK_MOST_SIGMA, (spread * deposit.diameter) / 3) : (spread * deposit.diameter) / 2;
}

/**
 * The passes a diffusion of up to `sigma` px takes: each's stride, and the variance the passes before it lay when
 * each is taken whole (flowLevelShare's `before`). None for 0.
 */
export function stampWetFlowStrides(sigma: number): { stride: number; before: number }[] {
  const strides: { stride: number; before: number }[] = [];
  for (let stride = 1, before = 0; before < sigma * sigma; stride = Math.max(stride + 1, Math.round(stride * Math.SQRT2))) {
    strides.push({ stride, before });
    before += (stride * stride) / 2;
  }
  return strides;
}

/** How far past its own paint a deposit's flow reaches, px: three of its sigma. */
export const stampWetFlowReach = (sigma: number) => (sigma > 0 ? Math.ceil(3 * sigma) : 0);

/** The flow's laws, per pixel pair and pass; the stage reads potentials and ways and runs them. */
export const STAMP_WET_FLOW_WGSL = /* wgsl */ `${STAMP_WET_LIFT_WGSL}
// How much of a pass at \`stride\` a pair whose diffusion is \`sigma\` wide takes, the passes below having laid \`before\`.
fn flowLevelShare(sigma: f32, stride: f32, before: f32) -> f32 {
  return clamp((sigma * sigma - before) / (stride * stride * 0.5), 0.0, 1.0);
}
// How wet the paper is as paint moves over it: as it was, or where the deposit's brush touched, as wet as its water.
fn flowWetness(before: f32, water: f32, coverage: f32) -> f32 {
  return max(before, water * clamp(2.0 * coverage, 0.0, 1.0));
}
// How much of the paint already there the deposit's water moves: what never set (\`open\`, as workable), where it touched.
fn flowStirred(workable: f32, open: f32, coverage: f32) -> f32 {
  return liftFree(workable, open) * clamp(2.0 * coverage, 0.0, 1.0);
}
// How much of the paint round a lift runs back into it: as loose as the lift would find it (liftLoose).
fn flowLiftStirred(workable: f32, open: f32, rewetting: f32) -> f32 {
  return liftLoose(liftFree(workable, open), rewetting);
}
// The share of a pair's trade a lift allows: the lift's edge is what stirs, so a pair trades as far as either was lifted.
fn flowLiftPair(lifted: f32, partnerLifted: f32) -> f32 {
  return clamp(max(lifted, partnerLifted), 0.0, 1.0);
}
// The share of a pass two pixels trade, by the driest paper on the way between and the least open to paint.
fn flowConductance(sigma: f32, stride: f32, before: f32, wet: f32, open: f32) -> f32 {
  return 0.25 * flowLevelShare(sigma * clamp(wet, 0.0, 1.0), stride, before) * clamp(open, 0.0, 1.0);
}
// How freely a pixel's paint moves: as stirred, and as much as it holds of its potential, so it never gives more.
fn flowFree(stirred: f32, held: vec4f, potential: vec4f) -> vec4f {
  return clamp(stirred, 0.0, 1.0) * select(vec4f(0.0), clamp(held / potential, vec4f(0.0), vec4f(1.0)), potential > vec4f(0.0));
}
// What a potential gains from its partner's (negative for a loss): the higher gives by the difference, as free as it
// is. Both of a pair call it alike, so what one loses the other gains; with k <= 1/4 and two partners, a pixel gives
// at most half of what it holds.
fn flowOut(high: vec4f, low: vec4f, free: vec4f, k: f32) -> vec4f { return k * (high - low) * free; }
fn flowInto(here: vec4f, there: vec4f, freeHere: vec4f, freeThere: vec4f, k: f32) -> vec4f {
  let gained = select(vec4f(0.0), flowOut(there, here, freeThere, k), there > here);
  let lost = select(vec4f(0.0), flowOut(here, there, freeHere, k), here > there);
  return gained - lost;
}`;

// stamp-wet-flow.ts: how wet paint moves once a wash deposit lands (the flow stage, studio/stamp-wet-flow.ts): fresh
// paint feathers into water, and paint already there evens out as the water stirs it, so strokes in one wash merge;
// after a lift, wet paint runs back in. Each is a conserved diffusion of paint per unit of the paper's hold, never
// crossing a dry gap or where paint may not land: it trades along the shared transport's ways
// (stamp-wet-transport.ts). docs/brush-engine.md ("The flow stage") has the scheme.
//
// WGSL only, apart from planning the passes: the renderer is the one place it runs.

import type { PaintMedium } from '#lib/picture/paint/models/paint-medium.ts';
import type { CompiledStampDeposit } from './stamp-paint-recipe.ts';
import { STAMP_WET_LIFT_WGSL } from './stamp-wet-lift.ts';
import { STAMP_WET_TRANSPORT_WGSL } from './stamp-wet-transport.ts';

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
 * Where a deposit's water went: how wet the paper is as paint moves over it, as it was, or where the deposit's brush
 * touched (the coverage it laid), as wet as its water. The one definition every wet stage reads.
 */
export const STAMP_WET_FLOW_WETNESS_WGSL = /* wgsl */ `
fn flowWetness(before: f32, water: f32, coverage: f32) -> f32 {
  return max(before, water * clamp(2.0 * coverage, 0.0, 1.0));
}`;

/** The flow's laws, per pixel pair and pass; the stage reads potentials and the transport's ways and runs them. */
export const STAMP_WET_FLOW_WGSL = /* wgsl */ `${STAMP_WET_LIFT_WGSL}
${STAMP_WET_TRANSPORT_WGSL}
${STAMP_WET_FLOW_WETNESS_WGSL}
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
// How freely a population's paint moves: as stirred, and as much of the pixel's paint as it holds, so the populations
// together never give more than the pixel has.
fn flowFree(stirred: f32, held: vec4f, whole: vec4f) -> vec4f {
  return clamp(stirred, 0.0, 1.0) * select(vec4f(0.0), clamp(held / whole, vec4f(0.0), vec4f(1.0)), whole > vec4f(0.0));
}
// What a pixel gains from its partner (negative for a loss). Paint runs down the gradient of its amount per unit of
// hold (\`here\`, \`there\`), through the lesser hold of the pair, as free as the giver's is. Both of a pair call it
// alike, so what one loses the other gains; as paint over hold through the lesser hold is at most what the giver has,
// with k <= 1/4 and two partners a pixel gives at most half of it.
fn flowInto(here: vec4f, there: vec4f, holdHere: vec4f, holdThere: vec4f, freeHere: vec4f, freeThere: vec4f, k: f32) -> vec4f {
  let through = k * min(holdHere, holdThere);
  let gained = select(vec4f(0.0), through * (there - here) * freeThere, there > here);
  let lost = select(vec4f(0.0), through * (here - there) * freeHere, here > there);
  return gained - lost;
}`;

// stamp-wet-lift.ts: how a lift takes paint up. Per pixel (wetLift), a thirsty brush or tissue takes its share of
// the loose paint, never a pigment's stain, and what it takes leaves the painting. Around the lift, wet paint runs
// back in across its edge (studio/stamp-wet-lift-run-back.ts). WGSL only: the renderer is the one place it runs.

/**
 * How much of a pigment, in unit films, the paper's fibres can hold as stain once the paint has set: a stain is dye in
 * the fibres, so a thick film's is no deeper than a thin one's. A full watercolour wash of phthalo (staining 0.9)
 * holds most of itself; the same pigment in thick gouache, a smaller share.
 */
export const STAMP_LIFT_STAIN_FIBRES = 0.6;

/**
 * Of that stain, the share already held while the paint is wet: a staining pigment's finest particles dye the fibres
 * as they land, the rest as the paint sets. So wet phthalo lifts to a pale tint, and dry phthalo hardly at all.
 */
export const STAMP_LIFT_WET_STAIN_HOLD = 0.4;

/**
 * `wetLift(was, cover, strength, workable, rewetting, stain)`: four pigment amounts after a lift at `cover` and
 * `strength` over paint `workable` free, set paint loosening by the medium's `rewetting`, each pigment staining
 * `stain`. Each amount keeps between its stain and all of itself; at most `cover * strength` of it goes.
 */
export const STAMP_WET_LIFT_WGSL = /* wgsl */ `
fn wetLift(was: vec4f, cover: f32, strength: f32, workable: f32, rewetting: f32, stain: vec4f) -> vec4f {
  let free = clamp(workable, 0.0, 1.0);
  let loose = mix(clamp(rewetting, 0.0, 1.0), 1.0, free);
  let fibres = ${STAMP_LIFT_STAIN_FIBRES.toFixed(3)} * mix(1.0, ${STAMP_LIFT_WET_STAIN_HOLD.toFixed(3)}, free);
  let held = min(was, clamp(stain, vec4f(0.0), vec4f(1.0)) * fibres);
  let take = clamp(cover * strength, 0.0, 1.0) * loose;
  return was - take * (was - held);
}`;

/**
 * How far wet paint runs back into a lift, as a Gaussian's sigma in pixels: a third of how far the medium's paint
 * spreads by itself (`flow`, in diameters of the lifting brush), as wet as the paper is.
 */
export function stampLiftRunBackSigma(flow: number, diameter: number, wetness: number): number {
  return (flow * diameter * Math.min(1, Math.max(0, wetness))) / 3;
}

/**
 * The run-back. `liftRunBackMobility`: how freely paint joins it, by the paper's `wetness` and `lifted`, the lift's
 * coverage blurred as far as paint runs: most on the lift's edge, none deep inside or far out. `liftRunBack`: amounts
 * `was` after it, given mobility `g`, the blurred mobility-weighted amounts `pulled` and blurred mobility `reach`.
 */
export const STAMP_LIFT_RUN_BACK_WGSL = /* wgsl */ `
fn liftRunBackMobility(wetness: f32, lifted: f32) -> f32 {
  let l = clamp(lifted, 0.0, 1.0);
  return clamp(wetness, 0.0, 1.0) * 4.0 * l * (1.0 - l);
}
// Pixels i and j trade g_i g_j K(i - j) (a_j - a_i), symmetric, so pigment is conserved; with g <= 1 and K summing
// to 1 none goes negative, and the max only holds f16 rounding.
fn liftRunBack(was: vec4f, g: f32, pulled: vec4f, reach: f32) -> vec4f {
  return max(was + g * (pulled - was * reach), vec4f(0.0));
}`;

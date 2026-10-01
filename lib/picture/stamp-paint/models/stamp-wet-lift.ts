// stamp-wet-lift.ts: how a lift takes paint up. Per pixel (wetLift), a thirsty brush or tissue takes its share of
// the loose paint, never a pigment's stain, and what it takes leaves the painting. Around the lift, wet paint runs
// back in across its edge (studio/stamp-wet-lift-run-back.ts). WGSL only: the renderer is the one place it runs.

/**
 * How deep, in unit films, the paper's fibres take a stain once paint has set: a pigment stains its `staining` share of
 * its first this-many films, so a thin tint keeps its stain in proportion (lifting it leaves its hue) while thick
 * gouache's stain is no deeper than a full wash's.
 */
export const STAMP_LIFT_STAIN_FIBRES = 0.6;

/**
 * Of that stain, the share already held while the paint is wet: a staining pigment's finest particles dye the fibres
 * as they land, the rest as the paint sets. So wet phthalo lifts to a pale tint, and dry phthalo hardly at all.
 */
export const STAMP_LIFT_WET_STAIN_HOLD = 0.4;

/**
 * `wetLift(was, cover, strength, workable, dried, rewetting, stain)`: four pigment amounts after a lift at `cover`
 * and `strength`. Paint that never set is as loose as it's `workable`; the `dried` share loosens only by the medium's
 * `rewetting`, however wet again. Each keeps between its stain (`stain`) and all of itself.
 */
export const STAMP_WET_LIFT_WGSL = /* wgsl */ `
// How free the paint is, as fresh paint is: what of it never set, as workable as it is.
fn liftFree(workable: f32, dried: f32) -> f32 { return clamp(workable, 0.0, 1.0) * (1.0 - clamp(dried, 0.0, 1.0)); }
// How much of the paint a lift can work up: all that's free, and of the rest what the medium's rewetting loosens.
fn liftLoose(free: f32, rewetting: f32) -> f32 { return mix(clamp(rewetting, 0.0, 1.0), 1.0, free); }
fn wetLift(was: vec4f, cover: f32, strength: f32, workable: f32, dried: f32, rewetting: f32, stain: vec4f) -> vec4f {
  let free = liftFree(workable, dried);
  let loose = liftLoose(free, rewetting);
  let hold = mix(1.0, ${STAMP_LIFT_WET_STAIN_HOLD.toFixed(3)}, free);
  let held = clamp(stain, vec4f(0.0), vec4f(1.0)) * min(was, vec4f(${STAMP_LIFT_STAIN_FIBRES.toFixed(3)})) * hold;
  let take = clamp(cover * strength, 0.0, 1.0) * loose;
  return was - take * (was - held);
}`;

/**
 * How far wet paint runs back into a lift, as a Gaussian's sigma in pixels: a third of how far the medium's paint
 * spreads by itself (`spread`, in diameters of the lifting brush), as wet as the paper is.
 */
export function stampLiftRunBackSigma(spread: number, diameter: number, wetness: number): number {
  return (spread * diameter * Math.min(1, Math.max(0, wetness))) / 3;
}

/**
 * The run-back, lift law included. `liftRunBackMobility`: how freely paint joins it: by the paper's wetness,
 * how loose its paint is, and `lifted`, the lift's coverage blurred as far as paint runs, so most on the lift's edge.
 * `liftRunBack`: amounts after it, given mobility `g`, blurred weighted amounts `pulled` and blurred mobility `reach`.
 */
export const STAMP_LIFT_RUN_BACK_WGSL = /* wgsl */ `${STAMP_WET_LIFT_WGSL}
fn liftRunBackMobility(wetness: f32, workable: f32, dried: f32, rewetting: f32, lifted: f32) -> f32 {
  let l = clamp(lifted, 0.0, 1.0);
  return clamp(wetness, 0.0, 1.0) * liftLoose(liftFree(workable, dried), rewetting) * 4.0 * l * (1.0 - l);
}
// Pixels i and j trade g_i g_j K(i - j) (a_j - a_i), symmetric, so pigment is conserved; with g <= 1 and K summing
// to 1 none goes negative, and the max only holds f16 rounding.
fn liftRunBack(was: vec4f, g: f32, pulled: vec4f, reach: f32) -> vec4f {
  return max(was + g * (pulled - was * reach), vec4f(0.0));
}`;

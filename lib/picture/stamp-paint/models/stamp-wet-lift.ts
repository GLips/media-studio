// stamp-wet-lift.ts: how a lift takes paint up, per pixel: a thirsty brush or tissue takes what it can of paint that
// still moves, and never a pigment's stain.
//
// WGSL only: the renderer is the one place it runs. The GPU gate holds it to a formula grid of its own.

/**
 * `wetLift(was, cover, strength, workable, stain)`: a layer of four pigment amounts after a lift at `cover` and
 * `strength` over paint `workable` free, each amount's pigment staining `stain` of it (0..1) into the paper.
 */
export const STAMP_WET_LIFT_WGSL = /* wgsl */ `
fn wetLift(was: vec4f, cover: f32, strength: f32, workable: f32, stain: vec4f) -> vec4f {
  return was - (was * (1.0 - stain)) * clamp(cover * strength * workable, 0.0, 1.0);
}`;

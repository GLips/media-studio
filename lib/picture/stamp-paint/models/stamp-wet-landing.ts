// stamp-wet-landing.ts: how a wash's paint lands in pigment, per pixel, as wet as its landing is
// (stamp-wetness.ts). A plain pass lands by the pigment compositor's own law, which moves the paint there toward the
// incoming as a stroke over a dried wash does; a wash's paint joins the water already there, so its pigment adds.
//
// WGSL only: the renderer is the one place it runs. The GPU gate holds it to a formula grid of its own.

/**
 * `wetLand(was, incoming, cover, wetness, workable)`: a layer of four pigment amounts after `incoming` (a full
 * stroke's amounts) lands at `cover` on paper `wetness` wet whose paint moves `workable` freely.
 */
export const STAMP_WET_LAND_WGSL = /* wgsl */ `
fn wetLand(was: vec4f, incoming: vec4f, cover: f32, wetness: f32, workable: f32) -> vec4f {
  return was + cover * incoming;
}`;

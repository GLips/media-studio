// stamp-paint-pigment-lay.ts: how a deposit lays its paint into a group's layer in a pigment medium, as WGSL with the
// medium's numbers written in, one set per medium (its suffix `s`): mixing (watercolour, gouache) or stacking (crayon),
// and the whole of a dry brush's meeting with the paper in a wet medium. It calls the compositor's incomingAt and
// reads its bindings (layer, before, paint, u): stamp-paint-pigment-compositor.ts is its one caller.
//
// Negative space: only a mixing lay takes a dry brush's share. The one stacking medium, crayon, meets the paper on its
// peaks already, so no dry brush is dragged in it.

import type { PaintMedium, PaintStackedLayering } from '#lib/paint/materials/models/paint-medium.ts';
import { gpuWgslFloat as f32 } from '#lib/platform/gpu/models/gpu-wgsl.ts';

/**
 * The paper contact a deposit's own paint is laid at in `medium`, `own` the medium's (WGSL): a dry brush's paint, in
 * a wet medium, settles nowhere, its contact with the paper being the rate it lays at (dryBrushShare).
 */
export const stampPigmentLayContactWgsl = (medium: PaintMedium, own: string) =>
  (medium.paperContact.kind === 'valleys' ? `select(${own}, 1.0, paint.dryBrush != 0u)` : own);

/**
 * How much of a pixel a dry brush in a wet medium lays at: the peaks it catches at the hand's press, the valleys bare
 * whatever the paper's depth, which is tuned to how wet paint shows the tooth. 1 for any other deposit; a dry
 * medium's tooth is its paint's own contact.
 */
const dryBrushShare = ({ paperContact }: PaintMedium, s: string) => /* wgsl */ `
fn dryBrushShare${s}(tooth: vec2f, press: f32) -> f32 {
  ${paperContact.kind === 'valleys'
    ? `if (paint.dryBrush == 0u) { return 1.0; }
  return paintDryContact(1.0 - tooth.x, 1.0 - tooth.y, ${f32(paperContact.dryBrush.tooth)}, 1.0, press, 0.0);`
    : 'return 1.0;'}
}`;

/**
 * A mixing medium's lay: each stroke moves the paint toward its own, carrying `pickup` of the wet paint under it, so
 * where two washes meet they mix rather than one replacing the other. A dry brush moves it only where it touches the
 * paper (dryBrushShare): the valleys it skips keep what's there, scumbled over, not thinned.
 */
const mixedLay = (medium: PaintMedium, s: string) => /* wgsl */ `${dryBrushShare(medium, s)}
fn layDeposit${s}(pixel: vec2u, coverage: f32, rims: vec2f, tooth: vec2f, at: vec2f, press: f32, wrap: vec2f) {
  let cover = clamp(coverage + max(rims.x, rims.y), 0.0, 1.0);
  if (cover <= 0.0) { return; }
  let incoming = incomingAt${s}(tooth, at, press, 0.0, wrap);
  let under = textureLoad(layer, pixel, 0u).x;
  let rate = cover * dryBrushShare${s}(tooth, press) * (1.0 - ${f32(medium.pickup)} * under);
  for (var l = 0u; l < LAYERS; l++) {
    if (isKnockoutLayer(l)) { continue; }
    let was = textureLoad(layer, pixel, l);
    var now = was + rate * (incoming[l] - was);
    if (l == 0u) { now.x = cover + under * (1.0 - cover); }
    textureStore(layer, pixel, l, now);
  }
}`;

/** How far round a pixel a stacking medium's tooth fills from, in texels of the paper's grain: about a valley across. */
export const STAMP_STACKED_FILL_REACH = 6;

/**
 * A stacking medium's lay (PaintStackedLayering): each layer adds its pigment to what the tooth holds, as crossing
 * crayon layers mix. Past `holds` full loads a stroke trades its wax for what's there, its own on top. Wax held fills
 * the valleys `fill` of the way, so each later layer reaches further into them.
 */
const stackedLay = ({ holds, fill }: PaintStackedLayering, body: number, s: string) => /* wgsl */ `
// The wax held round \`pixel\` before this deposit, a ring u.beforeReach pixels out and the pixel: a valley fills with
// wax pressed in from the peaks round it, never having caught any itself.
fn heldAround${s}(pixel: vec2u) -> f32 {
  let last = vec2i(textureDimensions(before)) - 1;
  var held = 0.0;
  for (var k = 0; k < 9; k++) {
    let angle = f32(k) * 0.7854;
    let offset = select(vec2i(round(u.beforeReach * vec2f(cos(angle), sin(angle)))), vec2i(0), k == 8);
    let q = vec2u(clamp(vec2i(pixel) + offset, vec2i(0), last));
    for (var l = 0u; l < LAYERS; l++) { if (!isKnockoutLayer(l)) { held += dot(textureLoad(before, q, l, 0), pigmentMask(l)); } }
  }
  return held / 9.0;
}
fn layDeposit${s}(pixel: vec2u, coverage: f32, rims: vec2f, tooth: vec2f, at: vec2f, press: f32, wrap: vec2f) {
  let cover = clamp(coverage + max(rims.x, rims.y), 0.0, 1.0);
  if (cover <= 0.0) { return; }
  var was: array<vec4f, LAYERS>;
  var held = 0.0;
  for (var l = 0u; l < LAYERS; l++) {
    was[l] = textureLoad(layer, pixel, l);
    if (!isKnockoutLayer(l)) { held += dot(was[l], pigmentMask(l)); }
  }
  let incoming = incomingAt${s}(tooth, at, press, heldAround${s}(pixel) / ${f32(holds * body)} * ${f32(fill)}, wrap);
  var added = 0.0;
  for (var l = 0u; l < LAYERS; l++) { if (!isKnockoutLayer(l)) { added += cover * dot(incoming[l], pigmentMask(l)); } }
  // What's there gives way only as far as the stroke's own wax overfills the tooth.
  let keep = select(1.0, clamp((${f32(holds * body)} - added) / max(held, 1e-6), 0.0, 1.0), held + added > ${f32(holds * body)});
  let under = was[0].x;
  for (var l = 0u; l < LAYERS; l++) {
    if (isKnockoutLayer(l)) { continue; }
    // The open share isn't wax: a dry stroke sets it, as any paint laid over it does.
    var now = mix(was[l] * (1.0 - cover), was[l] * keep + cover * incoming[l], pigmentMask(l));
    if (l == 0u) { now.x = cover + under * (1.0 - cover); }
    textureStore(layer, pixel, l, now);
  }
}`;

/** `medium`'s lay, suffixed `s`: its layering's layDeposit. */
export const stampPigmentLayWgsl = (medium: PaintMedium, s: string) =>
  (medium.layering.kind === 'stacks' ? stackedLay(medium.layering, medium.body, s) : mixedLay(medium, s));

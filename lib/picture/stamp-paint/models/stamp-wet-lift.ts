// stamp-wet-lift.ts: how a lift takes paint up, per pixel: its share of the loose paint, never a pigment's stain.
// Paint runs back in round it by the flow stage (studio/stamp-wet-flow.ts). WGSL only: the renderer runs it.
//
// Negative space: a stain isn't stored. Each lift holds back its staining share of the paint it finds, so repeated
// lifts erode a stain about 1–2% a lift. Holding it exactly needs a stored stain per pigment, doubling the layer.

/**
 * How deep, in unit films, the fibres take a stain: a pigment stains its `staining` share of its first this-many
 * films, so a thin tint keeps its hue when lifted while thick gouache's stain is no deeper than a full wash's.
 */
export const STAMP_LIFT_STAIN_FIBRES = 0.6;

/**
 * Of that stain, the share already held while the paint is wet: a staining pigment's finest particles dye the fibres
 * as they land, the rest as the paint sets. So wet phthalo lifts to a pale tint, and dry phthalo hardly at all.
 */
export const STAMP_LIFT_WET_STAIN_HOLD = 0.4;

/** The lift's laws, each as its comment says. `open` is the pixel's open share, how much of its paint hasn't set. */
export const STAMP_WET_LIFT_WGSL = /* wgsl */ `
// How free the paint is, as fresh paint is: what of it never set, as workable as it is.
fn liftFree(workable: f32, open: f32) -> f32 { return clamp(workable, 0.0, 1.0) * clamp(open, 0.0, 1.0); }
// How much of the paint a lift can work up: all that's free, and of the rest what the medium's rewetting loosens.
fn liftLoose(free: f32, rewetting: f32) -> f32 { return mix(clamp(rewetting, 0.0, 1.0), 1.0, free); }
// Four pigment amounts after a lift at \`cover\` and \`strength\`: paint that never set is as loose as it's
// \`workable\`, set paint only by the medium's \`rewetting\`, however wet again; each keeps its \`stain\` share.
fn wetLift(was: vec4f, cover: f32, strength: f32, workable: f32, open: f32, rewetting: f32, stain: vec4f) -> vec4f {
  let free = liftFree(workable, open);
  let loose = liftLoose(free, rewetting);
  let hold = mix(1.0, ${STAMP_LIFT_WET_STAIN_HOLD.toFixed(3)}, free);
  let held = clamp(stain, vec4f(0.0), vec4f(1.0)) * min(was, vec4f(${STAMP_LIFT_STAIN_FIBRES.toFixed(3)})) * hold;
  let take = clamp(cover * strength, 0.0, 1.0) * loose;
  return was - take * (was - held);
}
// The open share after a lift took a pixel's paint from \`had\` to \`has\` in all: what it took came from its open and
// set paint as loose as each was, the open as workable, the set by rewetting.
fn liftOpen(open: f32, workable: f32, rewetting: f32, had: f32, has: f32) -> f32 {
  let o = clamp(open, 0.0, 1.0);
  let fromOpen = o * mix(clamp(rewetting, 0.0, 1.0), 1.0, clamp(workable, 0.0, 1.0));
  let loose = fromOpen + (1.0 - o) * clamp(rewetting, 0.0, 1.0);
  let taken = select(0.0, (had - has) * fromOpen / loose, loose > 0.0);
  return select(o, clamp((o * had - taken) / has, 0.0, 1.0), has > 0.0);
}`;

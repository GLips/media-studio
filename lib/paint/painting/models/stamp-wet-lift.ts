// stamp-wet-lift.ts: how a lift takes paint up, per pixel: its share of the loose paint, never the medium's residue
// (PaintLiftResidue). Paint runs back in round it by the flow stage (studio/stamp-wet-flow.ts). The renderer runs the
// WGSL laws; the helpers write each medium's residue and each pigment's share of it as the laws read them. A stain
// is films deep, so thick gouache stains no deeper than a wash; wax a share of its coat, so a light touch erases clean.
//
// Negative space: a stain isn't stored. Each lift holds back its staining share of the paint it finds, so repeated
// lifts erode a stain about 1–2% a lift. Holding it exactly needs a stored stain per pigment, doubling the layer.

import type { PaintLiftResidue } from '#lib/paint/materials/models/paint-medium.ts';

/**
 * Of a stain, the share already held while the paint is wet: a staining pigment's finest particles dye the fibres as
 * they land, the rest as the paint sets. So wet phthalo lifts to a pale tint, and dry phthalo hardly at all.
 */
const STAMP_LIFT_WET_STAIN_HOLD = 0.4;

const wgslFloat = (value: number) => value.toPrecision(9);

/** `residue` as the WGSL laws read it, a LiftResidue: its depth in films, its share of the coat, its hold while wet. */
export function stampLiftResidueWgsl(residue: PaintLiftResidue): string {
  switch (residue.kind) {
    case 'staining': return `LiftResidue(${wgslFloat(residue.films)}, 0.0, LIFT_WET_STAIN_HOLD)`;
    case 'pressed': return `LiftResidue(0.0, ${wgslFloat(residue.share)}, 1.0)`;
    default: return residue satisfies never;
  }
}

/** A pigment of `staining`'s share of `residue`: a stain holds as much of it as the pigment stains; wax holds alike. */
export function stampLiftPigmentResidueShare(residue: PaintLiftResidue, staining: number): number {
  switch (residue.kind) {
    case 'staining': return staining;
    case 'pressed': return 1;
    default: return residue satisfies never;
  }
}

/**
 * How much of a pigment's residue behind a knockout survives its knockout layer, as weights on the layer's lanes (a
 * thin stain of staining 0, ½ and 1 left) and a part kept whatever: a stain's read off the parabola through the three,
 * wax all.
 */
export function stampLiftKnockoutKeep(residue: PaintLiftResidue, staining: number): readonly [number, number, number, number] {
  switch (residue.kind) {
    case 'staining': {
      const s = staining;
      return [(2 * s - 1) * (s - 1), 4 * s * (1 - s), s * (2 * s - 1), 0];
    }
    case 'pressed': return [0, 0, 0, 1];
    default: return residue satisfies never;
  }
}

/** The lift's laws, each as its comment says. `open` is the pixel's open share, how much of its paint hasn't set. */
export const STAMP_WET_LIFT_WGSL = /* wgsl */ `
const LIFT_WET_STAIN_HOLD = ${wgslFloat(STAMP_LIFT_WET_STAIN_HOLD)};
// What a lift leaves of a medium's paint however strong (stampLiftResidueWgsl): \`films\` deep of a stain, \`share\`
// of a coat of pressed wax, \`wetHold\` of it held while the paint is wet. Each medium sets one of the two.
struct LiftResidue { films: f32, share: f32, wetHold: f32 }
// How free the paint is, as fresh paint is: what of it never set, as workable as it is.
fn liftFree(workable: f32, open: f32) -> f32 { return clamp(workable, 0.0, 1.0) * clamp(open, 0.0, 1.0); }
// How much of the paint a lift can work up: all that's free, and of the rest what the medium's rewetting loosens.
fn liftLoose(free: f32, rewetting: f32) -> f32 { return mix(clamp(rewetting, 0.0, 1.0), 1.0, free); }
// The share of a pixel's paint a lift leaves behind, where it holds \`paint\` in all: a stain's films whole, thinner
// paint all stain; wax its share of the coat.
fn liftResidueShare(paint: f32, residue: LiftResidue) -> f32 {
  return residue.share + select(0.0, residue.films / max(paint, residue.films), residue.films > 0.0);
}
// Four pigment amounts after a lift at \`cover\` and \`strength\`: paint that never set is as loose as it's
// \`workable\`, set paint only by the medium's \`rewetting\`, however wet again; each keeps its \`share\` (a pigment's
// of its medium's residue) of the \`residue\` of a pixel holding \`paint\` in all.
fn wetLift(was: vec4f, paint: f32, cover: f32, strength: f32, workable: f32, open: f32, rewetting: f32, share: vec4f, residue: LiftResidue) -> vec4f {
  let free = liftFree(workable, open);
  let loose = liftLoose(free, rewetting);
  let hold = mix(1.0, residue.wetHold, free);
  let held = clamp(share, vec4f(0.0), vec4f(1.0)) * was * liftResidueShare(paint, residue) * hold;
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

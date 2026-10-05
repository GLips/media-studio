// painting-reveal-profile.ts: a reveal as a document says it, and as the engine reads it. A field reveal's `profile`
// is a curve, named as place keys name theirs, saying how its front runs between its base's two values in time; the
// engine reads it sampled (StampRevealProfile), so the GPU and its twin read one table whatever the curve. The curve
// comes through the one import below.

import { paintEased as revealCurveAt, type PaintEase as RevealCurve } from '#lib/paint/animation/models/paint-motion-clips.ts';
import { stampPaintFieldEnds, type StampSeededPaintField } from '#lib/paint/painting/models/stamp-paint-field.ts';
import { STAMP_REVEAL_PROFILE_SAMPLES, type StampReveal, type StampRevealProfile, type StampRevealStroke } from '#lib/paint/painting/models/stamp-reveal.ts';

/**
 * How a field reveal's front runs between its base's two values, from the earlier to the later: `'out'` leaves fast
 * and slows into its last texels, `'in'` leaves from rest, `'inOut'` both; `'linear'` (left out) keeps the base's own
 * pace. At a share of its time, the front has come the curve's share of its way.
 */
export type RevealProfile = RevealCurve;

/** A reveal as a document says it (painting-document.ts' Reveal): the engine's, a field's profile a curve. */
export type PaintingReveal =
  | { readonly kind: 'strokes'; readonly strokes: readonly StampRevealStroke[]; readonly softS?: number }
  | {
    readonly kind: 'field'; readonly base: StampSeededPaintField<number>; readonly delay?: StampSeededPaintField<number>; readonly profile?: RevealProfile;
    readonly softS?: number;
  };

/** Steps a curve is read at to find when its front first reaches each sample: fine enough to follow a ring. */
const CURVE_STEPS = 1024;

/**
 * `profile` sampled as the engine reads it, for a base whose first value comes first in time (`forward`) or last. A
 * curve overshooting reaches a texel the first time its front does, so the front never takes paint back.
 */
function paintingRevealProfileSamples(profile: RevealProfile, forward: boolean): StampRevealProfile {
  const curve = Array.from({ length: CURVE_STEPS + 1 }, (_, k) => revealCurveAt(profile, k / CURVE_STEPS));
  // The share of its time at which the front first comes `way` of its way.
  const reached = (way: number) => {
    const k = curve.findIndex((share) => share >= way);
    if (k <= 0) return k === 0 ? 0 : 1;
    return (k - 1 + (way - curve[k - 1]) / (curve[k] - curve[k - 1])) / CURVE_STEPS;
  };
  const last = STAMP_REVEAL_PROFILE_SAMPLES - 1;
  return Array.from({ length: STAMP_REVEAL_PROFILE_SAMPLES }, (_, i) => (forward ? reached(i / last) : 1 - reached(1 - i / last)));
}

const stampReveals = new WeakMap<PaintingReveal, StampReveal>();

/**
 * `reveal` as the engine reads it, a field's profile sampled in the order its base's values run. Made once a reveal,
 * so the engine's key for it is too. Everything reading a document's reveal reads it through here.
 */
export function paintingStampReveal(reveal: PaintingReveal): StampReveal {
  if (reveal.kind === 'strokes') return reveal;
  const known = stampReveals.get(reveal);
  if (known) return known;
  const { profile, ...field } = reveal, { first, second } = stampPaintFieldEnds(reveal.base);
  const made: StampReveal = profile === undefined ? field : { ...field, profile: paintingRevealProfileSamples(profile, first <= second) };
  stampReveals.set(reveal, made);
  return made;
}

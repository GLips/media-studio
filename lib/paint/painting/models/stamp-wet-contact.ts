// stamp-wet-contact.ts: how fully a deposit's tool touched the paper, 0..1, where its water lands. The renderer lays
// each main stamp's touch pixel by pixel (its touch target, joined by their most), and the wet field takes water by
// it (studio/stamp-wet-field.ts).
//
// Negative space: opacity, flow, grain, tooth, the dual and colour aren't touch.
//
// An approximation read from imported tips, not measured water: a pack's tip is what it paints.

import type { StampTipLevels } from '#lib/paint/brush/models/stamp-tip-levels.ts';
import { rememberedOnce } from './stamp-remembered.ts';

/**
 * How fully a stamp touched where its tip lays `paint`, pressed to `pressed` of it (stampTipPressedShare, 1 for a tip
 * not pressed): over the paint it touches fully from (stampTipFullContact), at most 1. Its GPU twin is
 * STAMP_TIP_TOUCH_WGSL, which the renderer's touch runs per pixel; the gate holds them together.
 */
export const stampTipTouch = (paint: number, pressed: number, full: number) => Math.min(1, Math.max(0, (paint * pressed) / Math.max(full, 1e-4)));
export const STAMP_TIP_TOUCH_WGSL = /* wgsl */ `fn tipTouch(paint: f32, pressed: f32, full: f32) -> f32 { return clamp(paint * pressed / max(full, 1e-4), 0.0, 1.0); }`;

/**
 * The share of a pressed tip's paint that lands where its contact image reads `contact`, at `pressure`: pressedTip's
 * (coverage-formulas.ts) for a tip of paint 1, which the gate holds it to.
 */
export const stampTipPressedShare = (contact: number, pressure: number, softness: number, lo: number, hi: number, grow: number) =>
  Math.min(1, Math.max(0, 0.5 + (pressure - (hi - contact * (hi - lo)) * grow) / softness));

/**
 * The share of a tip's strongest paint from which it touched fully, as a brush's visible offset is where its paint is
 * half the strongest. A blotchy tip's paler middle is paint thinner there, not paper it missed.
 */
const STAMP_TIP_FULL_CONTACT_SHARE = 0.5;

const fulls = new WeakMap<StampTipLevels, number>();
/**
 * The coverage from which `levels`' tip touched fully, which touch is normalized by: STAMP_TIP_FULL_CONTACT_SHARE of
 * its darkest texel's; none for a bare tip. Made once a tip.
 */
export const stampTipFullContact = (levels: StampTipLevels): number => rememberedOnce(fulls, levels, () => {
  let darkest = 255;
  for (const texel of levels[0].texels) darkest = Math.min(darkest, texel);
  return STAMP_TIP_FULL_CONTACT_SHARE * (1 - darkest / 255);
});

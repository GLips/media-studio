// shot-instance-passes.ts: an instanced plane's items laid through the lens (ENGINE 6.3). Each variant is solved and
// laid as a painted plane is (shot-painted-plane.ts), its picture kept under its plan's key, so a variant whose films
// and visibility hold is laid once for the shot. A batch of items (shotDrawSteps) lays that picture, blurred once for
// the batch's stepped sigma, through each item's own look: one picture and one bind group, an item at a time.

import { PAINT_SIMILARITY_IDENTITY } from '#lib/paint/animation/models/paint-similarity.ts';
import type { LensCompositor, LensItemsLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import type { ShotDrawStep, ShotItemLook } from '../models/shot-instances.ts';
import type { PlaneInstance } from '../models/shot-props.ts';
import type { createShotPaintedPlanes, ShotPlaneMoment } from './shot-painted-plane.ts';

/** A batch of one variant's items, as shotDrawSteps groups them. */
export type ShotItemsStep = Extract<ShotDrawStep, { readonly kind: 'items' }>;

/**
 * `step`'s items as the lens lays them: `variant` (its variant at the exposure's moment) laid by `planes` into its
 * picture, defocused by the step's sigma (picture px, so its look is the picture's own), and each item shown through
 * its look (`lookOf`). Null where nothing shows: every item faded out, or the plane itself.
 */
export function shotItemsLayer(
  encoder: GPUCommandEncoder, lens: LensCompositor, planes: Pick<ReturnType<typeof createShotPaintedPlanes>, 'picture'>, variant: ShotPlaneMoment, step: ShotItemsStep,
  lookOf: (item: PlaneInstance) => ShotItemLook,
): LensItemsLayer | null {
  const shown = step.items.map(lookOf).filter(({ visibility }) => visibility > 0);
  if (!shown.length) return null;
  const laid = planes.picture(encoder, lens, variant, { view: PAINT_SIMILARITY_IDENTITY, defocus: step.sigma, distance: 1, shutter: null });
  if (!laid) return null;
  return { picture: laid.picture, layers: laid.layers, origin: laid.origin, size: laid.size, items: shown.map(({ view, shutter, distance, visibility }) => ({ view, shutter, distance, visibility })) };
}

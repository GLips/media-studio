// shot-instance-passes.ts: an instanced plane's items laid through the lens (ENGINE 6.3). Each variant is solved and
// laid as a painted plane is (shot-painted-plane.ts), its picture kept under its plan's key, so a variant whose films
// and visibility hold is laid once for the shot. A batch of items (shotDrawSteps) lays that picture, blurred once for
// the batch's stepped sigma, through each item's own look as the lens's items layer: one picture and one bind group,
// an item at a time.

import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampArrayView } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { LensCompositor, LensItemsLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import type { ShotItemLook, ShotItemsStep } from '../models/shot-instances.ts';
import type { PlaneInstance } from '../models/shot-props.ts';
import type { createShotPaintedPlanes, ShotPlaneMoment } from './shot-painted-plane.ts';

/**
 * `step`'s items as the lens lays them: `variant` (its variant at the exposure's moment) laid by `planes` into its
 * picture on `stage`, defocused by the step's sigma (picture px), and each item shown through its look (`lookOf`).
 * Null where nothing shows: every item faded out, or the plane itself.
 */
export function shotItemsLayer(
  encoder: GPUCommandEncoder, lens: LensCompositor, planes: Pick<ReturnType<typeof createShotPaintedPlanes>, 'pictureDefocused'>, stage: StampStage,
  variant: ShotPlaneMoment, step: ShotItemsStep, lookOf: (item: PlaneInstance) => ShotItemLook,
): LensItemsLayer | null {
  const shown = step.items.map(lookOf).filter(({ visibility }) => visibility > 0);
  if (!shown.length) return null;
  const picture = planes.pictureDefocused(encoder, lens, variant, step.sigma);
  if (!picture) return null;
  return {
    picture: stampArrayView(picture.texture), layers: picture, origin: { x: picture.box.x - stage.margin, y: picture.box.y - stage.margin }, size: picture.box,
    items: shown.map(({ view, shutter, distance, visibility }) => ({ view, shutter, distance, visibility })),
  };
}

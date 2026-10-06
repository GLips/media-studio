// shot-instance-passes.ts: an instanced plane's items laid through the lens (ENGINE 6.3). Each variant is solved and
// laid as a painted plane is (shot-painted-plane.ts), its picture kept under its plan's key, so a variant whose films
// and visibility hold is laid once for the shot. A batch of items (shotDrawSteps) lays that picture, blurred once for
// the batch's stepped sigma, through each item's own look as the lens's items layer: one picture and one bind group,
// an item at a time. An alphaOf mask reads the items' coverage, drawn still and sharp (shotItemsCoverages).

import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { stampArrayView } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { LensCompositor, LensItemsLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import type { CompiledShotPaintedPlane } from '../models/shot-compile.ts';
import type { CompiledShotInstancedPlane, CompiledShotVariant, ShotExposureItems, ShotItemLook, ShotItemsStep } from '../models/shot-instances.ts';
import type { PlaneInstance } from '../models/shot-props.ts';
import type { createShotPaintedPlanes, ShotPlaneMoment } from './shot-painted-plane.ts';

type ShotVariantPictures = Pick<ReturnType<typeof createShotPaintedPlanes>, 'pictureDefocused'>;

/**
 * `step`'s items as the lens lays them: `variant` (its variant at the exposure's moment) laid by `planes` into its
 * picture on `stage`, defocused by the step's sigma (picture px), and each item shown through its look (`lookOf`).
 * Null where nothing shows: every item faded out, or the plane itself.
 */
export function shotItemsLayer(
  encoder: GPUCommandEncoder, lens: LensCompositor, planes: ShotVariantPictures, stage: StampStage,
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

/**
 * An instanced plane at one exposure as an alphaOf mask reads it: `key` naming what draws its coverage (its variants'
 * pictures, each shown item's variant, view and visibility); `read` drawing it when first asked, its alpha the
 * coverage, null where no item shows; its first texel at frame px `at`.
 */
export type ShotItemsCoverage = { readonly key: string; readonly at: { readonly x: number; readonly y: number }; readonly read: () => GPUTexture | null };

/** What an exposure's items are drawn with for a mask: `owner`'s targets, a lens a canvas, the variants' pictures, the stage. */
export type ShotItemsCoverageSetting = { readonly owner: StampPaintGpuOwner; readonly lenses: readonly LensCompositor[]; readonly planes: ShotVariantPictures; readonly stage: StampStage };

/**
 * Each instanced plane's coverage at one exposure (`variantMoments`, `items`), made once a plane however many masks
 * read it: its items drawn still and sharp through their canvas's lens, each by its visibility, into a stage-sized
 * target. A reader's defocus or shutter reads past the frame's edge, and finds the items lying there. A `hidden`
 * variant covers nothing.
 */
export function shotItemsCoverages(
  encoder: GPUCommandEncoder, { owner, lenses, planes, stage }: ShotItemsCoverageSetting, variantMoments: ReadonlyMap<CompiledShotVariant, ShotPlaneMoment>,
  hidden: ReadonlySet<CompiledShotPaintedPlane>, items: ShotExposureItems,
): (plane: CompiledShotInstancedPlane) => ShotItemsCoverage {
  const { margin } = stage, made = new Map<CompiledShotInstancedPlane, ShotItemsCoverage>();
  const momentOf = (variant: CompiledShotVariant) => (hidden.has(variant.painted) ? null : variantMoments.get(variant)!);
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
  const size = { w: stage.frame.width + 2 * margin, h: stage.frame.height + 2 * margin }, at = { x: -margin, y: -margin };
  const coverage = (plane: CompiledShotInstancedPlane): ShotItemsCoverage => {
    const lookOf = (item: PlaneInstance) => items.lookOf(plane.id, item), shown = (items.items.get(plane.id) ?? []).filter((item) => lookOf(item).visibility > 0);
    const key = JSON.stringify([
      [...plane.variants.values()].map((variant) => momentOf(variant)?.shares.map(({ plan }) => plan.key) ?? null),
      shown.map((item) => {
        const { view, visibility } = lookOf(item);
        return [item.variant, view.ma, view.mb, view.kx, view.ky, visibility];
      }),
    ]);
    let drawn: GPUTexture | undefined;
    const draw = () => {
      const lens = lenses[plane.canvas], texture = owner.target(`shot items coverage ${plane.id}`, { size: [size.w, size.h], format: 'rgba16float', usage }, encoder);
      // Alpha laid over alpha is the same in any order, so a variant's items can go together.
      const layers = [...plane.variants.values()].flatMap((variant) => {
        const step = { kind: 'items', plane: plane.id, variant: variant.name, sigma: 0, items: shown.filter((item) => item.variant === variant.name) } as const;
        const moment = momentOf(variant), laid = step.items.length && moment ? shotItemsLayer(encoder, lens, planes, stage, moment, step, lookOf) : null;
        return laid ? [laid] : [];
      });
      lens.cover(encoder, layers, { view: texture.createView(), size, at });
      return texture;
    };
    return { key, at, read: () => (shown.length ? (drawn ??= draw()) : null) };
  };
  return (plane) => {
    if (!made.has(plane)) made.set(plane, coverage(plane));
    return made.get(plane)!;
  };
}

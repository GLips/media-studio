// stamp-plane-glow-pass.ts: a plane's emission as its groups glow (stamp-paint-plane-passes.ts' glow passes), measured
// one way per renderer until the old path goes (ENGINE "Built beside"). A shot's group glows with the light its lay
// adds over what its plane holds under it: a faint veil faintly, a halo over a lamp's glass with none of the glass's
// light, warm paint over a dark road in its own warmth. StampPainting's glows with its laid paint's light, as much as
// the group covers, dimmed by each later opaque group on the plane.
//
// Negative space: in a shot, a glaze takes light, so it gives off only what it scatters, and a reserve adds none.

import { gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampGroupGlow } from '../models/stamp-paint-frame-state.ts';
import type { StampStage } from '../models/stamp-stage.ts';
import type { StampPaintCompositor } from './stamp-paint-compositor.ts';
import { dispatchStampCompute, STAMP_WORKGROUP } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import { STAMP_NO_REST, type StampPaintBacking } from './stamp-paint-lay-pass.ts';
import {
  STAMP_GLOW_ADDED, STAMP_GLOW_LAID, STAMP_GLOW_OCCLUSION, stampGlowAddedWgsl, stampGlowLaidWgsl, stampGlowOcclusionWgsl,
} from './stamp-paint-plane-passes.ts';
import { measureStampPlaneLight } from './stamp-plane-picture-pass.ts';
import type { StampUniformArena } from './stamp-uniform-arena.ts';

/** A glowing group laid by `compositor` onto `painting` over `box` (stage texels), its `glow` going into its plane's `emission`. */
export type StampGlowingLay = {
  readonly compositor: StampPaintCompositor;
  readonly painting: GPUTextureView;
  readonly box: StampPixelBox;
  readonly emission: GPUTextureView;
  readonly glow: StampGroupGlow;
};

/** A laid group's cover, read from its layer and, for a moved group, its lattice's rest map. */
export type StampGlowCover = { readonly layer: GPUTextureView; readonly rest: GPUTextureView | null };

/**
 * Whether a shot's plane glows on its lay on `backing`: on its paper (the back) or black (a clear plane), where what
 * lies under its paint is what the plane holds. On white, light paint over nothing would add nothing, and paint there
 * takes white's light away.
 */
export const stampPlaneGlowsOn = (backing: StampPaintBacking) => backing !== 'white';

const coverOf = ({ rest }: StampGlowCover) => (rest ? 'moved group' : 'group');

/** Glows on `owner`'s device over `stage`, each pass's uniform from `arena`. */
export function createStampPlaneGlows(owner: StampPaintGpuOwner, { stage, arena }: { readonly stage: StampStage; readonly arena: StampUniformArena }) {
  const { device } = owner;
  // The owner's device keeps modules by code and pipelines by descriptor.
  const pipelineOf = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });
  // One for `encoder`'s frame: a group's kept light is read by its glow pass before the next glowing group's is kept,
  // as each submit runs its passes in the order they were encoded.
  const kept = (encoder: GPUCommandEncoder) =>
    owner.target('glow before', { size: [stage.width, stage.height], format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }, encoder);
  return {
    /**
     * A shot's glow: encodes `lay`, which lays a group as `glowing` says, adding to its emission the light the lay adds
     * over its box, per channel, past the glow's threshold, times its amount. Null: `lay` alone.
     */
    layAdding(encoder: GPUCommandEncoder, glowing: StampGlowingLay | null, lay: () => void) {
      if (!glowing) return lay();
      const { compositor, painting, box, emission, glow } = glowing, before = kept(encoder);
      measureStampPlaneLight(owner, arena, encoder, { compositor, painting, box, into: before, layer: 0 });
      lay();
      dispatchStampCompute(device, encoder, pipelineOf(stampGlowAddedWgsl(compositor, STAMP_WORKGROUP)), [arena.slot((views) => {
        const put = gpuUniformWriter(STAMP_GLOW_ADDED, views);
        put('threshold', glow.threshold);
        put('amount', glow.amount);
        put('origin', [box.x, box.y]);
        put('extent', [box.w, box.h]);
      }), painting, emission, before.createView()], box.w, box.h);
    },
    /**
     * StampPainting's glow, once its group is laid as `glowing` says: adds to its emission the painting's light over its
     * box past the glow's threshold, times the group's cover there (`glaze`: as a glaze composites it), `shown` (its
     * opacity and visibility) and the glow's amount.
     */
    addLaid(encoder: GPUCommandEncoder, glowing: StampGlowingLay, cover: StampGlowCover & { readonly glaze: boolean }, shown: number) {
      const { compositor, painting, box, emission, glow } = glowing;
      dispatchStampCompute(device, encoder, pipelineOf(stampGlowLaidWgsl(compositor, coverOf(cover), stage, STAMP_NO_REST, STAMP_WORKGROUP)), [arena.slot((views) => {
        const put = gpuUniformWriter(STAMP_GLOW_LAID, views);
        put('threshold', glow.threshold);
        put('strength', glow.amount * shown);
        put('glaze', cover.glaze ? 1 : 0);
        put('origin', [box.x, box.y]);
        put('extent', [box.w, box.h]);
      }), painting, emission, cover.layer, cover.rest], box.w, box.h);
    },
    /**
     * StampPainting's occlusion: dims `emission` over `box` by an opaque group's `cover` there times `shown` (its
     * opacity and visibility), as its paint covers the light laid before it.
     */
    occlude(encoder: GPUCommandEncoder, { compositor, emission, box }: Pick<StampGlowingLay, 'compositor' | 'emission' | 'box'>, cover: StampGlowCover, shown: number) {
      dispatchStampCompute(device, encoder, pipelineOf(stampGlowOcclusionWgsl(compositor, coverOf(cover), stage, STAMP_NO_REST, STAMP_WORKGROUP)), [arena.slot((views) => {
        const put = gpuUniformWriter(STAMP_GLOW_OCCLUSION, views);
        put('strength', shown);
        put('origin', [box.x, box.y]);
        put('extent', [box.w, box.h]);
      }), null, emission, cover.layer, cover.rest], box.w, box.h);
    },
  };
}

export type StampPlaneGlows = ReturnType<typeof createStampPlaneGlows>;

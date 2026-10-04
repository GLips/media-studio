// stamp-plane-glow-pass.ts: a plane's emission as its groups glow (stamp-paint-plane-passes.ts' glow passes). A group
// glows with the light it adds over the paint under it: the painting's light over its box is kept before it's laid,
// and what the lay added, per channel, past the glow's threshold goes into the emission. A faint veil adds faint
// light; a halo over a lamp's glass adds none of the glass's; warm paint over a dark road adds its warmth. The old
// renderer and a shot's painted planes both glow here.
//
// Negative space: a glaze takes light, so it gives off only what it scatters, and a reserve adds none.

import { gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampGroupGlow } from '../models/stamp-paint-frame-state.ts';
import type { StampStage } from '../models/stamp-stage.ts';
import type { StampPaintCompositor } from './stamp-paint-compositor.ts';
import { dispatchStampCompute, STAMP_WORKGROUP } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import { STAMP_NO_REST } from './stamp-paint-lay-pass.ts';
import {
  STAMP_GLOW_BEFORE, STAMP_GLOW_OCCLUSION, STAMP_GLOW_SOURCE, stampGlowBeforeWgsl, stampGlowOcclusionWgsl, stampGlowSourceWgsl,
} from './stamp-paint-plane-passes.ts';
import type { StampUniformArena } from './stamp-uniform-arena.ts';

/** An opaque group laid over a plane's emission: its layer and, for a moved group, its lattice's rest map. */
export type StampGlowCover = { readonly layer: GPUTextureView; readonly rest: GPUTextureView | null };

/** Glows on `owner`'s device over `stage`, each pass's uniform from `arena`. */
export function createStampPlaneGlows(owner: StampPaintGpuOwner, { stage, arena }: { readonly stage: StampStage; readonly arena: StampUniformArena }) {
  const { device } = owner;
  // The owner's device keeps modules by code and pipelines by descriptor.
  const pipelineOf = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });
  // One a device: a group's kept light is read by its source pass before the next glowing group's is kept, as each
  // submit runs its passes in the order they were encoded.
  const kept = () => owner.target('glow before', { size: [stage.width, stage.height], format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }).createView();

  return {
    /** Keeps `painting`'s light over `box` (stage texels), laid by `compositor`: just before a glowing group is laid there. */
    before(encoder: GPUCommandEncoder, compositor: StampPaintCompositor, painting: GPUTextureView, box: StampPixelBox) {
      const pipeline = pipelineOf(stampGlowBeforeWgsl(compositor, STAMP_WORKGROUP));
      dispatchStampCompute(device, encoder, pipeline, [arena.slot((views) => {
        const put = gpuUniformWriter(STAMP_GLOW_BEFORE, views);
        put('origin', [box.x, box.y]);
        put('extent', [box.w, box.h]);
      }), painting, kept()], box.w, box.h);
    },
    /** Adds to `emission` the light the group laid over `box` since `before` kept it, past `glow`'s threshold, times its amount. */
    add(encoder: GPUCommandEncoder, compositor: StampPaintCompositor, painting: GPUTextureView, emission: GPUTextureView, box: StampPixelBox, glow: StampGroupGlow) {
      const pipeline = pipelineOf(stampGlowSourceWgsl(compositor, STAMP_WORKGROUP));
      dispatchStampCompute(device, encoder, pipeline, [arena.slot((views) => {
        const put = gpuUniformWriter(STAMP_GLOW_SOURCE, views);
        put('threshold', glow.threshold);
        put('amount', glow.amount);
        put('origin', [box.x, box.y]);
        put('extent', [box.w, box.h]);
      }), painting, emission, kept()], box.w, box.h);
    },
    /**
     * Dims `emission` over `box` by an opaque group's cover there (`cover`) times `strength` (its opacity and
     * visibility), as its paint covers the light laid before it.
     */
    occlude(encoder: GPUCommandEncoder, compositor: StampPaintCompositor, emission: GPUTextureView, cover: StampGlowCover, box: StampPixelBox, strength: number) {
      const pipeline = pipelineOf(stampGlowOcclusionWgsl(compositor, cover.rest ? 'moved group' : 'group', stage, STAMP_NO_REST, STAMP_WORKGROUP));
      dispatchStampCompute(device, encoder, pipeline, [arena.slot((views) => {
        const put = gpuUniformWriter(STAMP_GLOW_OCCLUSION, views);
        put('strength', strength);
        put('origin', [box.x, box.y]);
        put('extent', [box.w, box.h]);
      }), null, emission, cover.layer, cover.rest], box.w, box.h);
    },
  };
}

export type StampPlaneGlows = ReturnType<typeof createStampPlaneGlows>;

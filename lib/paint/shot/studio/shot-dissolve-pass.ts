// shot-dissolve-pass.ts: a dissolving plane's picture (ENGINE 6.3, "Dissolve"). Each selection its source blends is laid
// into a picture of its own, kept under its plan's key; this sums them by weight into one picture over the stage, in
// the form the plane holds them: the back's opaque colour, or a nearer plane's colour C and taken share 1 − T, with its
// emission and motion. A dissolve is linear in each, so the weighted sum is its nested blends, and the lens's
// C + T × behind crossfades exactly over anything behind. It mixes pictures, never pigment.
//
// The sum isn't kept: a `k` read each frame would fill the cache with pictures drawn once. Its shares are.

import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { dispatchStampCompute, STAMP_WORKGROUP, stampArrayView } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { stampPlanePictureLayerCount, type StampPlanePictureLayers } from '#lib/paint/painting/studio/stamp-paint-plane-passes.ts';
import type { StampPlanePicture } from '#lib/paint/painting/studio/stamp-plane-picture-pass.ts';
import type { StampUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';

const SHOT_DISSOLVE = gpuUniformLayout('Dissolve', [['origin', 'vec2u'], ['extent', 'vec2u'], ['at', 'vec2u'], ['size', 'vec2u'], ['weight', 'f32']]);

/** One picture a dissolve sums, and its weight. */
export type ShotDissolveShare = { readonly picture: StampPlanePicture; readonly weight: number };

/**
 * Each layer of the sum, shaped `into`, and the share's layer added into it: null where the share has none, adding
 * nothing. The coverage alphaOf masks read is summed with the colour, so a dissolving plane covers as it shows.
 */
function dissolveLayerPairs(share: StampPlanePictureLayers, into: StampPlanePictureLayers): { readonly into: number; readonly from: number | null }[] {
  const roles = (['taken', 'emission', 'motion'] as const).flatMap((role) => {
    const at = into[role];
    return at === null ? [] : [{ into: at, from: share[role] }];
  });
  const summed = into.coverage, shared = share.coverage;
  const coverage = summed ? Array.from({ length: summed.layers }, (_, l) => ({ into: summed.layer + l, from: shared ? shared.layer + l : null })) : [];
  return [{ into: 0, from: 0 }, ...roles, ...coverage];
}

/**
 * The sum's WGSL, adding a share shaped `share` by its weight into the sum, shaped `into`, over the uniform's extent:
 * the first share starts the sum (from nothing outside its box), a later one adds to it inside its box.
 */
function dissolveWgsl(share: StampPlanePictureLayers, into: StampPlanePictureLayers, first: boolean) {
  const added = dissolveLayerPairs(share, into).map(({ into: layer, from }) => {
    const term = from === null ? 'vec4f(0.0)' : `select(vec4f(0.0), textureLoad(share, texel, ${from}u, 0), inside)`;
    return `textureStore(sum, pixel, ${layer}u, ${first ? '' : `textureLoad(sum, pixel, ${layer}u) + `}u.weight * ${term});`;
  });
  return /* wgsl */ `
${SHOT_DISSOLVE.wgsl}
@group(0) @binding(0) var<uniform> u: Dissolve;
@group(0) @binding(1) var share: texture_2d_array<f32>;
@group(0) @binding(2) var sum: texture_storage_2d_array<rgba16float, read_write>;
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn dissolve(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let inside = all(pixel >= u.at) && all(pixel < u.at + u.size);
  let texel = vec2i(pixel) - vec2i(u.at);
  ${added.join('\n  ')}
}`;
}

/** Dissolves on `owner`'s device over `stage`, each pass's uniform from `arena`. */
export function createShotDissolve(owner: StampPaintGpuOwner, { stage, arena }: { readonly stage: StampStage; readonly arena: StampUniformArena }) {
  const { device } = owner, whole = { x: 0, y: 0, w: stage.width, h: stage.height };
  const pipelineOf = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });
  // A frame may sum a plane's picture more than once before it's submitted (variants share a plane, a batch of items
  // takes each stepped sigma), so each sum in one encoder takes a texture of its own; a later encoder reuses them.
  let encoderSumming: GPUCommandEncoder | null = null, summed = 0;
  return {
    /**
     * `shares` summed by weight into a dissolve picture shaped `layers` (each share's shape or more) over the whole
     * stage, read by `encoder`'s later passes: its texture the encoder's next, rewritten by a later encoder's sums.
     */
    sum(encoder: GPUCommandEncoder, layers: StampPlanePictureLayers, shares: readonly ShotDissolveShare[]): StampPlanePicture {
      if (encoder !== encoderSumming) [encoderSumming, summed] = [encoder, 0];
      const texture = owner.target(`shot dissolve ${summed++}`, {
        size: [stage.width, stage.height, stampPlanePictureLayerCount(layers)], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      }, encoder);
      const sum = stampArrayView(texture);
      shares.forEach(({ picture, weight }, index) => {
        const { box } = picture, over = index === 0 ? whole : box;
        dispatchStampCompute(device, encoder, pipelineOf(dissolveWgsl(picture, layers, index === 0)), [arena.slot((views) => {
          const put = gpuUniformWriter(SHOT_DISSOLVE, views);
          put('origin', [over.x, over.y]);
          put('extent', [over.w, over.h]);
          put('at', [box.x, box.y]);
          put('size', [box.w, box.h]);
          put('weight', weight);
        }), stampArrayView(picture.texture), sum], over.w, over.h);
      });
      return { ...layers, box: whole, texture };
    },
  };
}

export type ShotDissolve = ReturnType<typeof createShotDissolve>;

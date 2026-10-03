// shot-group-pass.ts: a faded group occurrence composited apart and mixed back (ENGINE 5.4, 6.1 step 6). Before the
// first step of its span the plane's painting, emission and motion are kept; after its last, each is mixed from what
// was kept toward what the span laid by the group's visibility, so all it holds fades as one, never layer by layer.
//
// The painting is the compositor's state, not light: mixing it is exact for a flat compositor and close for a pigment
// one, whose state is near linear over the small steps a fade takes between two pictures.

import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import type { StampPixelBox } from '#lib/paint/painting/models/stamp-blur-region.ts';
import { stampPaintTargetWgsl, type StampPaintTarget } from '#lib/paint/painting/studio/stamp-paint-compositor.ts';
import { dispatchStampCompute, STAMP_WORKGROUP } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import type { StampUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';

const SHOT_GROUP_FADE = gpuUniformLayout('GroupFade', [['visibility', 'f32'], ['origin', 'vec2u'], ['extent', 'vec2u']]);

const PLAIN: StampPaintTarget = { kind: 'plain' };

/** The mix's WGSL for a target shaped `shape`: what was kept (1) toward what's there now (2) by the visibility. */
function groupFadeWgsl(shape: StampPaintTarget) {
  const layers = shape.kind === 'array' ? shape.layers : 1;
  const load = (name: string) => (shape.kind === 'array' ? `textureLoad(${name}, pixel, l${name === 'kept' ? ', 0' : ''})` : `textureLoad(${name}, pixel${name === 'kept' ? ', 0' : ''})`);
  const store = shape.kind === 'array' ? 'textureStore(faded, pixel, l, mixed)' : 'textureStore(faded, pixel, mixed)';
  return /* wgsl */ `
${SHOT_GROUP_FADE.wgsl}
@group(0) @binding(0) var<uniform> u: GroupFade;
${stampPaintTargetWgsl('kept', 1, shape, null)}
${stampPaintTargetWgsl('faded', 2, shape, 'read_write')}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn groupFade(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  for (var l = 0u; l < ${layers}u; l++) {
    let mixed = mix(${load('kept')}, ${load('faded')}, u.visibility);
    ${store};
  }
}`;
}

/** A target faded: its texture, its shape and the view a pass writes it through. */
export type ShotFadedTarget = { readonly texture: GPUTexture; readonly shape: StampPaintTarget; readonly view: GPUTextureView };

/** What one fade kept of each target, to mix back into. */
export type ShotGroupKept = readonly { readonly target: ShotFadedTarget; readonly kept: GPUTextureView }[];

/**
 * Group fades on `owner`'s device, keeping what a span lays over in its targets, `depth` deep where spans nest; each
 * mix's uniform from `arena`.
 */
export function createShotGroupFade(owner: StampPaintGpuOwner, arena: StampUniformArena) {
  const { device } = owner;
  const pipelineOf = (shape: StampPaintTarget) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: groupFadeWgsl(shape) }) } });
  return {
    /** Keeps each of `targets` as it stands at this point in `encoder`, for a span `depth` spans deep. */
    keep(encoder: GPUCommandEncoder, targets: readonly ShotFadedTarget[], depth: number): ShotGroupKept {
      return targets.map((target, t) => {
        const { width, height, depthOrArrayLayers, format } = target.texture;
        const kept = owner.target(`shot fade ${depth}|${t}`, { size: [width, height, depthOrArrayLayers], format, usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
        encoder.copyTextureToTexture({ texture: target.texture }, { texture: kept }, [width, height, depthOrArrayLayers]);
        return { target, kept: kept.createView({ dimension: target.shape.kind === 'array' ? '2d-array' : '2d' }) };
      });
    },
    /** Mixes each target from what `kept` holds toward what it holds now by `visibility`, over `box` (stage texels). */
    mix(encoder: GPUCommandEncoder, kept: ShotGroupKept, visibility: number, box: StampPixelBox) {
      for (const { target, kept: was } of kept) {
        dispatchStampCompute(device, encoder, pipelineOf(target.shape), [
          arena.slot((views) => {
            const put = gpuUniformWriter(SHOT_GROUP_FADE, views);
            put('visibility', visibility);
            put('origin', [box.x, box.y]);
            put('extent', [box.w, box.h]);
          }),
          was, target.view,
        ], box.w, box.h);
      }
    },
  };
}

export type ShotGroupFade = ReturnType<typeof createShotGroupFade>;

/** A plain target (emission, motion) as a fade keeps it. */
export const shotPlainFaded = (texture: GPUTexture): ShotFadedTarget => ({ texture, shape: PLAIN, view: texture.createView() });

// stamp-span-fade-pass.ts: a span of steps faded apart (a group, or an own sheet's owner, below 1) composited apart
// and mixed back (ENGINE 5.4, 6.1 step 6). Before its first step its targets are kept (a shot's painting, emission and
// motion; a composite's painting); after its last, each is mixed from what was kept toward what the span laid by its
// visibility, so all it holds, an own sheet's card included, fades as one, never layer by layer.
//
// The painting is the compositor's state, not light: mixing it is exact for a flat compositor and close for a pigment
// one, whose state is near linear over the small steps a fade takes between two pictures.

import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import { stampPaintTargetWgsl, type StampPaintTarget } from './stamp-paint-compositor.ts';
import { dispatchStampCompute, STAMP_WORKGROUP } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import type { StampUniformArena } from './stamp-uniform-arena.ts';

const STAMP_SPAN_FADE = gpuUniformLayout('SpanFade', [['visibility', 'f32'], ['origin', 'vec2u'], ['extent', 'vec2u']]);

const PLAIN: StampPaintTarget = { kind: 'plain' };

/** The mix's WGSL for a target shaped `shape`: what was kept (1) toward what's there now (2) by the visibility. */
function spanFadeWgsl(shape: StampPaintTarget) {
  const layers = shape.kind === 'array' ? shape.layers : 1;
  const load = (name: string) => (shape.kind === 'array' ? `textureLoad(${name}, pixel, l${name === 'kept' ? ', 0' : ''})` : `textureLoad(${name}, pixel${name === 'kept' ? ', 0' : ''})`);
  const store = shape.kind === 'array' ? 'textureStore(faded, pixel, l, mixed)' : 'textureStore(faded, pixel, mixed)';
  return /* wgsl */ `
${STAMP_SPAN_FADE.wgsl}
@group(0) @binding(0) var<uniform> u: SpanFade;
${stampPaintTargetWgsl('kept', 1, shape, null)}
${stampPaintTargetWgsl('faded', 2, shape, 'read_write')}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn spanFade(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  for (var l = 0u; l < ${layers}u; l++) {
    let mixed = mix(${load('kept')}, ${load('faded')}, u.visibility);
    ${store};
  }
}`;
}

/** A target faded: its texture, its shape and the view a pass writes it through. */
export type StampFadedTarget = { readonly texture: GPUTexture; readonly shape: StampPaintTarget; readonly view: GPUTextureView };

/** What one fade kept of each target, to mix back into. */
export type StampSpanKept = readonly { readonly target: StampFadedTarget; readonly kept: GPUTextureView }[];

/**
 * Span fades on `owner`'s device, keeping what a span lays over in its targets, `depth` deep where spans nest; each
 * mix's uniform from `arena`.
 */
export function createStampSpanFade(owner: StampPaintGpuOwner, arena: StampUniformArena) {
  const { device } = owner;
  const pipelineOf = (shape: StampPaintTarget) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: spanFadeWgsl(shape) }) } });
  return {
    /** Keeps each of `targets` as it stands at this point in `encoder`, for a span `depth` spans deep. */
    keep(encoder: GPUCommandEncoder, targets: readonly StampFadedTarget[], depth: number): StampSpanKept {
      return targets.map((target, t) => {
        const { width, height, depthOrArrayLayers, format } = target.texture;
        const kept = owner.target(`span fade ${depth}|${t}`, { size: [width, height, depthOrArrayLayers], format, usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING }, encoder);
        encoder.copyTextureToTexture({ texture: target.texture }, { texture: kept }, [width, height, depthOrArrayLayers]);
        return { target, kept: kept.createView({ dimension: target.shape.kind === 'array' ? '2d-array' : '2d' }) };
      });
    },
    /** Mixes each target from what `kept` holds toward what it holds now by `visibility`, over `box` (stage texels). */
    mix(encoder: GPUCommandEncoder, kept: StampSpanKept, visibility: number, box: StampPixelBox) {
      for (const { target, kept: was } of kept) {
        dispatchStampCompute(device, encoder, pipelineOf(target.shape), [
          arena.slot((views) => {
            const put = gpuUniformWriter(STAMP_SPAN_FADE, views);
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

export type StampSpanFade = ReturnType<typeof createStampSpanFade>;

/** A plain target (emission, motion) as a fade keeps it. */
export const stampPlainFaded = (texture: GPUTexture): StampFadedTarget => ({ texture, shape: PLAIN, view: texture.createView() });

// shot-painted-textures.ts: a shot's compiled painted textures (ENGINE 6.3, compileShotPaintedTextures) drawn for its
// three sources, each a handle loadPaintedThreeSources reads, brought up to a frame's moment by `update`. A texture's
// source is read at the moment;
// each selection it blends is solved (solvePaintingSheets), laid on its paper at the document's size
// (drawStampSheetsStill), resampled to the texture's size and summed by its weight in linear light, so a dissolve
// blends opaque colour; then gamma-encoded into the handle, as paintedThreeColorNode decodes it. A painting that wraps
// is resampled repeating across each axis it wraps, and its handle says how it wraps.
//
// A texture whose source reads the same selections and weights as when it was last drawn isn't drawn again.

import type { PaintingBrushOf } from '#lib/paint/document/models/painting-deposit-compile.ts';
import { compilePaintingSelection } from '#lib/paint/document/models/painting-document-compile.ts';
import { paintingErrors, paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import { solvePaintingSheets } from '#lib/paint/document/studio/painting-sheets-solve.ts';
import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampWrapsAcross, type StampAxis, type StampWrap } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampBindGroup } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintSurface, type StampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { drawStampSheetsStill } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import { createStampUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import type { PaintedThreeTextureHandle, PaintedThreeTexturesSupplied } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_FULL_FRAME_WGSL, GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import { compiledPaintedTextureSourceAt, type CompiledShotPaintedTexture } from '../models/shot-painted-texture-compile.ts';
import { paintedSourceShares, samePaintedSourceShares, type PaintedSourceShare } from '../models/shot-selection.ts';

/** What a shot's painted textures are painted with: its brushes, and where their solves count. */
export type ShotPaintedTexturesOptions = { readonly brushOf: PaintingBrushOf; readonly costs?: StampPaintCostTally };

/** A shot's painted textures as its three sources read them, and `dispose`, letting their textures go after the sources. */
export type ShotPaintedTextures = PaintedThreeTexturesSupplied & { readonly dispose: () => void };

/** A texture as it's drawn: its handle, the sum laid into it, and the shares it was last drawn from (null: never drawn). */
type ShotPaintedTextureSlot = {
  readonly texture: CompiledShotPaintedTexture;
  readonly handle: PaintedThreeTextureHandle;
  readonly light: GPUTexture;
  last: readonly PaintedSourceShare[] | null;
};

/** Taps a side a texture's texel averages its painting through, at most: past 8× smaller, a texel samples sparsely. */
const SHOT_TEXTURE_MOST_TAPS = 8;

const SHOT_TEXTURE_RESAMPLE = gpuUniformLayout('TextureResample', [['size', 'vec2f'], ['taps', 'vec2u'], ['weight', 'f32']]);

// A texel's share of a painting's light: its footprint's taps, each a bilinear read of the encoded painting decoded
// to linear light, averaged and weighed, summed into what's there by the target's blend.
const SHOT_TEXTURE_RESAMPLE_WGSL = /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
${GPU_SRGB_WGSL}
${SHOT_TEXTURE_RESAMPLE.wgsl}
@group(0) @binding(0) var<uniform> u: TextureResample;
@group(0) @binding(1) var painted: texture_2d<f32>;
@group(0) @binding(2) var along: sampler;
@fragment fn resample(@builtin(position) at: vec4f) -> @location(0) vec4f {
  var sum = vec3f(0.0);
  for (var j = 0u; j < u.taps.y; j++) {
    for (var i = 0u; i < u.taps.x; i++) {
      let uv = (floor(at.xy) + (vec2f(f32(i), f32(j)) + 0.5) / vec2f(u.taps)) / u.size;
      sum += srgbDecoded(textureSampleLevel(painted, along, uv, 0.0).rgb);
    }
  }
  return vec4f(u.weight * sum / f32(u.taps.x * u.taps.y), u.weight);
}`;

const SHOT_TEXTURE_ENCODE_WGSL = /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
${GPU_SRGB_WGSL}
@group(0) @binding(0) var light: texture_2d<f32>;
@fragment fn encode(@builtin(position) at: vec4f) -> @location(0) vec4f {
  return vec4f(srgbEncoded(textureLoad(light, vec2i(at.xy), 0).rgb), 1.0);
}`;

const SHOT_TEXTURE_SUM: GPUBlendState = { color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' } };

/**
 * Compiled `textures` drawn on `owner`'s device for a shot's three sources. Refuses, as `update` reads a callback, a
 * source with an error at that moment (compiledPaintedTextureSourceAt).
 */
export function createShotPaintedTextures(owner: StampPaintGpuOwner, textures: readonly CompiledShotPaintedTexture[], { brushOf, costs }: ShotPaintedTexturesOptions): ShotPaintedTextures {
  const { webgpu, device } = owner, usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
  const resampleModule = device.createShaderModule({ code: SHOT_TEXTURE_RESAMPLE_WGSL }), encodeModule = device.createShaderModule({ code: SHOT_TEXTURE_ENCODE_WGSL });
  const resample = device.createRenderPipeline({ layout: 'auto', vertex: { module: resampleModule }, fragment: { module: resampleModule, targets: [{ format: 'rgba32float', blend: SHOT_TEXTURE_SUM }] } });
  const encode = device.createRenderPipeline({ layout: 'auto', vertex: { module: encodeModule }, fragment: { module: encodeModule, targets: [{ format: 'rgba16float' }] } });
  // A wrapped painting is read repeating across each axis it wraps, so a texel by a seam averages paint from both its
  // edges; one sampler a wrap, made once.
  const samplers = new Map<StampWrap | null, GPUSampler>();
  const along = (wrap: StampWrap | null) => {
    let sampler = samplers.get(wrap);
    if (!sampler) {
      const mode = (axis: StampAxis): GPUAddressMode => (stampWrapsAcross(wrap, axis) ? 'repeat' : 'clamp-to-edge');
      samplers.set(wrap, (sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: mode('x'), addressModeV: mode('y') })));
    }
    return sampler;
  };
  // Let go of on dispose: the handles, each texture's sum, and a picture a painting's size.
  const owned: GPUTexture[] = [], pictures = new Map<string, Promise<{ view: GPUTextureView; surface: StampPaintSurface }>>();
  const own = (width: number, height: number, format: GPUTextureFormat) => {
    const texture = webgpu.createTexture({ size: [width, height], format, usage });
    owned.push(texture);
    return texture;
  };
  // Shared by every texture's draws: they run in turn, and each picture is resampled before the next is laid.
  const pictureOf = (width: number, height: number) => {
    const key = `${width}x${height}`;
    let made = pictures.get(key);
    if (!made) {
      const texture = own(width, height, 'rgba16float');
      pictures.set(key, (made = createStampPaintSurface(owner, { frame: texture }).then((surface) => ({ view: texture.createView(), surface }))));
    }
    return made;
  };
  const arena = createStampUniformArena(device, 1);
  const drawn = textures.map((texture): ShotPaintedTextureSlot => ({
    texture, handle: { id: texture.id, texture: own(texture.widthPx, texture.heightPx, 'rgba16float'), wrap: texture.wrap },
    light: own(texture.widthPx, texture.heightPx, 'rgba32float'), last: null,
  }));

  /** One share's selection solved, laid on its paper and summed by its weight into `light`, cleared first when `first`. */
  const sumShare = async ({ texture, light }: ShotPaintedTextureSlot, { selection, weight }: PaintedSourceShare, first: boolean) => {
    const compiled = compilePaintingSelection(selection.painting, brushOf, { layers: selection.layers });
    const { width, height } = compiled.sheets[0].program, picture = await pictureOf(width, height);
    const { composite, release } = await solvePaintingSheets(owner, compiled, { ...(costs && { costs }), ...(selection.at !== undefined && { at: selection.at }) });
    try {
      await drawStampSheetsStill(picture.surface, composite);
    } finally {
      release();
    }
    await owner.checked(`summing painted texture ${texture.id}`, () => {
      const taps = [width / texture.widthPx, height / texture.heightPx].map((ratio) => Math.min(SHOT_TEXTURE_MOST_TAPS, Math.max(1, Math.ceil(ratio))));
      const slot = arena.slot((views) => {
        const put = gpuUniformWriter(SHOT_TEXTURE_RESAMPLE, views);
        put('size', [texture.widthPx, texture.heightPx]);
        put('taps', [taps[0], taps[1]]);
        put('weight', weight);
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: light.createView(), loadOp: first ? 'clear' : 'load', clearValue: [0, 0, 0, 0], storeOp: 'store' }] });
      pass.setPipeline(resample);
      pass.setBindGroup(0, stampBindGroup(device, resample, [slot, picture.view, along(texture.wrap)]));
      pass.draw(3);
      pass.end();
      arena.flush();
      device.queue.submit([encoder.finish()]);
      arena.reset();
    });
  };

  const drawAt = async (slot: ShotPaintedTextureSlot, moment: PaintMoment) => {
    const { texture, handle, light } = slot, { source, problems } = compiledPaintedTextureSourceAt(texture, moment), errors = paintingErrors(problems);
    if (errors.length) throw new Error(`shot: painted texture ${texture.id} at ${moment.at} s: ${errors.map(paintingProblemText).join('; ')}`);
    const shares = paintedSourceShares(source);
    if (slot.last && samePaintedSourceShares(slot.last, shares)) return;
    await gpuEachInTurn(shares, (share, s) => sumShare(slot, share, s === 0));
    await owner.checked(`encoding painted texture ${texture.id}`, () => {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: handle.texture.createView(), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(encode);
      pass.setBindGroup(0, stampBindGroup(device, encode, [light.createView()]));
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    });
    slot.last = shares;
  };

  return {
    handles: drawn.map(({ handle }) => handle),
    update: async (t) => {
      await gpuEachInTurn(drawn, (slot) => drawAt(slot, paintMoment(t)));
    },
    dispose: () => {
      for (const texture of owned.splice(0)) texture.destroy();
    },
  };
}

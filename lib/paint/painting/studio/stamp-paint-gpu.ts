// stamp-paint-gpu.ts: the WebGPU pieces the stamp-paint renderer is built from, on a studio device
// (gpu-device-owner.ts): images as mipmapped textures, and a tip's paint read back from each of its mip levels.
//
// Paint is held in half floats (rgba16float, rg16float): a glaze lays each stamp at a few thousandths of its flow,
// which 8 bits would round away. The renderer's compute passes read and write those targets in place, which needs
// read_write storage of rgba16float: the `texture-formats-tier2` feature.

import { GPU_FULL_FRAME_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import type { StampTipLevel } from '../models/stamp-tip-hull.ts';

/**
 * What stamp painting makes its GPU resources through: a device, or a surface's cache or a painting's scope of one
 * (stamp-paint-surface.ts).
 */
export type StampPaintDevice = Pick<
  GPUDevice,
  'createBuffer' | 'createTexture' | 'createShaderModule' | 'createComputePipeline' | 'createRenderPipeline' | 'createBindGroup' | 'createCommandEncoder' | 'createSampler' | 'queue' | 'limits'
>;

const MIP_WGSL = /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearClamp: sampler;
@fragment fn halve(@builtin(position) at: vec4f) -> @location(0) vec4f {
  // The target's texel centre sits on the corner of four source texels: a linear sample averages them.
  return textureSampleLevel(source, linearClamp, at.xy * 2.0 / vec2f(textureDimensions(source)), 0.0);
}`;

export type StampPaintImage = { texture: GPUTexture; view: GPUTextureView; width: number; height: number };

/** Each image at `urls`, decoded as stored: no colour conversion, no premultiplying. */
export function fetchStampPaintBitmaps(urls: readonly string[]): Promise<ImageBitmap[]> {
  return Promise.all(urls.map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`stamp paint: ${url} answered ${response.status}`);
    return createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  }));
}

/**
 * Uploads each bitmap as a mipmapped texture of its red channel alone (a grey tip or grain) or its colour (a paper),
 * closing it. A tip is sampled across a frame's whole stamp area, so a quarter of the bytes is a large part of a
 * frame's time.
 */
export function uploadStampPaintBitmaps(device: StampPaintDevice, bitmaps: readonly { bitmap: ImageBitmap; channels: 'red' | 'colour' }[]): StampPaintImage[] {
  return mipmappedTextures(device, bitmaps.map(({ bitmap, channels }) => {
    const { width, height } = bitmap;
    return {
      width, height, format: channels === 'red' ? 'r8unorm' : 'rgba8unorm',
      fill: (texture: GPUTexture) => {
        device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [width, height]);
        // A closed bitmap reads as 0 × 0.
        bitmap.close();
      },
    };
  }));
}

/** Uploads grey images drawn in memory (a bristle tip's), a byte a texel, as mipmapped textures of their red channel. */
export function uploadStampPaintGreyImages(device: StampPaintDevice, images: readonly { width: number; height: number; pixels: Uint8Array }[]): StampPaintImage[] {
  return mipmappedTextures(device, images.map(({ width, height, pixels }) => ({
    width, height, format: 'r8unorm' as const,
    fill: (texture: GPUTexture) => device.queue.writeTexture({ texture }, pixels, { bytesPerRow: width }, [width, height]),
  })));
}

/**
 * A texture for each image, its top level filled by `fill`, then each level below. WebGPU makes no mipmaps: each
 * level averages four texels of the one above it.
 */
function mipmappedTextures(device: StampPaintDevice, images: readonly { width: number; height: number; format: GPUTextureFormat; fill: (texture: GPUTexture) => void }[]): StampPaintImage[] {
  const module = device.createShaderModule({ code: MIP_WGSL });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  const pipeline = (format: GPUTextureFormat) => {
    if (!pipelines.has(format)) pipelines.set(format, device.createRenderPipeline({ layout: 'auto', vertex: { module }, fragment: { module, targets: [{ format }] } }));
    return pipelines.get(format)!;
  };
  const encoder = device.createCommandEncoder();
  const made = images.map(({ width, height, format, fill }) => {
    const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
    const texture = device.createTexture({
      size: [width, height], format, mipLevelCount: levels,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    fill(texture);
    for (let level = 1; level < levels; level++) {
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline(format));
      pass.setBindGroup(0, device.createBindGroup({ layout: pipeline(format).getBindGroupLayout(0), entries: [
        { binding: 0, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) }, { binding: 1, resource: sampler },
      ] }));
      pass.draw(3);
      pass.end();
    }
    return { texture, view: texture.createView(), width, height };
  });
  device.queue.submit([encoder.finish()]);
  return made;
}

/** A tip's paint at every mip level, read back from the GPU as it samples it: a texel holds paint where it isn't white. */
export async function readStampTipLevels(device: StampPaintDevice, tip: StampPaintImage): Promise<StampTipLevel[]> {
  const levels = tip.texture.mipLevelCount;
  const encoder = device.createCommandEncoder();
  const reads = Array.from({ length: levels }, (_, level) => {
    const width = Math.max(1, tip.width >> level), height = Math.max(1, tip.height >> level);
    // A copy's rows are padded to 256 bytes.
    const row = Math.ceil(width / 256) * 256;
    const buffer = device.createBuffer({ size: row * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    encoder.copyTextureToBuffer({ texture: tip.texture, mipLevel: level }, { buffer, bytesPerRow: row }, [width, height]);
    return { width, height, row, buffer };
  });
  device.queue.submit([encoder.finish()]);
  return Promise.all(reads.map(async ({ width, height, row, buffer }): Promise<StampTipLevel> => {
    await buffer.mapAsync(GPUMapMode.READ);
    const texels = new Uint8Array(buffer.getMappedRange());
    const rows = Array.from({ length: height }, (_, y): [number, number] | null => {
      let first = -1, last = -1;
      for (let x = 0; x < width; x++) {
        if (texels[y * row + x] === 255) continue;
        if (first < 0) first = x;
        last = x;
      }
      return first < 0 ? null : [first, last];
    });
    buffer.destroy();
    return { width, height, rows };
  }));
}

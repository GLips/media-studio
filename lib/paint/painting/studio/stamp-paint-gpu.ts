// stamp-paint-gpu.ts: the WebGPU pieces the stamp-paint renderer is built from, on a studio device
// (gpu-device-owner.ts): grains and papers as textures mipmapped on the GPU, and tips decoded for the CPU, whose
// levels (stamp-tip-levels.ts) are uploaded as they are.
//
// Paint is held in half floats (rgba16float, rg16float): a glaze lays each stamp at a few thousandths of its flow,
// which 8 bits would round away. The renderer's compute passes read and write those targets in place, which needs
// read_write storage of rgba16float: the `texture-formats-tier2` feature.

import { GPU_FULL_FRAME_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import type { StampTipImage, StampTipLevels } from '#lib/paint/brush/models/stamp-tip-levels.ts';

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

/** Uploads each bitmap as a mipmapped texture of its red channel alone (a grain) or its colour (a paper), closing it. */
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

/**
 * `bitmap`'s red channel, a byte a texel, closing it: a tip as the CPU reads it. A pack's tip is an opaque grey PNG,
 * decoded as stored (fetchStampPaintBitmaps), so the canvas neither converts its colour nor premultiplies it.
 */
export function decodeStampTipBitmap(bitmap: ImageBitmap): StampTipImage {
  const { width, height } = bitmap;
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = context.getImageData(0, 0, width, height).data, pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = rgba[i * 4];
  return { width, height, pixels };
}

/**
 * A tip's texture of its red channel, each of `levels` written as its mip level as it is. A tip is sampled across a
 * frame's whole stamp area, so a byte a texel, a quarter of rgba8's, is a large part of a frame's time.
 */
export function uploadStampTipLevels(device: StampPaintDevice, levels: StampTipLevels): StampPaintImage {
  const { width, height } = levels[0];
  const texture = device.createTexture({ size: [width, height], format: 'r8unorm', mipLevelCount: levels.length, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  levels.forEach((level, mipLevel) => device.queue.writeTexture({ texture, mipLevel }, level.texels, { bytesPerRow: level.width }, [level.width, level.height]));
  return { texture, view: texture.createView(), width, height };
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
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
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

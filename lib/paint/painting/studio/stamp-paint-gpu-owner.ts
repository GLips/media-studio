// stamp-paint-gpu-owner.ts: a studio device owner (gpu-device-owner.ts) with everything on it that outlasts a
// painting: the images, each tip's mip levels (made on the CPU, stamp-tip-levels.ts), modules, pipelines and samplers, the targets, and the GPU
// cache (stamp-paint-gpu-cache.ts), whose one budget every painting and output on the device shares. Outputs
// (stamp-paint-surface.ts) and three.js (the owner's one renderer) render on it too.
//
// A painting's buffers and textures go in a scope (StampPaintGpuScope) freed with it.

import type { StampBrushAsset } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampTipLevels, type StampTipLevels } from '#lib/paint/brush/models/stamp-tip-levels.ts';
import { stampPaintGpuCache, type StampPaintGpuCache } from './stamp-paint-gpu-cache.ts';
import { createGpuDeviceOwner, type GpuDeviceOwner } from '#lib/platform/gpu/studio/gpu-device-owner.ts';
import {
  decodeStampTipBitmap, fetchStampPaintBitmaps, type StampPaintDevice, type StampPaintImage, uploadStampPaintBitmaps, uploadStampTipLevels,
} from './stamp-paint-gpu.ts';

/** A painting's share of a device: what it makes through `device` is destroyed by `destroy`. */
export type StampPaintGpuScope = { device: StampPaintDevice; destroy: () => void };

export type StampPaintGpuOwner = GpuDeviceOwner & {
  /**
   * The device as a painting reads it: modules, pipelines and samplers come from caches keyed by their descriptors;
   * a buffer or texture made through it lasts until the owner is disposed.
   */
  device: StampPaintDevice;
  /** A new scope for one painting's buffers and textures. */
  scope: () => StampPaintGpuScope;
  /**
   * Each image at its asset, fetched once a device: a tip (or a tip's contact) by its red channel, its mip levels made
   * on the CPU; a grain by its red channel and the paper's photograph in colour, mipmapped on the GPU.
   */
  images: (assets: readonly { asset: StampBrushAsset; kind: StampPaintImageKind }[]) => Promise<StampPaintImage[]>;
  /** A tip drawn in memory under `key` (a bristle tip at a diameter), its levels made and uploaded the first time it's asked for. */
  drawnImage: (key: string, draw: () => { size: number; pixels: Uint8Array }) => StampPaintImage;
  /** The mip levels `tip` was uploaded with: a tip's from `images` or `drawnImage`. */
  tipLevels: (tip: StampPaintImage) => StampTipLevels;
  /** What frames keep between them on the device, under one budget: films, pictures, pictures blurred. */
  cache: StampPaintGpuCache;
  /**
   * The texture `descriptor` makes, made once a device for each `name` (its role) and shape: a painting's targets,
   * shared by every painting and output of that size. A frame never depends on what an earlier one left in them.
   */
  target: (name: string, descriptor: GPUTextureDescriptor) => GPUTexture;
  /** Frees all it holds, then the device and its three.js renderer; dispose what else draws on it first. */
  dispose: () => void;
};

/** What an image is to a painting: a tip, read on the CPU too; a grain, tiled; or the paper's photograph, in colour. */
export type StampPaintImageKind = 'tip' | 'grain' | 'photograph';

const assetKey = ({ style, pack, file }: StampBrushAsset) => `${style}/${pack}/${file}`;

/** A field of a pipeline's or sampler's descriptor, as JSON.stringify walks it. */
type StampDescriptorValue = GPUShaderModule | string | number | boolean | null | undefined | readonly StampDescriptorValue[] | { [field: string]: StampDescriptorValue };

/** An owner of a new device, fetching each image from `imageUrl`. */
export async function createStampPaintGpuOwner(imageUrl: (asset: StampBrushAsset) => string): Promise<StampPaintGpuOwner> {
  const base = await createGpuDeviceOwner(), { webgpu, checked } = base;
  // Everything the owner makes, freed on dispose.
  const ownGpu = stampPaintGpuScope(cachingStampPaintDevice(webgpu));
  const { device } = ownGpu;
  const images = new Map<string, Promise<StampPaintImage>>();
  const drawn = new Map<string, StampPaintImage>();
  const levels = new Map<StampPaintImage, StampTipLevels>();
  const targets = new Map<string, GPUTexture>();
  const cache = stampPaintGpuCache(device);
  const tipImage = (tipLevels: StampTipLevels) => {
    const image = uploadStampTipLevels(device, tipLevels);
    levels.set(image, tipLevels);
    return image;
  };

  return {
    ...base, device, cache,
    scope: () => stampPaintGpuScope(device),
    images: (wanted) => {
      const missing = wanted.filter(({ asset, kind }) => !images.has(`${kind}|${assetKey(asset)}`));
      if (missing.length) {
        const bitmaps = fetchStampPaintBitmaps(missing.map(({ asset }) => imageUrl(asset)));
        const uploaded = bitmaps.then((fetched) => {
          // Decoded before the check, which mustn't await; the tips' levels made with it.
          const tipLevelsOf = new Map(fetched.flatMap((bitmap, i) => (missing[i].kind === 'tip' ? [[i, stampTipLevels(decodeStampTipBitmap(bitmap))] as const] : [])));
          return checked('loading the brushes\' images onto the GPU', () => {
            const textured = uploadStampPaintBitmaps(device, fetched.flatMap((bitmap, i) => (tipLevelsOf.has(i) ? [] : [{ bitmap, channels: missing[i].kind === 'photograph' ? 'colour' as const : 'red' as const }])));
            return fetched.map((_, i) => {
              const tip = tipLevelsOf.get(i);
              return tip ? tipImage(tip) : textured.shift()!;
            });
          });
        });
        missing.forEach(({ asset, kind }, i) => images.set(`${kind}|${assetKey(asset)}`, uploaded.then((made) => made[i])));
      }
      return Promise.all(wanted.map(({ asset, kind }) => images.get(`${kind}|${assetKey(asset)}`)!));
    },
    drawnImage: (key, draw) => {
      let image = drawn.get(key);
      if (!image) {
        const { size, pixels } = draw();
        image = tipImage(stampTipLevels({ width: size, height: size, pixels }));
        drawn.set(key, image);
      }
      return image;
    },
    tipLevels: (tip) => levels.get(tip)!,
    target: (name, descriptor) => cached(targets, `${name}|${JSON.stringify(descriptor)}`, () => device.createTexture(descriptor)),
    dispose: () => {
      cache.dispose();
      ownGpu.destroy();
      base.dispose();
    },
  };
}

/**
 * `raw` with its shader modules cached by code, and its pipelines and samplers by descriptor: a painting's pipelines
 * hang on its palette (the pigment compositor's WGSL), so paintings alike share theirs.
 */
function cachingStampPaintDevice(raw: GPUDevice): StampPaintDevice {
  const modules = new Map<string, GPUShaderModule>(), moduleIds = new Map<GPUShaderModule, number>();
  const computes = new Map<string, GPUComputePipeline>(), renders = new Map<string, GPURenderPipeline>(), samplers = new Map<string, GPUSampler>();
  // A module stands in a key by its code's place in the cache: as JSON, every module reads `{}`.
  const keyOf = (descriptor: GPUComputePipelineDescriptor | GPURenderPipelineDescriptor | GPUSamplerDescriptor) =>
    JSON.stringify(descriptor, (_key, value: StampDescriptorValue) => (value instanceof GPUShaderModule ? `module ${moduleIds.get(value)}` : value));
  return {
    limits: raw.limits, queue: raw.queue,
    createBuffer: (descriptor) => raw.createBuffer(descriptor),
    createTexture: (descriptor) => raw.createTexture(descriptor),
    createBindGroup: (descriptor) => raw.createBindGroup(descriptor),
    createCommandEncoder: (descriptor) => raw.createCommandEncoder(descriptor),
    createShaderModule: (descriptor) => {
      let module = modules.get(descriptor.code);
      if (!module) {
        module = raw.createShaderModule(descriptor);
        modules.set(descriptor.code, module);
        moduleIds.set(module, moduleIds.size);
      }
      return module;
    },
    createComputePipeline: (descriptor) => cached(computes, keyOf(descriptor), () => raw.createComputePipeline(descriptor)),
    createRenderPipeline: (descriptor) => cached(renders, keyOf(descriptor), () => raw.createRenderPipeline(descriptor)),
    createSampler: (descriptor) => cached(samplers, keyOf(descriptor ?? {}), () => raw.createSampler(descriptor)),
  };
}

/** `made`'s entry under `key`, made by `make` the first time. */
function cached<T>(made: Map<string, T>, key: string, make: () => T): T {
  let found = made.get(key);
  if (!found) {
    found = make();
    made.set(key, found);
  }
  return found;
}

/**
 * `device` keeping every buffer and texture made through it, to destroy them together. One destroyed sooner (a boil
 * epoch's evicted bank) leaves the scope then, so a long scene's scope holds only what's live.
 */
function stampPaintGpuScope(device: StampPaintDevice): StampPaintGpuScope {
  const owned = new Set<{ destroy: () => void }>();
  const own = <T extends { destroy: () => void }>(resource: T) => {
    owned.add(resource);
    const destroy = resource.destroy.bind(resource);
    // An own property shadowing the prototype's method: WebGPU never calls it, only our code does.
    resource.destroy = () => {
      owned.delete(resource);
      destroy();
    };
    return resource;
  };
  return {
    device: { ...device, createBuffer: (descriptor) => own(device.createBuffer(descriptor)), createTexture: (descriptor) => own(device.createTexture(descriptor)) },
    destroy: () => {
      // Each destroy deletes its resource from `owned`, which a Set's iteration allows.
      for (const resource of owned) resource.destroy();
    },
  };
}

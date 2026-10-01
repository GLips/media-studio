// stamp-paint-gpu-owner.ts: the one owner of a GPU device stamp painting draws on, and of everything on it that
// outlasts a painting: the images, each tip's mip levels and hulls, modules, pipelines and samplers, the targets, and
// the GPU cache (stamp-paint-gpu-cache.ts), whose one budget every painting and output on the device shares. Outputs
// (stamp-paint-surface.ts) and three.js (paint/three-layers) render on it too.
//
// A painting's buffers and textures go in a scope (StampPaintGpuScope) freed with it.
//
// Warning: error scopes are one stack per device. A synchronous check pops within its task, so it nests inside
// anything open. An asynchronous one (three.js's loads) stays open across awaits, so they run one after another:
// two open at once would pop each other's scopes.

import type { StampBrushAsset } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampTipHull, type StampTipHull, type StampTipLevel } from '../models/stamp-tip-hull.ts';
import { stampPaintGpuCache, type StampPaintGpuCache } from './stamp-paint-gpu-cache.ts';
import {
  createStampPaintDevice, fetchStampPaintBitmaps, readStampTipLevels, type StampPaintDevice, type StampPaintImage, uploadStampPaintBitmaps, uploadStampPaintGreyImages,
} from './stamp-paint-gpu.ts';

const GPU_ERROR_SCOPES = ['validation', 'out-of-memory', 'internal'] as const;

/** A painting's share of a device: what it makes through `device` is destroyed by `destroy`. */
export type StampPaintGpuScope = { device: StampPaintDevice; destroy: () => void };

export type StampPaintGpuOwner = {
  /** The device itself, for what draws on it besides stamp painting (three.js) and for configuring a canvas. */
  webgpu: GPUDevice;
  /**
   * The device as a painting reads it: modules, pipelines and samplers come from caches keyed by their descriptors;
   * a buffer or texture made through it lasts until the owner is disposed.
   */
  device: StampPaintDevice;
  /** A new scope for one painting's buffers and textures. */
  scope: () => StampPaintGpuScope;
  /**
   * Runs `work`, which mustn't await, and resolves with what it returns once WebGPU has checked it, or rejects naming
   * `what` and the error. Its scopes are popped before any other work can push one, so checks never catch each
   * other's errors.
   */
  checked: <T>(what: string, work: () => T) => Promise<T>;
  /**
   * Runs `work`, which may await, once every asynchronous check asked for before it is done, and resolves or rejects
   * as `checked` does. Its errors are those of the work done meanwhile outside any synchronous check.
   */
  checkedAsync: <T>(what: string, work: () => Promise<T>) => Promise<T>;
  /** Throws if the device was lost (a lost device isn't an error a scope catches). */
  assertLive: () => void;
  /** Each image at its asset, the paper's photograph in colour and the rest by their red channel; fetched once a device. */
  images: (assets: readonly { asset: StampBrushAsset; channels: 'red' | 'colour' }[]) => Promise<StampPaintImage[]>;
  /** An image drawn in memory under `key` (a bristle tip at a diameter), uploaded the first time it's asked for. */
  drawnImage: (key: string, draw: () => { size: number; pixels: Uint8Array }) => StampPaintImage;
  /** `tip`'s paint at every mip level, read back once a device. */
  tipLevels: (tip: StampPaintImage) => Promise<StampTipLevel[]>;
  /** `tip`'s hull at mip level `coarsest`, once its levels are read (tipLevels). */
  tipHull: (tip: StampPaintImage, coarsest: number) => StampTipHull;
  /** What frames keep between them on the device, under one budget: films, pictures, pictures blurred. */
  cache: StampPaintGpuCache;
  /**
   * The texture `descriptor` makes, made once a device for each `name` (its role) and shape: a painting's targets,
   * shared by every painting and output of that size. A frame never depends on what an earlier one left in them.
   */
  target: (name: string, descriptor: GPUTextureDescriptor) => GPUTexture;
  /** Frees all it holds and destroys the device; dispose what else draws on it (three.js) first. */
  dispose: () => void;
};

const assetKey = ({ style, pack, file }: StampBrushAsset) => `${style}/${pack}/${file}`;

/** A field of a pipeline's or sampler's descriptor, as JSON.stringify walks it. */
type StampDescriptorValue = GPUShaderModule | string | number | boolean | null | undefined | readonly StampDescriptorValue[] | { [field: string]: StampDescriptorValue };

/** An owner of a new device, fetching each image from `imageUrl`. */
export async function createStampPaintGpuOwner(imageUrl: (asset: StampBrushAsset) => string): Promise<StampPaintGpuOwner> {
  const webgpu = await createStampPaintDevice();
  let lost: string | null = null;
  void webgpu.lost.then(({ reason, message }) => (lost ??= reason === 'destroyed' ? null : message));

  const checked = async <T,>(what: string, work: () => T): Promise<T> => {
    for (const scope of GPU_ERROR_SCOPES) webgpu.pushErrorScope(scope);
    let popped: Promise<(GPUError | null)[]>, result: T;
    try {
      result = work();
    } finally {
      // Popped together, before anything else can push, so no other work's errors land in them; a destroyed
      // device's resolve with no error.
      popped = Promise.all(GPU_ERROR_SCOPES.map(() => webgpu.popErrorScope()));
    }
    const error = (await popped).find(Boolean);
    if (error) throw new Error(`stamp paint: ${what} failed: ${error.message}`);
    return result;
  };

  // The asynchronous checks asked for so far, each settled before the next pushes.
  let asyncChecks: Promise<unknown> = Promise.resolve();
  const checkedAsync = <T,>(what: string, work: () => Promise<T>): Promise<T> => {
    const run = asyncChecks.then(async () => {
      for (const scope of GPU_ERROR_SCOPES) webgpu.pushErrorScope(scope);
      // Every scope is popped before anything is thrown: one left pushed would swallow the next check's errors.
      const popped = () => Promise.all(GPU_ERROR_SCOPES.map(() => webgpu.popErrorScope()));
      let result: T;
      try {
        result = await work();
      } catch (error) {
        await popped();
        throw error;
      }
      const error = (await popped()).find(Boolean);
      if (error) throw new Error(`stamp paint: ${what} failed: ${error.message}`);
      return result;
    });
    asyncChecks = run.catch(() => {});
    return run;
  };

  // Everything the owner makes, freed on dispose.
  const ownGpu = stampPaintGpuScope(cachingStampPaintDevice(webgpu));
  const { device } = ownGpu;
  const images = new Map<string, Promise<StampPaintImage>>();
  const drawn = new Map<string, StampPaintImage>();
  const levels = new Map<StampPaintImage, Promise<StampTipLevel[]>>(), levelsRead = new Map<StampPaintImage, StampTipLevel[]>();
  const hulls = new Map<StampPaintImage, Map<number, StampTipHull>>();
  const targets = new Map<string, GPUTexture>();
  const cache = stampPaintGpuCache(device);

  return {
    webgpu, device, checked, checkedAsync, cache,
    scope: () => stampPaintGpuScope(device),
    assertLive: () => {
      if (lost) throw new Error(`stamp paint: the GPU device was lost: ${lost}`);
    },
    images: (wanted) => {
      const missing = wanted.filter(({ asset, channels }) => !images.has(`${channels}|${assetKey(asset)}`));
      if (missing.length) {
        const bitmaps = fetchStampPaintBitmaps(missing.map(({ asset }) => imageUrl(asset)));
        const uploaded = bitmaps.then((fetched) => checked('loading the brushes\' images onto the GPU', () => uploadStampPaintBitmaps(device, fetched.map((bitmap, i) => ({ bitmap, channels: missing[i].channels })))));
        missing.forEach(({ asset, channels }, i) => images.set(`${channels}|${assetKey(asset)}`, uploaded.then((made) => made[i])));
      }
      return Promise.all(wanted.map(({ asset, channels }) => images.get(`${channels}|${assetKey(asset)}`)!));
    },
    drawnImage: (key, draw) => {
      let image = drawn.get(key);
      if (!image) {
        const { size, pixels } = draw();
        image = uploadStampPaintGreyImages(device, [{ width: size, height: size, pixels }])[0];
        drawn.set(key, image);
      }
      return image;
    },
    tipLevels: (tip) => {
      let read = levels.get(tip);
      if (!read) {
        read = readStampTipLevels(device, tip).then((tipLevels) => {
          levelsRead.set(tip, tipLevels);
          return tipLevels;
        });
        levels.set(tip, read);
      }
      return read;
    },
    tipHull: (tip, coarsest) => {
      const byLevel = hulls.get(tip) ?? new Map<number, StampTipHull>();
      hulls.set(tip, byLevel);
      if (!byLevel.has(coarsest)) byLevel.set(coarsest, stampTipHull(levelsRead.get(tip)!, coarsest));
      return byLevel.get(coarsest)!;
    },
    target: (name, descriptor) => cached(targets, `${name}|${JSON.stringify(descriptor)}`, () => device.createTexture(descriptor)),
    dispose: () => {
      cache.dispose();
      ownGpu.destroy();
      webgpu.destroy();
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

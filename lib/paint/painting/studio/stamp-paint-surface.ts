// stamp-paint-surface.ts: what lasts while one output shows stamp paintings, so a new painting loads only its own
// (stamp-paint-renderer.ts): the device (its own, or lent) and where frames go (a canvas, or a handed texture), the
// images, each tip's mip levels and hulls, modules, pipelines and samplers, and the targets.
//
// A painting's buffers and textures go in a scope (StampPaintGpuScope) freed with it. Targets are shared: a frame
// never depends on what an earlier one left in them (vid-117's rule), whichever painting drew it. Error scopes wrap
// synchronous work only, so none stays open across an await on a device three.js may share.

import type { StampBrushAsset } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampTipHull, type StampTipHull, type StampTipLevel } from '../models/stamp-tip-hull.ts';
import {
  createStampPaintDevice, fetchStampPaintBitmaps, readStampTipLevels, type StampPaintDevice, type StampPaintImage, uploadStampPaintBitmaps, uploadStampPaintGreyImages,
} from './stamp-paint-gpu.ts';

const GPU_ERROR_SCOPES = ['validation', 'out-of-memory', 'internal'] as const;

/** A painting's share of a surface's device: what it makes through `device` is destroyed by `destroy`. */
export type StampPaintGpuScope = { device: StampPaintDevice; destroy: () => void };

export type StampPaintSurface = {
  width: number;
  height: number;
  /**
   * The surface's device as a painting reads it: modules, pipelines and samplers come from caches keyed by their
   * descriptors; a buffer or texture made through it lasts until the surface is disposed.
   */
  device: StampPaintDevice;
  /** The texture to draw a frame into: the canvas's current one, or the lent frame. */
  frameTexture: () => GPUTexture;
  /** The format `frameTexture` is in. */
  format: GPUTextureFormat;
  /** A new scope for one painting's buffers and textures. */
  scope: () => StampPaintGpuScope;
  /**
   * Runs `work`, which mustn't await, and resolves with what it returns once WebGPU has checked it, or rejects naming
   * `what` and the error. Every scope it pushes is popped before any other work can push one, so checks on one surface
   * never catch each other's errors.
   */
  checked: <T>(what: string, work: () => T) => Promise<T>;
  /** Throws if the device was lost (a lost device isn't an error a scope catches). */
  assertLive: () => void;
  /** Each image at its asset, the paper's photograph in colour and the rest by their red channel; fetched once a surface. */
  images: (assets: readonly { asset: StampBrushAsset; channels: 'red' | 'colour' }[]) => Promise<StampPaintImage[]>;
  /** An image drawn in memory under `key` (a bristle tip at a diameter), uploaded the first time it's asked for. */
  drawnImage: (key: string, draw: () => { size: number; pixels: Uint8Array }) => StampPaintImage;
  /** `tip`'s paint at every mip level, read back once a surface. */
  tipLevels: (tip: StampPaintImage) => Promise<StampTipLevel[]>;
  /** `tip`'s hull at mip level `coarsest`, once its levels are read (tipLevels). */
  tipHull: (tip: StampPaintImage, coarsest: number) => StampTipHull;
  /** The texture `descriptor` makes, made once a surface for each `name` (its role): a painting's targets. */
  target: (name: string, descriptor: GPUTextureDescriptor) => GPUTexture;
  dispose: () => void;
};

const assetKey = ({ style, pack, file }: StampBrushAsset) => `${style}/${pack}/${file}`;

/** A field of a pipeline's or sampler's descriptor, as JSON.stringify walks it. */
type StampDescriptorValue = GPUShaderModule | string | number | boolean | null | undefined | readonly StampDescriptorValue[] | { [field: string]: StampDescriptorValue };

/**
 * Where a surface draws: a canvas of its own `width` × `height`, on a device it makes unless lent one (`device`); or
 * `frame` on a lent `device`. A lent device (createStampPaintDevice's, which three.js may share) is never destroyed
 * here. `frame` gets the canvas's colour, gamma-encoded and opaque, dithered only into bytes.
 */
export type StampPaintSurfaceOutput = { canvas: HTMLCanvasElement; width: number; height: number; device?: GPUDevice } | { device: GPUDevice; frame: GPUTexture };

/**
 * The output pass writes encoded colour to one 2D image it renders to: an -srgb format would encode it twice, and an
 * integer one can't hold it.
 */
const STAMP_PAINT_FRAME_FORMATS: ReadonlySet<GPUTextureFormat> = new Set(['rgba8unorm', 'bgra8unorm', 'rgba16float', 'rgba32float']);

function checkStampPaintFrameTexture(frame: GPUTexture) {
  if (!(frame.usage & GPUTextureUsage.RENDER_ATTACHMENT)) throw new Error('stamp paint: the texture a painting is drawn into needs RENDER_ATTACHMENT usage');
  if (!STAMP_PAINT_FRAME_FORMATS.has(frame.format)) throw new Error(`stamp paint: a painting is drawn into ${[...STAMP_PAINT_FRAME_FORMATS].join(', ')}, not ${frame.format}`);
  if (frame.dimension !== '2d' || frame.depthOrArrayLayers !== 1 || frame.sampleCount !== 1) throw new Error('stamp paint: a painting is drawn into one single-sampled 2D image');
}

/** A surface drawing to `output`, fetching each image from `imageUrl`. */
export async function createStampPaintSurface(output: StampPaintSurfaceOutput, imageUrl: (asset: StampBrushAsset) => string): Promise<StampPaintSurface> {
  if ('frame' in output) checkStampPaintFrameTexture(output.frame);
  const lent = output.device !== undefined;
  const raw = output.device ?? await createStampPaintDevice();
  let lost: string | null = null;
  void raw.lost.then(({ reason, message }) => (lost ??= reason === 'destroyed' ? null : message));

  const checked = async <T,>(what: string, work: () => T): Promise<T> => {
    for (const scope of GPU_ERROR_SCOPES) raw.pushErrorScope(scope);
    let popped: Promise<(GPUError | null)[]>, result: T;
    try {
      result = work();
    } finally {
      // Popped together, before anything else can push, so a lent device's owner never sees one left open; a
      // disposed device's resolve with no error.
      popped = Promise.all(GPU_ERROR_SCOPES.map(() => raw.popErrorScope()));
    }
    const error = (await popped).find(Boolean);
    if (error) throw new Error(`stamp paint: ${what} failed: ${error.message}`);
    return result;
  };

  // Everything the surface makes, freed on dispose: on a lent device, that's all it may free.
  const surfaceGpu = stampPaintGpuScope(cachingStampPaintDevice(raw));
  const { device } = surfaceGpu;
  const { frameTexture, format, release } = 'frame' in output ? lentOutput(output.frame) : await canvasOutput(raw, lent, output.canvas, checked);
  const { width, height } = 'frame' in output ? output.frame : output;

  const images = new Map<string, Promise<StampPaintImage>>();
  const drawn = new Map<string, StampPaintImage>();
  const levels = new Map<StampPaintImage, Promise<StampTipLevel[]>>(), levelsRead = new Map<StampPaintImage, StampTipLevel[]>();
  const hulls = new Map<StampPaintImage, Map<number, StampTipHull>>();
  const targets = new Map<string, GPUTexture>();

  return {
    width, height, device, format, frameTexture,
    scope: () => stampPaintGpuScope(device),
    checked,
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
    target: (name, descriptor) => {
      // Kept by shape too: paintings of other palettes may take turns on one surface, each binding its own.
      const key = `${name}|${JSON.stringify(descriptor)}`;
      let texture = targets.get(key);
      if (!texture) {
        texture = device.createTexture(descriptor);
        targets.set(key, texture);
      }
      return texture;
    },
    dispose: () => {
      surfaceGpu.destroy();
      release();
    },
  };
}

type StampPaintSurfaceTarget = { frameTexture: () => GPUTexture; format: GPUTextureFormat; release: () => void };

const lentOutput = (frame: GPUTexture): StampPaintSurfaceTarget => ({ frameTexture: () => frame, format: frame.format, release: () => {} });

/** `canvas` configured on `raw`, which the surface destroys with it unless it's `lent`. */
async function canvasOutput(raw: GPUDevice, lent: boolean, canvas: HTMLCanvasElement, checked: <T>(what: string, work: () => T) => Promise<T>): Promise<StampPaintSurfaceTarget> {
  // SAFETY: the canvas is the surface's alone, so it has no other kind of context to refuse 'webgpu' for.
  const context = canvas.getContext('webgpu') as GPUCanvasContext;
  const format: GPUTextureFormat = 'rgba8unorm';
  const destroyOwn = () => {
    if (!lent) raw.destroy();
  };
  try {
    await checked('configuring the canvas', () => context.configure({ device: raw, format, alphaMode: 'opaque' }));
  } catch (error) {
    destroyOwn();
    throw error;
  }
  return {
    frameTexture: () => context.getCurrentTexture(),
    format,
    release: () => {
      context.unconfigure();
      destroyOwn();
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

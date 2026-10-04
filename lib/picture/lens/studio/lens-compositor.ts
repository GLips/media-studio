// lens-compositor.ts: the studio's one lens on the GPU, for painted planes and three.js alike. A frame is one or
// more exposures (lens-exposures.ts), each its layers composited far to near, a layer of items laying one picture
// many times; several exposures are averaged in a 32-bit sum.
// One exposure that moved is gathered along its motion instead. Then what glows is bloomed once, and the image
// written. lens-passes.ts holds the passes.
//
// Warning: it encodes into its caller's command encoder, and its uniforms go up with `flush`, which the caller runs
// before each submit. One frame is open at a time: beginning one ends the last.

import { GPU_GAUSSIAN_PASS, gpuGaussianPassWgsl, type GpuGaussianRead } from '#lib/platform/gpu/models/gpu-gaussian.ts';
import { gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { createGpuInstanceRing } from '#lib/platform/gpu/studio/gpu-instance-ring.ts';
import { createGpuUniformRing } from '#lib/platform/gpu/studio/gpu-uniform-ring.ts';
import { LENS_GAUSSIAN_SIGMAS, lensGaussianReach, type LensFocus } from '../models/lens-focus.ts';
import {
  LENS_COMPOSITE, LENS_DEFOCUS, LENS_GLOW, LENS_ITEM_ROW, LENS_ITEMS, LENS_LAYING_BLEND, LENS_MOTION_BLEND, LENS_MOTION_GATHER, LENS_MOTION_TILES, LENS_OUTPUT, LENS_SUM, lensCompositeWgsl,
  lensDefocusWgsl, lensGlowWgsl, lensItemsWgsl, lensMotionGatherWgsl, lensMotionNeighboursWgsl, lensMotionTilesWgsl, lensOutputWgsl, lensPictureLayersKey, lensSumWgsl,
  type LensImageEncoding, type LensLaying, type LensPictureLayers,
} from './lens-passes.ts';

/** A similarity, plane points to frame px: p ↦ (ma + i·mb)·p + (kx + i·ky). */
export type LensView = { readonly ma: number; readonly mb: number; readonly kx: number; readonly ky: number };

/** A box of texels. */
export type LensBox = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/**
 * One layer of an exposure: `picture`, an array of `layers` (lens-passes.ts), placed and shown as LENS_COMPOSITE
 * says. `shutter`: its view as the shutter opens and closes, null for still. `distance`: how far it is from the
 * camera, unless its motion layer gives each texel's (`distances: 'texels'`).
 */
export type LensLayer = {
  readonly picture: GPUTextureView;
  readonly layers: LensPictureLayers;
  readonly view: LensView;
  readonly shutter: { readonly open: LensView; readonly close: LensView } | null;
  readonly origin: { readonly x: number; readonly y: number };
  readonly size: { readonly w: number; readonly h: number };
  readonly clipped: boolean;
  readonly distance: number;
  readonly distances: 'layer' | 'texels';
};

/**
 * One item laying an items layer's picture: `view` takes its plane points to frame px, as `shutter`'s do as the
 * shutter opens and closes (null for still); `distance` from the camera; `visibility` 0..1, the share of it laid.
 */
export type LensItem = {
  readonly view: LensView;
  readonly shutter: { readonly open: LensView; readonly close: LensView } | null;
  readonly distance: number;
  readonly visibility: number;
};

/**
 * One picture laid by many `items`, in order, each through its own view and clear past the picture's edge: `picture`,
 * `layers`, `origin` and `size` as a LensLayer's. Its motion layer, if any, isn't read: an item moves as its views do.
 */
export type LensItemsLayer = {
  readonly picture: GPUTextureView;
  readonly layers: LensPictureLayers;
  readonly origin: { readonly x: number; readonly y: number };
  readonly size: { readonly w: number; readonly h: number };
  readonly items: readonly LensItem[];
};

/**
 * What an exposure's layers hold. `glowing`: some layer has an emission. `moving`: the frame is one exposure whose
 * layers carry their motion, to be gathered along it.
 */
export type LensExposureDraw = { readonly glowing: boolean; readonly moving: boolean };

/** How a frame is developed: into `into` (a `format` target), `bloom` added, written as `encoding` says. */
export type LensDevelopDraw = { readonly bloom: LensBloom | null; readonly into: GPUTextureView; readonly format: GPUTextureFormat; readonly encoding: LensImageEncoding };

/**
 * A frame of `count` exposures (LensCompositor's beginFrame), taken in order: each composited, or handed in already
 * drawn through the camera, then the frame developed once all have arrived.
 */
export type LensFrameExposures = {
  readonly count: number;
  /** Composites the next exposure's `layers`, far to near; the first of several clears the sum, each adds its share. */
  exposure: (encoder: GPUCommandEncoder, layers: readonly (LensLayer | LensItemsLayer)[], draw: LensExposureDraw) => void;
  /**
   * Takes the next exposure already drawn through the camera: `image`, linear premultiplied light the lens's size,
   * read until the frame is developed when it's the only one.
   */
  exposureImage: (encoder: GPUCommandEncoder, image: GPUTextureView) => void;
  /** Develops the frame its exposures made. Throws unless every one has arrived. */
  develop: (encoder: GPUCommandEncoder, draw: LensDevelopDraw) => void;
};

/**
 * The frame's bloom: a gaussian of `sigma` frame px over its glow, times `strength`, added. The glow is the layers'
 * emission, or the frame's light past `threshold` (by luminance).
 */
export type LensBloom = { readonly sigma: number; readonly strength: number; readonly glow: 'emission' | { readonly threshold: number } };

/** A gaussian over `source`'s first texel at `sourceAt`, read within `read`, into `into`'s first texel at `box`'s corner. */
export type LensGaussianDraw = {
  readonly source: GPUTextureView; readonly into: GPUTextureView; readonly layers: number; readonly sigma: number;
  readonly read: LensBox; readonly sourceAt: { readonly x: number; readonly y: number }; readonly box: LensBox;
};

/**
 * A per-pixel defocus of `source`, a picture of colour and motion layers (lens-passes.ts) `size` texels, into `into`
 * (two layers, as big): each texel blurred by `focus` at its own distance, at most `most` px of sigma.
 */
export type LensDefocusDraw = {
  readonly source: GPUTextureView; readonly into: GPUTextureView; readonly size: { readonly w: number; readonly h: number };
  readonly focus: LensFocus; readonly most: number;
};

export type LensCompositor = {
  readonly width: number;
  readonly height: number;
  /** Begins a frame of `count` exposures; the frame begun before it, if still open, takes no more. */
  beginFrame: (count: number) => LensFrameExposures;
  /** A gaussian of `sigma` px (lens-focus.ts's reach) over boxes in one space, past `read` clear, within its blur extent. */
  gaussian: (encoder: GPUCommandEncoder, draw: LensGaussianDraw) => void;
  defocus: (encoder: GPUCommandEncoder, draw: LensDefocusDraw) => void;
  /** Uploads the uniforms encoded since the last flush: before every submit of an encoder the lens encoded into. */
  flush: () => void;
  dispose: () => void;
};

/** A compute pass's workgroup, 8 × 8. */
const LENS_WORKGROUP = 8;
/** The motion gather's tile, px, and so the farthest a point's half-motion reaches. */
const LENS_MOTION_TILE = 32;
/** The motion gather's samples a pixel, half along each of its two lines. */
const LENS_MOTION_TAPS = 24;
/** Distances within this share of each other count as one depth in the motion gather. */
const LENS_MOTION_SOFT = 0.02;

const clearing = (view: GPUTextureView): GPURenderPassColorAttachment => ({ view, loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' });
/** The composite's targets for `laying`, `has` saying which it holds besides colour. */
const layingTargets = (has: LensExposureDraw, laying: LensLaying): GPUColorTargetState[] => [
  { format: 'rgba16float', blend: LENS_LAYING_BLEND[laying] },
  ...(has.glowing ? [{ format: 'rgba16float' as const, blend: LENS_LAYING_BLEND[laying] }] : []),
  ...(has.moving ? [{ format: 'rgba16float' as const, blend: LENS_MOTION_BLEND, writeMask: laying === 'add' ? GPUColorWrite.ALL : 0 }] : []),
];
const view4 = ({ ma, mb, kx, ky }: LensView): [number, number, number, number] => [ma, mb, kx, ky];

/**
 * A lens for frames `width` × `height` on `device`; its targets and pipelines are made when a frame first asks.
 * `blurExtent`: the largest box a gaussian or defocus spans, its corner included (the frame when left out).
 */
export function createLensCompositor(device: GPUDevice, { width, height, blurExtent = { w: width, h: height } }: { width: number; height: number; blurExtent?: { w: number; h: number } }): LensCompositor {
  // Read here, not at load: a project's timeline test imports this module in Node, which has no GPU globals.
  const RENDER = GPUTextureUsage.RENDER_ATTACHMENT, STORAGE = GPUTextureUsage.STORAGE_BINDING, SAMPLED = GPUTextureUsage.TEXTURE_BINDING;
  const ring = createGpuUniformRing(device, { label: 'lens' }), itemRows = createGpuInstanceRing(device, { label: 'lens items', floats: LENS_ITEM_ROW.floats });
  const linearClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

  /** A target as drawn into or read whole (`view`) and as the gaussian reads and writes it (`array`). */
  type LensTarget = { texture: GPUTexture; view: GPUTextureView; array: GPUTextureView };
  const made: GPUTexture[] = [];
  const makeTarget = (name: string, w: number, h: number, format: GPUTextureFormat, usage: number, layers = 1): LensTarget => {
    const texture = device.createTexture({ label: `lens ${name}`, size: [w, h, layers], format, usage: usage | SAMPLED });
    made.push(texture);
    return { texture, view: texture.createView({ dimension: layers > 1 ? '2d-array' : '2d' }), array: texture.createView({ dimension: '2d-array' }) };
  };
  const kept = new Map<string, LensTarget>();
  const target = (name: string, w: number, h: number, format: GPUTextureFormat, usage: number) => {
    const key = `${name}|${w}|${h}`;
    if (!kept.has(key)) kept.set(key, makeTarget(name, w, h, format, usage));
    return kept.get(key)!;
  };
  const frameTarget = (name: string, format: GPUTextureFormat, usage: number) => target(name, width, height, format, usage);
  // The gaussian's first pass's target, by layer count, made once at the blur extent: one made larger later would
  // leave the smaller to passes encoded but not yet submitted.
  const acrosses = new Map<number, LensTarget>();
  const acrossFor = (w: number, h: number, layers: number) => {
    if (w > blurExtent.w || h > blurExtent.h) throw new Error(`lens: a ${w} × ${h} blur past its ${blurExtent.w} × ${blurExtent.h} blur extent`);
    if (!acrosses.has(layers)) acrosses.set(layers, makeTarget('across', blurExtent.w, blurExtent.h, 'rgba16float', STORAGE, layers));
    return acrosses.get(layers)!;
  };

  const computes = new Map<string, GPUComputePipeline>();
  const compute = (key: string, code: () => string) => {
    if (!computes.has(key)) computes.set(key, device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: code() }) } }));
    return computes.get(key)!;
  };
  const draws = new Map<string, GPURenderPipeline>();
  /** A render pipeline made once by `key`; `strip` draws instance rows (LENS_ITEM_ROW) as triangle strips. */
  const drawn = (key: string, code: () => string, colorTargets: readonly GPUColorTargetState[], strip = false) => {
    if (!draws.has(key)) {
      const module = device.createShaderModule({ code: code() });
      draws.set(key, device.createRenderPipeline({
        layout: 'auto', vertex: { module, buffers: strip ? [LENS_ITEM_ROW.layout] : [] }, fragment: { module, targets: [...colorTargets] },
        ...(strip && { primitive: { topology: 'triangle-strip' } }),
      }));
    }
    return draws.get(key)!;
  };
  /** Binds each of `resources` at its index; a null is a binding the pipeline doesn't have. */
  const bindGroup = (pipeline: GPURenderPipeline | GPUComputePipeline, resources: readonly (GPUBindingResource | null)[]) =>
    device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: resources.flatMap((resource, binding) => (resource ? [{ binding, resource }] : [])) });
  const dispatch = (encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, resources: readonly (GPUBindingResource | null)[], w: number, h: number) => {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup(pipeline, resources));
    pass.dispatchWorkgroups(Math.ceil(w / LENS_WORKGROUP), Math.ceil(h / LENS_WORKGROUP));
    pass.end();
  };
  const fullFrame = (encoder: GPUCommandEncoder, attachments: readonly GPURenderPassColorAttachment[], pipeline: GPURenderPipeline, resources: readonly (GPUBindingResource | null)[]) => {
    const pass = encoder.beginRenderPass({ colorAttachments: [...attachments] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup(pipeline, resources));
    pass.draw(3);
    pass.end();
  };

  const composited = {
    colour: () => frameTarget('colour', 'rgba16float', RENDER),
    emission: () => frameTarget('emission', 'rgba16float', RENDER),
    motion: () => frameTarget('motion', 'rgba16float', RENDER),
  };
  const sum = { colour: () => frameTarget('sum colour', 'rgba32float', RENDER), emission: () => frameTarget('sum emission', 'rgba32float', RENDER) };
  /** Adds `colour` and, when `glowing`, the composite's emission to the sum, exposure `index`'s share of `count`. */
  function addToSum(encoder: GPUCommandEncoder, colour: GPUTextureView, glowing: boolean, index: number, count: number) {
    const adding = LENS_LAYING_BLEND.add, loadOp: GPULoadOp = index === 0 ? 'clear' : 'load';
    const pipeline = drawn(`sum|${glowing}`, () => lensSumWgsl(glowing), [{ format: 'rgba32float', blend: adding }, { format: 'rgba32float', blend: adding }]);
    fullFrame(encoder, [sum.colour(), sum.emission()].map(({ view }) => ({ view, loadOp, clearValue: [0, 0, 0, 0], storeOp: 'store' as const })), pipeline, [
      ring.slot((views) => gpuUniformWriter(LENS_SUM, views)('weight', 1 / count)),
      colour,
      glowing ? composited.emission().view : null,
    ]);
  }

  /**
   * `layer`'s items into `pass`, in order, each its filter then its add: a film's colour and what it takes need two
   * blends, and one item laid whole before the next lays overlapping items as a picture each would.
   */
  function compositeItems(pass: GPURenderPassEncoder, layer: LensItemsLayer, has: LensExposureDraw) {
    const placed = itemRows.rows(layer.items.length, (floats) => layer.items.forEach((item, i) => {
      floats.set([...view4(item.view), ...view4(item.shutter?.open ?? item.view), ...view4(item.shutter?.close ?? item.view), item.distance, item.visibility], i * LENS_ITEM_ROW.floats);
    }));
    const uniform = ring.slot((views) => {
      const put = gpuUniformWriter(LENS_ITEMS, views);
      put('origin', [layer.origin.x, layer.origin.y]);
      put('size', [layer.size.w, layer.size.h]);
      put('frame', [width, height]);
    });
    const layings = (['filter', 'add'] as const satisfies readonly LensLaying[]).map((laying) => {
      const key = `items|${has.glowing}|${has.moving}|${lensPictureLayersKey(layer.layers)}|${laying}`;
      const pipeline = drawn(key, () => lensItemsWgsl(has, layer.layers, laying), layingTargets(has, laying), true);
      return { pipeline, group: bindGroup(pipeline, [uniform, layer.picture, linearClamp]) };
    });
    pass.setVertexBuffer(0, placed.buffer, placed.offset, placed.size);
    for (let item = 0; item < layer.items.length; item++) {
      for (const { pipeline, group } of layings) {
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(4, 1, 0, item);
      }
    }
  }

  /** Composites `layers` far to near into the composite's targets: colour, then emission and motion as `has` says. */
  function composite(encoder: GPUCommandEncoder, layers: readonly (LensLayer | LensItemsLayer)[], has: LensExposureDraw) {
    const attachments = [composited.colour(), ...(has.glowing ? [composited.emission()] : []), ...(has.moving ? [composited.motion()] : [])].map(({ view }) => clearing(view));
    const pass = encoder.beginRenderPass({ colorAttachments: attachments });
    for (const layer of layers) {
      if ('items' in layer) {
        if (layer.items.length) compositeItems(pass, layer, has);
        continue;
      }
      const { view, shutter } = layer;
      const uniform = ring.slot((views) => {
        const put = gpuUniformWriter(LENS_COMPOSITE, views);
        put('view', view4(view));
        put('open', view4(shutter?.open ?? view));
        put('close', view4(shutter?.close ?? view));
        put('origin', [layer.origin.x, layer.origin.y]);
        put('size', [layer.size.w, layer.size.h]);
        put('clipped', layer.clipped ? 1 : 0);
        put('distances', layer.distances === 'texels' ? 1 : 0);
        put('distance', layer.distance);
      });
      for (const laying of ['filter', 'add'] as const satisfies readonly LensLaying[]) {
        const key = `composite|${has.glowing}|${has.moving}|${lensPictureLayersKey(layer.layers)}|${laying}`;
        const pipeline = drawn(key, () => lensCompositeWgsl(has, layer.layers, laying), layingTargets(has, laying));
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup(pipeline, [uniform, layer.picture, linearClamp]));
        pass.draw(3);
      }
    }
    pass.end();
  }

  // The open frame: only it may add exposures, so a frame given up halfway can't leak into the next.
  let open: object | null = null;
  function beginFrame(count: number): LensFrameExposures {
    if (!(Number.isInteger(count) && count >= 1)) throw new Error(`lens: a frame takes a whole number of exposures, 1 or more, not ${count}`);
    const self = {};
    open = self;
    let arrived = 0, glowed = false, moving = false, image: GPUTextureView | null = null;
    const next = () => {
      if (open !== self) throw new Error('lens: an exposure added to a frame after another began');
      if (arrived === count) throw new Error(`lens: exposure ${arrived + 1} added to a frame of ${count}`);
      return arrived++;
    };
    return {
      count,
      exposure: (encoder, layers, draw) => {
        const index = next();
        glowed ||= draw.glowing;
        moving = count === 1 && draw.moving;
        composite(encoder, layers, { glowing: draw.glowing, moving });
        // Several exposures: each adds its share, emission too, so a glow in some exposures and not others averages.
        if (count > 1) addToSum(encoder, composited.colour().view, draw.glowing, index, count);
      },
      exposureImage: (encoder, drawnImage) => {
        const index = next();
        if (count === 1) image = drawnImage;
        else addToSum(encoder, drawnImage, false, index, count);
      },
      develop: (encoder, draw) => {
        if (open !== self) throw new Error('lens: a frame developed after another began');
        if (arrived < count) throw new Error(`lens: a frame developed with ${arrived} of its ${count} exposures`);
        open = null;
        const exposed = count === 1 ? composited : sum;
        developFrame(encoder, { colour: image ? { view: image } : exposed.colour(), emission: glowed ? exposed.emission() : null, moving }, draw);
      },
    };
  }

  function gaussian(encoder: GPUCommandEncoder, { source, into, layers, sigma, read, sourceAt, box }: LensGaussianDraw) {
    const pipeline = compute(`gaussian|${layers}`, () => gpuGaussianPassWgsl({ layers, read: 'texels', workgroup: LENS_WORKGROUP }));
    const across = acrossFor(box.x + box.w, box.y + box.h, layers);
    const pass = (from: GPUTextureView, to: GPUTextureView, axis: 0 | 1, readBox: LensBox, at: { x: number; y: number }, intoAt: { x: number; y: number }) => dispatch(encoder, pipeline, [ring.slot((views) => {
      const put = gpuUniformWriter(GPU_GAUSSIAN_PASS, views);
      put('sigma', sigma);
      put('reach', lensGaussianReach(sigma));
      put('axis', axis);
      put('read', [readBox.x, readBox.y, readBox.w, readBox.h]);
      put('box', [box.x, box.y, box.w, box.h]);
      put('sourceAt', [at.x, at.y]);
      put('intoAt', [intoAt.x, intoAt.y]);
    }), from, to], box.w, box.h);
    pass(source, across.array, 0, read, sourceAt, { x: 0, y: 0 });
    pass(across.array, into, 1, box, { x: 0, y: 0 }, box);
  }

  function defocus(encoder: GPUCommandEncoder, { source, into, size, focus, most }: LensDefocusDraw) {
    const pipeline = compute('defocus', () => lensDefocusWgsl(LENS_WORKGROUP));
    const across = acrossFor(size.w, size.h, 2);
    const pass = (from: GPUTextureView, to: GPUTextureView, axis: 0 | 1) => dispatch(encoder, pipeline, [ring.slot((views) => {
      const put = gpuUniformWriter(LENS_DEFOCUS, views);
      put('size', [size.w, size.h]);
      put('focus', focus.focus);
      put('aperture', focus.aperture);
      put('most', most);
      put('axis', axis);
      put('reach', Math.ceil(LENS_GAUSSIAN_SIGMAS * most));
    }), from, to], size.w, size.h);
    pass(source, across.array, 0);
    pass(across.array, into, 1);
  }

  /** The frame's colour and emission gathered along its motion. */
  function gatherMotion(encoder: GPUCommandEncoder, colour: { view: GPUTextureView }, emission: LensTarget | null) {
    const columns = Math.ceil(width / LENS_MOTION_TILE), rows = Math.ceil(height / LENS_MOTION_TILE);
    const tiles = target('motion tiles', columns, rows, 'rgba16float', STORAGE), near = target('motion near', columns, rows, 'rgba16float', STORAGE);
    const motion = composited.motion().view;
    dispatch(encoder, compute('motion tiles', () => lensMotionTilesWgsl(LENS_WORKGROUP)), [ring.slot((views) => {
      const put = gpuUniformWriter(LENS_MOTION_TILES, views);
      put('tile', LENS_MOTION_TILE);
      put('reach', LENS_MOTION_TILE);
    }), motion, tiles.view], columns, rows);
    dispatch(encoder, compute('motion near', () => lensMotionNeighboursWgsl(LENS_WORKGROUP)), [null, tiles.view, near.view], columns, rows);
    const gathered = frameTarget('gathered colour', 'rgba16float', STORAGE), gatheredEmission = emission && frameTarget('gathered emission', 'rgba16float', STORAGE);
    dispatch(encoder, compute(`motion gather|${!!emission}`, () => lensMotionGatherWgsl(!!emission, LENS_WORKGROUP)), [ring.slot((views) => {
      const put = gpuUniformWriter(LENS_MOTION_GATHER, views);
      put('tile', LENS_MOTION_TILE);
      put('taps', LENS_MOTION_TAPS);
      put('reach', LENS_MOTION_TILE);
      put('soft', LENS_MOTION_SOFT);
    }), colour.view, motion, near.view, gathered.view, emission?.view ?? null, gatheredEmission?.view ?? null], width, height);
    return { colour: gathered, emission: gatheredEmission };
  }

  /** `colour`'s light past `threshold`, into a target of its own. */
  function glowOf(encoder: GPUCommandEncoder, colour: { view: GPUTextureView }, threshold: number) {
    const glow = frameTarget('glow', 'rgba16float', STORAGE);
    dispatch(encoder, compute('glow', () => lensGlowWgsl(LENS_WORKGROUP)), [ring.slot((views) => gpuUniformWriter(LENS_GLOW, views)('threshold', threshold)), colour.view, glow.view], width, height);
    return glow;
  }

  /**
   * `glow` bloomed by `sigma` frame px at half the frame's size each way: wide glows are cheap, and the output reads it
   * back bilinear. Its first pass box-filters as it reads (gpu-gaussian.ts's `bilinear`).
   */
  function bloomOf(encoder: GPUCommandEncoder, glow: LensTarget, sigma: number) {
    const w = Math.ceil(width / 2), h = Math.ceil(height / 2), halfSigma = sigma / 2;
    const across = target('bloom across', w, h, 'rgba16float', STORAGE), bloomed = target('bloom', w, h, 'rgba16float', STORAGE);
    const pipeline = compute('gaussian|1|bilinear', () => gpuGaussianPassWgsl({ layers: 1, read: 'bilinear' satisfies GpuGaussianRead, workgroup: LENS_WORKGROUP }));
    const pass = (from: GPUTextureView, to: GPUTextureView, axis: 0 | 1, stride: number) => dispatch(encoder, pipeline, [ring.slot((views) => {
      const put = gpuUniformWriter(GPU_GAUSSIAN_PASS, views);
      put('sigma', halfSigma);
      put('reach', lensGaussianReach(halfSigma));
      put('axis', axis);
      put('stride', stride);
      put('box', [0, 0, w, h]);
    }), from, to, linearClamp], w, h);
    pass(glow.array, across.array, 0, width / w);
    pass(across.array, bloomed.array, 1, 1);
    return bloomed;
  }

  function developFrame(encoder: GPUCommandEncoder, exposed: { colour: { view: GPUTextureView }; emission: LensTarget | null; moving: boolean }, { bloom, into, format, encoding }: LensDevelopDraw) {
    let { colour, emission } = exposed;
    if (exposed.moving) ({ colour, emission } = gatherMotion(encoder, colour, emission));
    const glow = bloom && (bloom.glow === 'emission' ? emission : glowOf(encoder, colour, bloom.glow.threshold));
    const light = glow && bloom.sigma > 0 ? { view: bloomOf(encoder, glow, bloom.sigma).view, size: 'half' as const } : glow && { view: glow.view, size: 'whole' as const };
    const pipeline = drawn(`output|${light?.size}|${JSON.stringify(encoding)}|${format}`, () => lensOutputWgsl(light ? light.size : null, encoding), [{ format }]);
    fullFrame(encoder, [{ view: into, loadOp: 'clear', storeOp: 'store' }], pipeline, [
      light ? ring.slot((views) => gpuUniformWriter(LENS_OUTPUT, views)('strength', bloom!.strength)) : null,
      colour.view, light?.view ?? null, light?.size === 'half' ? linearClamp : null,
    ]);
  }

  return {
    width, height, beginFrame, gaussian, defocus,
    flush: () => {
      ring.flush();
      itemRows.flush();
    },
    dispose: () => {
      for (const texture of made.splice(0)) texture.destroy();
      kept.clear();
      acrosses.clear();
      ring.destroy();
      itemRows.destroy();
    },
  };
}

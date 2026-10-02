// lens-compositor.ts: the studio's one lens on the GPU, for painted planes and three.js alike. A frame is one or
// more exposures (lens-exposures.ts), each its layers composited far to near; several are averaged in a 32-bit sum.
// One exposure that moved is gathered along its motion instead. Then what glows is bloomed once, and the image
// written. lens-passes.ts holds the passes.
//
// Warning: it encodes into its caller's command encoder, and its uniforms go up with `flush`, which the caller runs
// before each submit.

import { GPU_GAUSSIAN_PASS, gpuGaussianPassWgsl } from '#lib/platform/gpu/models/gpu-gaussian.ts';
import { gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { createGpuUniformRing } from '#lib/platform/gpu/studio/gpu-uniform-ring.ts';
import { LENS_GAUSSIAN_SIGMAS, lensGaussianReach, type LensFocus } from '../models/lens-focus.ts';
import {
  LENS_COMPOSITE, LENS_DEFOCUS, LENS_GLOW, LENS_LAYING_BLEND, LENS_MOTION_BLEND, LENS_MOTION_GATHER, LENS_MOTION_TILES, LENS_OUTPUT, LENS_SUM, lensCompositeWgsl, lensDefocusWgsl, lensGlowWgsl,
  lensMotionGatherWgsl, lensMotionNeighboursWgsl, lensMotionTilesWgsl, lensOutputWgsl, lensPictureLayersKey, lensSumWgsl,
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
 * An exposure's place in its frame. `glowing`: some layer has an emission. `moving`: the frame is one exposure whose
 * layers carry their motion, to be gathered along it.
 */
export type LensExposureDraw = { readonly index: number; readonly count: number; readonly glowing: boolean; readonly moving: boolean };

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
  /** Composites one exposure's `layers`, far to near; the first of several clears the sum, each adds its share. */
  exposure: (encoder: GPUCommandEncoder, layers: readonly LensLayer[], draw: LensExposureDraw) => void;
  /**
   * Takes one exposure already drawn through the camera: `image`, linear premultiplied light the lens's size, read
   * until the frame is developed when it's the only one.
   */
  exposureImage: (encoder: GPUCommandEncoder, image: GPUTextureView, draw: Pick<LensExposureDraw, 'index' | 'count'>) => void;
  /** Develops the frame its exposures made into `into` (a `format` target), `bloom` added, written as `encoding` says. */
  develop: (encoder: GPUCommandEncoder, frame: { bloom: LensBloom | null; into: GPUTextureView; format: GPUTextureFormat; encoding: LensImageEncoding }) => void;
  /** A gaussian of `sigma` px (lens-focus.ts's reach) over boxes in one space, past `read` clear. */
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
/** The motion gather's samples a pixel. */
const LENS_MOTION_TAPS = 15;
/** Distances within this share of each other count as one depth in the motion gather. */
const LENS_MOTION_SOFT = 0.02;

const clearing = (view: GPUTextureView): GPURenderPassColorAttachment => ({ view, loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' });

/** A lens for frames `width` × `height` on `device`; its targets and pipelines are made when a frame first asks. */
export function createLensCompositor(device: GPUDevice, { width, height }: { width: number; height: number }): LensCompositor {
  // Read here, not at load: a project's timeline test imports this module in Node, which has no GPU globals.
  const RENDER = GPUTextureUsage.RENDER_ATTACHMENT, STORAGE = GPUTextureUsage.STORAGE_BINDING, SAMPLED = GPUTextureUsage.TEXTURE_BINDING;
  const ring = createGpuUniformRing(device, { label: 'lens' });
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
  // The gaussian's first pass's scratch, by layer count: grown to the largest asked for, never shrunk. One
  // outgrown stays until dispose, as passes encoded but not yet submitted may still read it.
  const acrosses = new Map<number, LensTarget>();
  const acrossFor = (w: number, h: number, layers: number) => {
    const have = acrosses.get(layers);
    if (have && have.texture.width >= w && have.texture.height >= h) return have;
    const grown = makeTarget('across', Math.max(w, have?.texture.width ?? 0), Math.max(h, have?.texture.height ?? 0), 'rgba16float', STORAGE, layers);
    acrosses.set(layers, grown);
    return grown;
  };

  const computes = new Map<string, GPUComputePipeline>();
  const compute = (key: string, code: () => string) => {
    if (!computes.has(key)) computes.set(key, device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: code() }) } }));
    return computes.get(key)!;
  };
  const draws = new Map<string, GPURenderPipeline>();
  const drawn = (key: string, code: () => string, colorTargets: readonly GPUColorTargetState[]) => {
    if (!draws.has(key)) {
      const module = device.createShaderModule({ code: code() });
      draws.set(key, device.createRenderPipeline({ layout: 'auto', vertex: { module }, fragment: { module, targets: [...colorTargets] } }));
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
  // What the exposures so far leave for develop: a lone exposure drawn elsewhere is read where it was drawn.
  let frame: { count: number; glowed: boolean; moving: boolean; image: GPUTextureView | null } | null = null;
  const frameAt = (index: number, count: number) => {
    if (index === 0) frame = { count, glowed: false, moving: false, image: null };
    if (frame?.count !== count) throw new Error(`lens: exposure ${index} of ${count} drawn into a frame of ${frame?.count ?? 'none'}`);
    return frame;
  };

  /** Adds `colour` and, when `glowing`, the composite's emission to the sum, its share of `count`. */
  function addToSum(encoder: GPUCommandEncoder, colour: GPUTextureView, glowing: boolean, index: number, count: number) {
    const adding = LENS_LAYING_BLEND.add, loadOp: GPULoadOp = index === 0 ? 'clear' : 'load';
    const pipeline = drawn(`sum|${glowing}`, () => lensSumWgsl(glowing), [{ format: 'rgba32float', blend: adding }, { format: 'rgba32float', blend: adding }]);
    fullFrame(encoder, [sum.colour(), sum.emission()].map(({ view }) => ({ view, loadOp, clearValue: [0, 0, 0, 0], storeOp: 'store' as const })), pipeline, [
      ring.slot((views) => gpuUniformWriter(LENS_SUM, views)('weight', 1 / count)),
      colour,
      glowing ? composited.emission().view : null,
    ]);
  }

  function exposureImage(encoder: GPUCommandEncoder, image: GPUTextureView, { index, count }: Pick<LensExposureDraw, 'index' | 'count'>) {
    const at = frameAt(index, count);
    if (count === 1) at.image = image;
    else addToSum(encoder, image, false, index, count);
  }

  function exposure(encoder: GPUCommandEncoder, layers: readonly LensLayer[], { index, count, glowing, moving }: LensExposureDraw) {
    const at = frameAt(index, count);
    at.glowed ||= glowing;
    at.moving = count === 1 && moving;
    const has = { glowing, moving: at.moving };
    const attachments = [composited.colour(), ...(glowing ? [composited.emission()] : []), ...(has.moving ? [composited.motion()] : [])].map(({ view }) => clearing(view));
    const pass = encoder.beginRenderPass({ colorAttachments: attachments });
    for (const layer of layers) {
      const { view, shutter } = layer;
      const uniform = ring.slot((views) => {
        const put = gpuUniformWriter(LENS_COMPOSITE, views);
        const open = shutter?.open ?? view, close = shutter?.close ?? view;
        put('view', [view.ma, view.mb, view.kx, view.ky]);
        put('open', [open.ma, open.mb, open.kx, open.ky]);
        put('close', [close.ma, close.mb, close.kx, close.ky]);
        put('origin', [layer.origin.x, layer.origin.y]);
        put('size', [layer.size.w, layer.size.h]);
        put('clipped', layer.clipped ? 1 : 0);
        put('distances', layer.distances === 'texels' ? 1 : 0);
        put('distance', layer.distance);
      });
      for (const laying of ['filter', 'add'] as const satisfies readonly LensLaying[]) {
        const colorTargets: GPUColorTargetState[] = [
          { format: 'rgba16float', blend: LENS_LAYING_BLEND[laying] },
          ...(glowing ? [{ format: 'rgba16float' as const, blend: LENS_LAYING_BLEND[laying] }] : []),
          ...(has.moving ? [{ format: 'rgba16float' as const, blend: LENS_MOTION_BLEND, writeMask: laying === 'add' ? GPUColorWrite.ALL : 0 }] : []),
        ];
        const key = `composite|${glowing}|${has.moving}|${lensPictureLayersKey(layer.layers)}|${laying}`;
        const pipeline = drawn(key, () => lensCompositeWgsl(has, layer.layers, laying), colorTargets);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup(pipeline, [uniform, layer.picture, linearClamp]));
        pass.draw(3);
      }
    }
    pass.end();
    // Several exposures: each adds its share, emission too, so a glow in some exposures and not others averages.
    if (count > 1) addToSum(encoder, composited.colour().view, glowing, index, count);
  }

  function gaussian(encoder: GPUCommandEncoder, { source, into, layers, sigma, read, sourceAt, box }: LensGaussianDraw) {
    const pipeline = compute(`gaussian|${layers}`, () => gpuGaussianPassWgsl({ layers, read: 'texels', workgroup: LENS_WORKGROUP }));
    const across = acrossFor(Math.max(width, box.x + box.w), Math.max(height, box.y + box.h), layers);
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

  function develop(encoder: GPUCommandEncoder, { bloom, into, format, encoding }: { bloom: LensBloom | null; into: GPUTextureView; format: GPUTextureFormat; encoding: LensImageEncoding }) {
    if (!frame) throw new Error('lens: a frame developed before any exposure');
    const { count, glowed, moving, image } = frame;
    frame = null;
    const exposed = count === 1 ? composited : sum;
    let colour: { view: GPUTextureView } = image ? { view: image } : exposed.colour(), emission = glowed ? exposed.emission() : null;
    if (moving) ({ colour, emission } = gatherMotion(encoder, colour, emission));
    let light: LensTarget | null = null;
    if (bloom) {
      const glow = bloom.glow === 'emission' ? emission : glowOf(encoder, colour, bloom.glow.threshold);
      if (glow && bloom.sigma > 0) {
        const bloomed = frameTarget('bloom', 'rgba16float', STORAGE), whole: LensBox = { x: 0, y: 0, w: width, h: height };
        gaussian(encoder, { source: glow.array, into: bloomed.array, layers: 1, sigma: bloom.sigma, read: whole, sourceAt: whole, box: whole });
        light = bloomed;
      } else light = glow;
    }
    const pipeline = drawn(`output|${!!light}|${JSON.stringify(encoding)}|${format}`, () => lensOutputWgsl(!!light, encoding), [{ format }]);
    fullFrame(encoder, [{ view: into, loadOp: 'clear', storeOp: 'store' }], pipeline, [
      light ? ring.slot((views) => gpuUniformWriter(LENS_OUTPUT, views)('strength', bloom!.strength)) : null,
      colour.view, light?.view ?? null,
    ]);
  }

  return {
    width, height, exposure, exposureImage, develop, gaussian, defocus,
    flush: ring.flush,
    dispose: () => {
      for (const texture of made.splice(0)) texture.destroy();
      kept.clear();
      acrosses.clear();
      ring.destroy();
    },
  };
}

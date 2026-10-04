// stamp-plane-picture-pass.ts: a painted plane's picture as the lens takes it (lens-passes.ts), kept in the device's
// cache (ENGINE 6.2). The back is laid on its paper; a nearer plane is laid on white, its light measured, laid again on
// black, and the picture pass reads what it lets through against the backings' own light. Defocused, a picture is
// blurred by a stepped sigma. The old renderer and a shot's painted planes both draw theirs here, each under a key
// naming what makes its pixels, so a plane held still is laid once.

import { gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { lensGaussianReach, lensSigmaStepped } from '#lib/picture/lens/models/lens-focus.ts';
import type { LensCompositor } from '#lib/picture/lens/studio/lens-compositor.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import { stampStageTexelsGrown, type StampStage } from '../models/stamp-stage.ts';
import type { StampPaintCompositor } from './stamp-paint-compositor.ts';
import { clearStampTarget, dispatchStampCompute, STAMP_WORKGROUP, stampArrayView } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import type { StampPaintBacking } from './stamp-paint-lay-pass.ts';
import {
  STAMP_PLANE_LIGHT, STAMP_PLANE_PICTURE, stampPlaneLightWgsl, stampPlanePictureLayerCount, stampPlanePictureWgsl, type StampPlanePictureLayers,
} from './stamp-paint-plane-passes.ts';
import type { StampUniformArena } from './stamp-uniform-arena.ts';

/** A plane's picture on the device: its layers (by its kind), its texture, and its box in stage texels. */
export type StampPlanePicture = StampPlanePictureLayers & { readonly box: StampPixelBox; readonly texture: GPUTexture };

/**
 * A plane laid into its picture under `key`: its compositor, painting (a storage view), layers, emission and motion
 * targets (cleared here) and visibility. `paper` lays a backing over the painting's first `w` × `h` texels; `lay` lays
 * the plane on `backing`, returning the stage texels laid (null: none). Only its first lay writes glow and motion.
 */
export type StampPlanePictureLay = {
  readonly key: string;
  readonly compositor: StampPaintCompositor;
  readonly painting: GPUTextureView;
  readonly layers: StampPlanePictureLayers;
  readonly emission: GPUTextureView | null;
  readonly motion: GPUTextureView | null;
  readonly visibility: number;
  readonly paper: (backing: 'white' | 'black', w: number, h: number) => void;
  readonly lay: (backing: StampPaintBacking) => StampPixelBox | null;
};

type StampPictureNote = StampPlanePictureLayers & { readonly box: StampPixelBox };

/**
 * Plane pictures on `owner`'s device over `stage`, kept in its cache's `picture` and `blurred` stores (given up on
 * dispose), each pass's uniform from `arena`.
 */
export function createStampPlanePictures(owner: StampPaintGpuOwner, { stage, arena }: { readonly stage: StampStage; readonly arena: StampUniformArena }) {
  const device = owner.device, STORAGE = GPUTextureUsage.STORAGE_BINDING;
  const pictures = owner.cache.store<StampPictureNote>('picture'), blurred = owner.cache.store<StampPictureNote>('blurred');
  // The measuring backings' own light, white at layer 0 and black at 1, a texel each (a plain backing lays alike
  // everywhere), per compositor: its paper and output make it. Measured in the first frame laying a clear plane.
  const lights = owner.cache.store<null>('picture');
  const pipeline = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });

  /** The painting's linear light over `box` (stage texels) into array layer `layer` of `into`, from its first texel. */
  function measureLight(encoder: GPUCommandEncoder, compositor: StampPaintCompositor, painting: GPUTextureView, box: StampPixelBox, into: GPUTexture, layer: number) {
    dispatchStampCompute(device, encoder, pipeline(stampPlaneLightWgsl(compositor, STAMP_WORKGROUP)), [arena.slot((views) => {
      const put = gpuUniformWriter(STAMP_PLANE_LIGHT, views);
      put('origin', [box.x, box.y]);
      put('extent', [box.w, box.h]);
      put('layer', layer);
    }), painting, stampArrayView(into)], box.w, box.h);
  }

  /** The backings' light for `plane`'s compositor: kept, or measured on its painting's first texel before it's laid. */
  function backingLight(encoder: GPUCommandEncoder, plane: StampPlanePictureLay): GPUTexture {
    const key = `${plane.compositor.paper}\n${plane.compositor.output}`, found = lights.find(key, encoder);
    if (found) return found.textures[0];
    const [light] = lights.make(key, encoder, [{ width: 1, height: 1, layers: 2, format: 'rgba16float', usage: STORAGE | GPUTextureUsage.TEXTURE_BINDING }], null).textures;
    for (const [layer, backing] of (['white', 'black'] as const).entries()) {
      plane.paper(backing, 1, 1);
      measureLight(encoder, plane.compositor, plane.painting, { x: 0, y: 0, w: 1, h: 1 }, light, layer);
    }
    return light;
  }

  return {
    /** The picture kept under `key`, as `encoder`'s frame uses it; null for none. */
    find(key: string, encoder: GPUCommandEncoder): StampPlanePicture | null {
      const found = pictures.find(key, encoder);
      return found && { ...found.note, texture: found.textures[0] };
    },
    /**
     * `plane` laid into its picture and kept under its key: a paper picture over the stage, a film over what its first
     * lay laid. Null for a film that lays nothing.
     */
    paint(encoder: GPUCommandEncoder, plane: StampPlanePictureLay): StampPlanePicture | null {
      const { layers, compositor, painting } = plane, film = layers.kind === 'film';
      for (const target of [plane.emission, plane.motion]) if (target) clearStampTarget(encoder, target);
      const light = film ? backingLight(encoder, plane) : null;
      const laid = plane.lay(film ? 'white' : 'paper'), box = film ? laid : { x: 0, y: 0, w: stage.width, h: stage.height };
      if (!box) return null;
      const note: StampPictureNote = { ...layers, box };
      const [texture] = pictures.make(plane.key, encoder, [{ width: box.w, height: box.h, layers: stampPlanePictureLayerCount(layers), format: 'rgba16float', usage: STORAGE | GPUTextureUsage.TEXTURE_BINDING }], note).textures;
      if (film) {
        // Between the lays the picture's colour layer holds the light on white over its box; the picture pass replaces it.
        measureLight(encoder, compositor, painting, box, texture, 0);
        plane.lay('black');
      }
      dispatchStampCompute(device, encoder, pipeline(stampPlanePictureWgsl(compositor, layers, STAMP_WORKGROUP)), [arena.slot((views) => {
        const put = gpuUniformWriter(STAMP_PLANE_PICTURE, views);
        put('origin', [box.x, box.y]);
        put('extent', [box.w, box.h]);
        put('visibility', plane.visibility);
      }), painting, plane.emission, stampArrayView(texture), light && stampArrayView(light), plane.motion], box.w, box.h);
      return { ...note, texture };
    },
    /**
     * `picture` (kept under `key`) defocused by `sigma` stage px through `lens`, kept under its key and the stepped
     * sigma, its box grown by the blur's reach; the picture itself where the sigma steps to nothing. `fresh`: the
     * picture was laid anew under a key it was kept under before, so what was blurred of it then is stale.
     */
    blurred(encoder: GPUCommandEncoder, lens: Pick<LensCompositor, 'gaussian'>, picture: StampPlanePicture, key: string, sigma: number, fresh = false): StampPlanePicture {
      const stepped = lensSigmaStepped(sigma), blurredKey = `${key}|${stepped}`;
      if (!stepped) return picture;
      const found = fresh ? null : blurred.find(blurredKey, encoder);
      if (found) return { ...found.note, texture: found.textures[0] };
      const { texture: sharp, box: sharpBox, ...layers } = picture;
      const box = stampStageTexelsGrown(stage, sharpBox, lensGaussianReach(stepped)), count = sharp.depthOrArrayLayers, note: StampPictureNote = { ...layers, box };
      const [texture] = blurred.make(blurredKey, encoder, [{ width: box.w, height: box.h, layers: count, format: 'rgba16float', usage: STORAGE | GPUTextureUsage.TEXTURE_BINDING }], note).textures;
      lens.gaussian(encoder, { source: stampArrayView(sharp), into: stampArrayView(texture), layers: count, sigma: stepped, read: sharpBox, sourceAt: sharpBox, box });
      return { ...note, texture };
    },
    /** Gives up every picture kept, once the frames reading them are submitted. */
    dispose() {
      pictures.dispose();
      blurred.dispose();
      lights.dispose();
    },
  };
}

export type StampPlanePictures = ReturnType<typeof createStampPlanePictures>;

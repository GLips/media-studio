// stamp-picture-sources.ts: picture planes' sources worked out on the CPU (StampPictureAt), each picture uploaded to
// the device as the lens source the renderer lays (stamp-lens-source.ts).

import { gpuHalfBitsOf } from '#lib/platform/gpu/models/gpu-half-float.ts';
import { paintMoment } from '../models/stamp-paint-frame-state.ts';
import type { StampPictureAt, StampPictureRgba } from '../models/stamp-plane.ts';
import type { StampPictureLensSource } from './stamp-lens-source.ts';

export type StampPictureSourcesLoaded = { readonly sources: ReadonlyMap<string, StampPictureLensSource>; readonly dispose: () => void };

/**
 * `pictures` as lens sources on `device`: each render asks for its picture at the frame's moment, or its exposure's,
 * and writes it into a texture of the plane's, made anew only when the picture's size changes. A picture handed back
 * again, the same object, is already there: a still plane uploads once.
 */
export function loadStampPictureSources(device: GPUDevice, pictures: ReadonlyMap<string, StampPictureAt>): StampPictureSourcesLoaded {
  const textures = new Map<string, GPUTexture>(), uploaded = new Map<string, StampPictureRgba>();
  // Destroyed once the draws already submitted are done with it, as WebGPU defers a destroy.
  const textureFor = (id: string, w: number, h: number) => {
    const held = textures.get(id);
    if (held?.width === w && held.height === h) return held;
    held?.destroy();
    const made = device.createTexture({ label: `picture ${id}`, size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    textures.set(id, made);
    return made;
  };
  const sources = new Map([...pictures].map(([id, pictureAt]): [string, StampPictureLensSource] => [id, {
    kind: 'picture',
    render: async (t, exposure) => {
      const picture = await pictureAt(paintMoment(exposure?.at ?? t, t));
      if (!picture) return null;
      const { box, rgba } = picture;
      if (uploaded.get(id) === picture) return { texture: textures.get(id)!, box };
      if (rgba.length !== box.w * box.h * 4) throw new Error(`picture plane ${id}: its picture holds ${rgba.length} floats, and its ${box.w} × ${box.h} box takes ${box.w * box.h * 4}`);
      const texture = textureFor(id, box.w, box.h);
      device.queue.writeTexture({ texture }, gpuHalfBitsOf(rgba), { bytesPerRow: box.w * 8 }, [box.w, box.h]);
      uploaded.set(id, picture);
      return { texture, box };
    },
  }]));
  return {
    sources,
    dispose: () => {
      for (const texture of textures.values()) texture.destroy();
      textures.clear();
      uploaded.clear();
    },
  };
}

// stamp-picture-sources.ts: picture planes' sources worked out on the CPU (StampPictureAt), each picture uploaded to
// the device as the lens source the renderer lays (stamp-lens-source.ts).

import { gpuHalfBitsOf } from '#lib/platform/gpu/models/gpu-half-float.ts';
import { paintMoment } from '../models/stamp-paint-frame-state.ts';
import type { StampPictureAt, StampPictureRgba } from '../models/stamp-plane.ts';
import type { StampPictureLensSource } from './stamp-lens-source.ts';

export type StampPictureSourcesLoaded = { readonly sources: ReadonlyMap<string, StampPictureLensSource>; readonly dispose: () => void };

/**
 * `pictures` as lens sources on `device`: each render writes its picture at the frame's (or exposure's) moment into
 * the plane's texture, clearing what the last left past its box. The texture only grows, so a box changing every frame
 * doesn't remake it; the same picture object handed back isn't uploaded again.
 */
export function loadStampPictureSources(device: GPUDevice, pictures: ReadonlyMap<string, StampPictureAt>): StampPictureSourcesLoaded {
  const held = new Map<string, { texture: GPUTexture; picture: StampPictureRgba }>();
  /** Plane `id`'s texture, at least `w` × `h`, its first `w` × `h` texels to be written and clear past them up to `before`. */
  const textureFor = (id: string, w: number, h: number, before: { w: number; h: number } | null) => {
    const texture = held.get(id)?.texture;
    if (texture && texture.width >= w && texture.height >= h) {
      if (before) clearPast(texture, { w, h }, before);
      return texture;
    }
    // Destroyed once the draws already submitted are done with it, as WebGPU defers a destroy.
    texture?.destroy();
    const size = { w: Math.max(w, texture?.width ?? 0), h: Math.max(h, texture?.height ?? 0) };
    return device.createTexture({ label: `picture ${id}`, size: [size.w, size.h], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  };
  /** Zeroes what lay within `before` and past `box` in `texture`: the strip right of it, then the one below. */
  const clearPast = (texture: GPUTexture, box: { w: number; h: number }, before: { w: number; h: number }) => {
    for (const [x, y, w, h] of [[box.w, 0, before.w - box.w, before.h], [0, box.h, Math.min(box.w, before.w), before.h - box.h]]) {
      if (w > 0 && h > 0) device.queue.writeTexture({ texture, origin: { x, y } }, new Uint16Array(w * h * 4), { bytesPerRow: w * 8 }, [w, h]);
    }
  };
  const sources = new Map([...pictures].map(([id, pictureAt]): [string, StampPictureLensSource] => [id, {
    kind: 'picture',
    render: async (t, exposure) => {
      const picture = await pictureAt(paintMoment(exposure?.at ?? t, t));
      if (!picture) return null;
      const { box, rgba } = picture, before = held.get(id);
      if (before?.picture === picture) return { texture: before.texture, box };
      if (rgba.length !== box.w * box.h * 4) throw new Error(`picture plane ${id}: its picture holds ${rgba.length} floats, and its ${box.w} × ${box.h} box takes ${box.w * box.h * 4}`);
      const texture = textureFor(id, box.w, box.h, before ? before.picture.box : null);
      device.queue.writeTexture({ texture }, gpuHalfBitsOf(rgba), { bytesPerRow: box.w * 8 }, [box.w, box.h]);
      held.set(id, { texture, picture });
      return { texture, box };
    },
  }]));
  return {
    sources,
    dispose: () => {
      for (const { texture } of held.values()) texture.destroy();
      held.clear();
    },
  };
}

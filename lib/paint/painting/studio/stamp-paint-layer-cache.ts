// stamp-paint-layer-cache.ts: each settled group's painted layer, kept so a frame laying it elsewhere (a camera moving
// every group each frame) copies it back rather than painting it again. A group's layer starts clear and its deposits
// read nothing laid before them, so once settled it's a function of the group and its marks (the plan's paintKey):
// equal keys, equal texels, whatever frame came first.
//
// An entry holds the painted box grown by the lay's reach; the rest of the layer target, which no lay reads, keeps
// whatever it held. Checkpoints (stamp-paint-checkpoints.ts) copy whole targets by event; an entry is a box, by group.

import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';

/** The most a renderer's cached layers hold, bytes: a 1080p pigment painting's background and a dozen smaller groups. */
export const STAMP_LAYER_CACHE_BUDGET = 512 * 1024 * 1024;

/** How far past its painted box a group's lay reads its layer, px: the lattice's held test and four-tap read. */
export const STAMP_LAYER_CACHE_READ_REACH = 2;

/** A cached layer as a frame uses it: the painted box in the target's texels, null where the group painted nothing. */
export type StampCachedLayer = { painted: StampPixelBox | null };

/** `encoder`: the last frame's to copy into or out of it, whose commands may be unsubmitted yet. */
type Entry = { key: string; painted: StampPixelBox | null; held: StampPixelBox | null; texture: GPUTexture | null; bytes: number; used: number; encoder: GPUCommandEncoder | null };

export type StampPaintLayerCache = {
  /** Copies the entry under `key` back into the layer target and returns it, or null for none. */
  restore: (encoder: GPUCommandEncoder, key: string) => StampCachedLayer | null;
  /** The entry under `key`, copying nothing, or null for none. */
  peek: (key: string) => StampCachedLayer | null;
  /** Keeps the layer target, as it'll stand at this point in `encoder`, under `key`: its `painted` box and the reach a lay reads. */
  save: (encoder: GPUCommandEncoder, key: string, painted: StampPixelBox | null) => void;
  /** Destroys every entry's texture, once the frames that copied them are submitted. */
  dispose: () => void;
};

/**
 * Cached layers of `layer` (a stage-sized texture, any array layers) on `device`, within `budget` bytes, least
 * recently used given up first. Each frame's encoder is submitted before the next is made, so an entry the current
 * encoder doesn't touch can be destroyed. One that can't fit isn't kept.
 */
export function stampPaintLayerCache(device: StampPaintDevice, layer: GPUTexture, budget = STAMP_LAYER_CACHE_BUDGET): StampPaintLayerCache {
  const entries = new Map<string, Entry>();
  const layers = layer.depthOrArrayLayers;
  let clock = 0;
  /** `painted` grown by the lay's reach, held to the target. */
  const heldBox = (painted: StampPixelBox): StampPixelBox => {
    const x = Math.max(0, painted.x - STAMP_LAYER_CACHE_READ_REACH), y = Math.max(0, painted.y - STAMP_LAYER_CACHE_READ_REACH);
    return { x, y, w: Math.min(layer.width, painted.x + painted.w + STAMP_LAYER_CACHE_READ_REACH) - x, h: Math.min(layer.height, painted.y + painted.h + STAMP_LAYER_CACHE_READ_REACH) - y };
  };
  return {
    restore(encoder, key) {
      const found = entries.get(key);
      if (!found) return null;
      found.used = ++clock;
      found.encoder = encoder;
      if (found.texture && found.held) {
        const { x, y, w, h } = found.held;
        encoder.copyTextureToTexture({ texture: found.texture }, { texture: layer, origin: { x, y, z: 0 } }, [w, h, layers]);
      }
      return { painted: found.painted };
    },
    peek(key) {
      const found = entries.get(key);
      return found ? { painted: found.painted } : null;
    },
    save(encoder, key, painted) {
      const again = entries.get(key);
      if (again) {
        again.used = ++clock;
        return;
      }
      const held = painted && heldBox(painted), bytes = held ? held.w * held.h * layers * 8 : 0;
      let total = [...entries.values()].reduce((sum, e) => sum + e.bytes, 0);
      const givable = [...entries.values()].filter((e) => e.encoder !== encoder).toSorted((a, b) => a.used - b.used);
      const given: Entry[] = [];
      while (total + bytes > budget && givable.length) {
        const e = givable.shift()!;
        given.push(e);
        total -= e.bytes;
      }
      if (total + bytes > budget) return;
      for (const e of given) {
        entries.delete(e.key);
        e.texture?.destroy();
      }
      const texture = held && device.createTexture({ size: [held.w, held.h, layers], format: layer.format, usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
      if (texture && held) encoder.copyTextureToTexture({ texture: layer, origin: { x: held.x, y: held.y, z: 0 } }, { texture }, [held.w, held.h, layers]);
      entries.set(key, { key, painted, held, texture, bytes, used: ++clock, encoder });
    },
    dispose() {
      for (const { texture } of entries.values()) texture?.destroy();
      entries.clear();
    },
  };
}

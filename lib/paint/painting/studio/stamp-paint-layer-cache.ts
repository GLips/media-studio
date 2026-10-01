// stamp-paint-layer-cache.ts: each settled group's painted layer, kept so a frame laying it elsewhere (a camera moving
// every group each frame) copies it back rather than painting it again. A group's layer starts clear and reads
// nothing laid before it, so once settled it's a function of its marks (the plan's paintKey): equal keys, equal texels.
//
// An entry holds the painted box grown by the lay's reach; the rest of the layer target, which no lay reads, keeps
// whatever it held. Checkpoints (stamp-paint-checkpoints.ts) copy whole targets by event; an entry is a box, by group.
//
// One budget per device, shared by its renderers (a painted three scene has several), least recently used given up.

import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';

/** The most the cached layers on one device hold, bytes: a 1080p pigment painting's background and a dozen smaller groups. */
export const STAMP_LAYER_CACHE_BUDGET = 512 * 1024 * 1024;

/** How far past its painted box a group's lay reads its layer, px: the lattice's held test and four-tap read. */
export const STAMP_LAYER_CACHE_READ_REACH = 2;

/** A cached layer as a frame uses it: the painted box in the target's texels, null where the group painted nothing. */
export type StampCachedLayer = { painted: StampPixelBox | null };

/** `encoder`: the last frame's to copy into or out of it, whose commands may be unsubmitted yet. */
type Entry = { key: string; painted: StampPixelBox | null; held: StampPixelBox | null; texture: GPUTexture | null; bytes: number; used: number; encoder: GPUCommandEncoder | null; drop: () => void };

/** Every cache's entries on one device, under its one budget, and the clock their use is told by. */
type StampLayerCachePool = { entries: Set<Entry>; bytes: number; clock: number };

// Keyed by the device's queue: each surface wraps its device anew (cachingStampPaintDevice), and every wrapper of one
// device hands on its one queue.
const pools = new WeakMap<GPUQueue, StampLayerCachePool>();

export type StampPaintLayerCache = {
  /** Copies the entry under `key` back into the layer target and returns it, or null for none. */
  restore: (encoder: GPUCommandEncoder, key: string) => StampCachedLayer | null;
  /** The entry under `key`, copying nothing, or null for none; it counts as used, as what it stands for is about to be. */
  peek: (key: string) => StampCachedLayer | null;
  /** Keeps the layer target, as it'll stand at this point in `encoder`, under `key`: its `painted` box and the reach a lay reads. */
  save: (encoder: GPUCommandEncoder, key: string, painted: StampPixelBox | null) => void;
  /** Destroys every entry's texture, once the frames that copied them are submitted. */
  dispose: () => void;
};

/**
 * Cached layers of `layer` (a stage-sized texture, any array layers) on `device`, within the device's one budget. A
 * renderer submits each frame's encoder before any renderer makes the next, so an entry the current encoder doesn't
 * touch can be destroyed. One that can't fit isn't kept; with `keeps` false none is, to measure what they save.
 */
export function stampPaintLayerCache(device: StampPaintDevice, layer: GPUTexture, keeps = true): StampPaintLayerCache {
  const pool = pools.get(device.queue) ?? { entries: new Set<Entry>(), bytes: 0, clock: 0 };
  pools.set(device.queue, pool);
  const entries = new Map<string, Entry>();
  const layers = layer.depthOrArrayLayers;
  /** `painted` grown by the lay's reach, held to the target. */
  const heldBox = (painted: StampPixelBox): StampPixelBox => {
    const x = Math.max(0, painted.x - STAMP_LAYER_CACHE_READ_REACH), y = Math.max(0, painted.y - STAMP_LAYER_CACHE_READ_REACH);
    return { x, y, w: Math.min(layer.width, painted.x + painted.w + STAMP_LAYER_CACHE_READ_REACH) - x, h: Math.min(layer.height, painted.y + painted.h + STAMP_LAYER_CACHE_READ_REACH) - y };
  };
  const forget = (e: Entry) => {
    pool.entries.delete(e);
    pool.bytes -= e.bytes;
    e.texture?.destroy();
  };
  return {
    restore(encoder, key) {
      const found = entries.get(key);
      if (!found) return null;
      found.used = ++pool.clock;
      found.encoder = encoder;
      if (found.texture && found.held) {
        const { x, y, w, h } = found.held;
        encoder.copyTextureToTexture({ texture: found.texture }, { texture: layer, origin: { x, y, z: 0 } }, [w, h, layers]);
      }
      return { painted: found.painted };
    },
    peek(key) {
      const found = entries.get(key);
      if (!found) return null;
      found.used = ++pool.clock;
      return { painted: found.painted };
    },
    save(encoder, key, painted) {
      if (!keeps) return;
      const again = entries.get(key);
      if (again) {
        again.used = ++pool.clock;
        return;
      }
      const held = painted && heldBox(painted), bytes = held ? held.w * held.h * layers * 8 : 0;
      const givable = [...pool.entries].filter((e) => e.encoder !== encoder).toSorted((a, b) => a.used - b.used);
      let total = pool.bytes;
      const given: Entry[] = [];
      while (total + bytes > STAMP_LAYER_CACHE_BUDGET && givable.length) {
        const e = givable.shift()!;
        given.push(e);
        total -= e.bytes;
      }
      if (total + bytes > STAMP_LAYER_CACHE_BUDGET) return;
      for (const e of given) e.drop();
      const texture = held && device.createTexture({ size: [held.w, held.h, layers], format: layer.format, usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
      if (texture && held) encoder.copyTextureToTexture({ texture: layer, origin: { x: held.x, y: held.y, z: 0 } }, { texture }, [held.w, held.h, layers]);
      const entry: Entry = { key, painted, held, texture, bytes, used: ++pool.clock, encoder, drop: () => {
        entries.delete(key);
        forget(entry);
      } };
      entries.set(key, entry);
      pool.entries.add(entry);
      pool.bytes += bytes;
    },
    dispose() {
      for (const e of entries.values()) forget(e);
      entries.clear();
    },
  };
}

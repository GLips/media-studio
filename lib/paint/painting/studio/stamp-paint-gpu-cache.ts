// stamp-paint-gpu-cache.ts: what a device keeps between frames, under one budget: textures, each entry made by one
// producer (a group's film, a plane's picture, a picture blurred, a sheet solve's checkpoint) under a key naming what
// it holds. The device's owner (stamp-paint-gpu-owner.ts) holds it, so every painting and output on the device shares
// the budget; each renderer keeps its entries in stores of its own, given up when it's disposed.
//
// An entry the frame being encoded uses, or one a reader or solve holds, is never given up: destroying a texture an
// unsubmitted encoder reads is an error. Past the budget checkpoints go first, then the least recently used of the
// rest; a frame's own needs may overrun it meanwhile.

import type { StampPaintDevice } from './stamp-paint-gpu.ts';

/** The most a device's cache holds once a frame's own entries are counted out, bytes: a 1080p scene's planes and films. */
export const STAMP_GPU_CACHE_BUDGET = 768 * 1024 * 1024;

/**
 * What makes an entry: a group's painted layer, a plane's picture, a picture blurred, an own sheet's edge, a drawable's
 * laid coverage (what a shot's alphaOf mask reads), or a sheet solve's checkpoint.
 */
export type StampGpuCacheProducer = 'film' | 'picture' | 'blurred' | 'edge' | 'coverage' | 'checkpoint';

/** A texture an entry holds: `layers` array layers of `width` × `height` in `format`. */
export type StampGpuCacheTexture = { width: number; height: number; layers: number; format: GPUTextureFormat; usage: GPUTextureUsageFlags };

/** An entry: the textures its producer made and filled, and what it noted beside them. */
export type StampGpuCacheEntry<Note> = { readonly textures: readonly GPUTexture[]; readonly note: Note };

/** One producer's entries for one renderer, each noting a `Note`. */
export type StampGpuCacheStore<Note> = {
  /** The entry under `key`, as used by `encoder`'s frame; null for none. */
  find: (key: string, encoder: GPUCommandEncoder) => StampGpuCacheEntry<Note> | null;
  /** A new entry under `key`, used by `encoder`'s frame: textures made as `textures` says, for the caller to fill. */
  make: (key: string, encoder: GPUCommandEncoder, textures: readonly StampGpuCacheTexture[], note: Note) => StampGpuCacheEntry<Note>;
  /** The note of the entry under `key`, without using it; null for none. */
  peek: (key: string) => Note | null;
  /** Keeps the entry under `key` from being given up until the returned release runs; null for no entry. */
  hold: (key: string) => (() => void) | null;
  /** Gives up every entry, once the frames that read them are submitted. */
  dispose: () => void;
};

export type StampPaintGpuCache = {
  /** A store for `producer`'s entries of one renderer. */
  store: <Note>(producer: StampGpuCacheProducer) => StampGpuCacheStore<Note>;
  /** The bytes held, for profiling. */
  bytes: () => number;
  /** How many entries it has given up to make room since it was made, for profiling: a cost report counts the change. */
  evictions: () => number;
  dispose: () => void;
};

/**
 * An entry as its store holds it. Its store's map is the one place it lives, note and all, so `forget` takes all of
 * it at once; eviction reaches it through the cache's set of stores.
 */
type StampGpuCacheHeld = {
  textures: GPUTexture[]; bytes: number; used: number; encoder: GPUCommandEncoder; holds: number; producer: StampGpuCacheProducer; forget: () => void;
};

const TEXEL_BYTES: Partial<Record<GPUTextureFormat, number>> = { r8unorm: 1, r16float: 2, rg16float: 4, rgba8unorm: 4, rgba16float: 8, r32float: 4, rgba32float: 16 };

/** The order the cache gives entries up in: checkpoints first, as a solve can always run again from an earlier one. */
const evictionRank = (entry: StampGpuCacheHeld) => (entry.producer === 'checkpoint' ? 0 : 1);

function textureBytes({ width, height, layers, format }: StampGpuCacheTexture): number {
  const texel = TEXEL_BYTES[format];
  if (texel === undefined) throw new Error(`stamp paint: the GPU cache doesn't keep ${format} textures`);
  return width * height * layers * texel;
}

/** Gives up every entry `store` holds. */
function forgetStampGpuCacheStore(store: ReadonlyMap<string, StampGpuCacheHeld>) {
  // Each forget deletes its entry from the map, which a Map's iteration allows.
  for (const entry of store.values()) entry.forget();
}

/** A cache on `device`, the owner's. */
export function stampPaintGpuCache(device: StampPaintDevice): StampPaintGpuCache {
  const stores = new Set<ReadonlyMap<string, StampGpuCacheHeld>>();
  let heldBytes = 0, clock = 0, evicted = 0;
  /** Gives up entries `encoder`'s frame doesn't use and nobody holds until `more` bytes fit (evictionRank's, then the least recently used), or none is left. */
  const room = (more: number, encoder: GPUCommandEncoder) => {
    const givable: StampGpuCacheHeld[] = [];
    for (const store of stores) for (const entry of store.values()) if (entry.encoder !== encoder && entry.holds === 0) givable.push(entry);
    for (const entry of givable.toSorted((a, b) => evictionRank(a) - evictionRank(b) || a.used - b.used)) {
      if (heldBytes + more <= STAMP_GPU_CACHE_BUDGET) return;
      entry.forget();
      evicted++;
    }
  };
  return {
    // Keys need no prefix, as each store's map is its own.
    store: <Note>(producer: StampGpuCacheProducer): StampGpuCacheStore<Note> => {
      const held = new Map<string, StampGpuCacheHeld & { note: Note }>();
      stores.add(held);
      return {
        find: (key, encoder) => {
          const found = held.get(key);
          if (!found) return null;
          found.used = ++clock;
          found.encoder = encoder;
          return { textures: found.textures, note: found.note };
        },
        make: (key, encoder, textures, note) => {
          held.get(key)?.forget();
          const bytes = textures.reduce((sum, texture) => sum + textureBytes(texture), 0);
          room(bytes, encoder);
          const made = textures.map(({ width, height, layers, format, usage }) => device.createTexture({ size: [width, height, layers], format, usage }));
          const forget = () => {
            held.delete(key);
            heldBytes -= bytes;
            for (const texture of made) texture.destroy();
          };
          held.set(key, { textures: made, bytes, used: ++clock, encoder, holds: 0, producer, note, forget });
          heldBytes += bytes;
          return { textures: made, note };
        },
        peek: (key) => held.get(key)?.note ?? null,
        hold: (key) => {
          const found = held.get(key);
          if (!found) return null;
          found.holds++;
          return () => {
            found.holds--;
          };
        },
        dispose: () => {
          forgetStampGpuCacheStore(held);
          stores.delete(held);
        },
      };
    },
    bytes: () => heldBytes,
    evictions: () => evicted,
    dispose: () => {
      for (const store of stores) forgetStampGpuCacheStore(store);
      stores.clear();
    },
  };
}

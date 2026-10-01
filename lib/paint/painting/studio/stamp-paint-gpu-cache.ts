// stamp-paint-gpu-cache.ts: what a surface keeps on its device between frames, under one budget: textures, each
// entry made by one producer (a group's film, a plane's picture, a picture blurred) under a key naming what it holds.
// The surface owns it, one per device, so every painting drawn on the surface shares the budget; each renderer keeps
// its entries in stores of its own, given up when it's disposed.
//
// An entry the frame being encoded uses is never given up: destroying a texture an unsubmitted encoder reads is an
// error. Past the budget the least recently used of the rest go; a frame's own needs may overrun it meanwhile.

import type { StampPaintDevice } from './stamp-paint-gpu.ts';

/** The most a surface's cache holds once a frame's own entries are counted out, bytes: a 1080p scene's planes and films. */
export const STAMP_GPU_CACHE_BUDGET = 768 * 1024 * 1024;

/** What makes an entry: a group's painted layer, a plane's picture, or a picture blurred. */
export type StampGpuCacheProducer = 'film' | 'picture' | 'blurred';

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
  /** Gives up every entry, once the frames that read them are submitted. */
  dispose: () => void;
};

export type StampPaintGpuCache = {
  /** A store for `producer`'s entries of one renderer. */
  store: <Note>(producer: StampGpuCacheProducer) => StampGpuCacheStore<Note>;
  /** The bytes held, for profiling. */
  bytes: () => number;
  dispose: () => void;
};

type Entry = { key: string; textures: GPUTexture[]; bytes: number; used: number; encoder: GPUCommandEncoder };

const TEXEL_BYTES: Partial<Record<GPUTextureFormat, number>> = { r8unorm: 1, r16float: 2, rg16float: 4, rgba8unorm: 4, rgba16float: 8, r32float: 4, rgba32float: 16 };

function textureBytes({ width, height, layers, format }: StampGpuCacheTexture): number {
  const texel = TEXEL_BYTES[format];
  if (texel === undefined) throw new Error(`stamp paint: the GPU cache doesn't keep ${format} textures`);
  return width * height * layers * texel;
}

/** A cache on `device`, the surface's. */
export function stampPaintGpuCache(device: StampPaintDevice): StampPaintGpuCache {
  const entries = new Map<string, Entry>();
  let held = 0, clock = 0, stores = 0;
  const forget = (entry: Entry) => {
    entries.delete(entry.key);
    held -= entry.bytes;
    for (const texture of entry.textures) texture.destroy();
  };
  /** Gives up the least recently used entries `encoder`'s frame doesn't use until `more` bytes fit, or none is left. */
  const room = (more: number, encoder: GPUCommandEncoder) => {
    const givable = [...entries.values()].filter((entry) => entry.encoder !== encoder).toSorted((a, b) => a.used - b.used);
    for (const entry of givable) {
      if (held + more <= STAMP_GPU_CACHE_BUDGET) return;
      forget(entry);
    }
  };
  return {
    store: <Note>(producer: StampGpuCacheProducer): StampGpuCacheStore<Note> => {
      const id = ++stores, mine = new Set<string>();
      const keyOf = (key: string) => `${id}|${producer}|${key}`;
      // Each entry's note is the Note its store's make was given: keys carry the store's id.
      const notes = new Map<string, Note>();
      return {
        find: (key, encoder) => {
          const full = keyOf(key), found = entries.get(full);
          if (!found) {
            // Given up for room, by any store.
            notes.delete(full);
            mine.delete(full);
            return null;
          }
          found.used = ++clock;
          found.encoder = encoder;
          return { textures: found.textures, note: notes.get(full)! };
        },
        make: (key, encoder, textures, note) => {
          const full = keyOf(key), again = entries.get(full);
          if (again) forget(again);
          const bytes = textures.reduce((sum, texture) => sum + textureBytes(texture), 0);
          room(bytes, encoder);
          const made = textures.map(({ width, height, layers, format, usage }) => device.createTexture({ size: [width, height, layers], format, usage }));
          entries.set(full, { key: full, textures: made, bytes, used: ++clock, encoder });
          notes.set(full, note);
          mine.add(full);
          held += bytes;
          return { textures: made, note };
        },
        dispose: () => {
          for (const key of mine) {
            const entry = entries.get(key);
            if (entry) forget(entry);
          }
          mine.clear();
          notes.clear();
        },
      };
    },
    bytes: () => held,
    dispose: () => {
      for (const entry of entries.values()) forget(entry);
    },
  };
}

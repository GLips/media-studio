// stamp-paint-gpu-cache.ts: what a device keeps, under one budget: textures, each entry made by one producer (a
// group's film, a plane's picture, a sheet solve's checkpoint, a pass's target) under a key naming what it holds. The
// device's owner holds it; each renderer keeps its entries in stores of its own, given up when it's disposed.
//
// An entry the frame being encoded uses, or one held, is never given up: destroying a texture an unsubmitted encoder
// reads is an error. Every encoder is made, filled and submitted in one synchronous run, so the frame being encoded is
// the one encoder open. Past the budget the cheapest to remake go first (evictionRank), then the least recently used;
// a frame may overrun it.

import type { TraceQuantity } from '#lib/platform/trace/models/trace-model.ts';
import type { StampGpuCacheBytes } from '../models/stamp-paint-costs.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';

/**
 * The most a device's cache holds once a frame's own entries and those held are counted out, bytes: a 1080p scene's
 * planes, films and the targets a frame and a solve work in.
 */
export const STAMP_GPU_CACHE_BUDGET = 1536 * 1024 * 1024;

/**
 * What makes an entry: a group's painted layer, a plane's picture, a picture blurred, an own sheet's edge, a strokes
 * reveal's arrival map, a sheet solve's checkpoint, or a pass's target (the owner's `target`), scratch whatever it
 * holds. Targets count as `targets` in the cache's bytes, the rest as `kept`.
 */
export type StampGpuCacheProducer = 'film' | 'picture' | 'blurred' | 'edge' | 'arrival' | 'checkpoint' | 'target';

/** What a producer has had of a cache: its entries given up to make room, and the bytes it made. Counters, only growing. */
export type StampGpuCacheProducerCounts = { readonly evicted: number; readonly madeBytes: number };

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
  /**
   * The entry under `key`, found or made as `make` would, held from eviction until `release` runs: work spanning
   * encoders takes its entries so. `encoder` is the one open as it's taken, whose entries a make spares; null when
   * none is, as at a load.
   */
  take: (key: string, encoder: GPUCommandEncoder | null, textures: readonly StampGpuCacheTexture[], note: Note) => { entry: StampGpuCacheEntry<Note>; release: () => void };
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
  /** The bytes held now, kept and in targets. */
  bytes: () => StampGpuCacheBytes;
  /** How many entries it has given up to make room since it was made, for profiling: a cost report counts the change. */
  evictions: () => number;
  /** Each producer's entries given up to make room, and bytes made, since the cache was made: a trace reads the change. */
  producers: () => ReadonlyMap<StampGpuCacheProducer, StampGpuCacheProducerCounts>;
  dispose: () => void;
};

/**
 * An entry as its store holds it. Its store's map is the one place it lives, note and all, so `forget` takes all of
 * it at once; eviction reaches it through the cache's set of stores.
 */
type StampGpuCacheHeld = {
  textures: GPUTexture[]; bytes: number; used: number; encoder: GPUCommandEncoder | null; holds: number; producer: StampGpuCacheProducer; forget: () => void;
};

const TEXEL_BYTES: Partial<Record<GPUTextureFormat, number>> = {
  r8unorm: 1, r16float: 2, rg16float: 4, rgba8unorm: 4, rgba16float: 8, r32float: 4, rg32float: 8, rgba32float: 16, rgba32uint: 16,
};

/**
 * The order the cache gives entries up in, cheapest to make again first: checkpoints, as a solve can always run again
 * from an earlier one; pictures and targets, laid or made in a pass; films last, as only a whole solve makes one.
 */
const EVICTION_RANKS: Record<StampGpuCacheProducer, number> = { checkpoint: 0, picture: 1, blurred: 1, edge: 1, arrival: 1, target: 1, film: 2 };
const evictionRank = (entry: StampGpuCacheHeld) => EVICTION_RANKS[entry.producer];

function textureBytes({ width, height, layers, format }: StampGpuCacheTexture): number {
  const texel = TEXEL_BYTES[format];
  if (texel === undefined) throw new Error(`stamp paint: the GPU cache doesn't keep ${format} textures`);
  return width * height * layers * texel;
}

/** An entry as its store's callers see it: its textures and note, none of the cache's bookkeeping. */
const entryOf = <Note>({ textures, note }: StampGpuCacheHeld & { note: Note }): StampGpuCacheEntry<Note> => ({ textures, note });

/** Gives up every entry `store` holds. */
function forgetStampGpuCacheStore(store: ReadonlyMap<string, StampGpuCacheHeld>) {
  // Each forget deletes its entry from the map, which a Map's iteration allows.
  for (const entry of store.values()) entry.forget();
}

/** A cache on `device`, the owner's, holding at most `budget` bytes past what a frame uses and what's held. */
export function stampPaintGpuCache(device: Pick<StampPaintDevice, 'createTexture'>, budget = STAMP_GPU_CACHE_BUDGET): StampPaintGpuCache {
  const stores = new Set<ReadonlyMap<string, StampGpuCacheHeld>>();
  let kept = 0, targets = 0, clock = 0, evicted = 0;
  const producers = new Map<StampGpuCacheProducer, StampGpuCacheProducerCounts>();
  const tallied = (producer: StampGpuCacheProducer, change: Partial<StampGpuCacheProducerCounts>) => {
    const was = producers.get(producer) ?? { evicted: 0, madeBytes: 0 };
    producers.set(producer, { evicted: was.evicted + (change.evicted ?? 0), madeBytes: was.madeBytes + (change.madeBytes ?? 0) });
  };
  const counted = (producer: StampGpuCacheProducer, bytes: number) => {
    if (producer === 'target') targets += bytes;
    else kept += bytes;
  };
  /**
   * Gives up entries `encoder`'s frame doesn't use and nobody holds until `more` bytes fit (evictionRank's, then the
   * least recently used), or none is left. With no encoder open, only what's held is spared.
   */
  const room = (more: number, encoder: GPUCommandEncoder | null) => {
    const givable: StampGpuCacheHeld[] = [];
    for (const store of stores) for (const entry of store.values()) if ((encoder === null || entry.encoder !== encoder) && entry.holds === 0) givable.push(entry);
    for (const entry of givable.toSorted((a, b) => evictionRank(a) - evictionRank(b) || a.used - b.used)) {
      if (kept + targets + more <= budget) return;
      entry.forget();
      evicted++;
      tallied(entry.producer, { evicted: 1 });
    }
  };
  return {
    // Keys need no prefix, as each store's map is its own.
    store: <Note>(producer: StampGpuCacheProducer): StampGpuCacheStore<Note> => {
      const held = new Map<string, StampGpuCacheHeld & { note: Note }>();
      stores.add(held);
      const found = (key: string, encoder: GPUCommandEncoder | null) => {
        const entry = held.get(key);
        if (!entry) return null;
        entry.used = ++clock;
        if (encoder) entry.encoder = encoder;
        return entry;
      };
      const made = (key: string, encoder: GPUCommandEncoder | null, wanted: readonly StampGpuCacheTexture[], note: Note) => {
        held.get(key)?.forget();
        const bytes = wanted.reduce((sum, texture) => sum + textureBytes(texture), 0);
        room(bytes, encoder);
        const textures = wanted.map(({ width, height, layers, format, usage }) => device.createTexture({ size: [width, height, layers], format, usage }));
        const forget = () => {
          held.delete(key);
          counted(producer, -bytes);
          for (const texture of textures) texture.destroy();
        };
        const entry = { textures, bytes, used: ++clock, encoder, holds: 0, producer, note, forget };
        held.set(key, entry);
        counted(producer, bytes);
        tallied(producer, { madeBytes: bytes });
        return entry;
      };
      return {
        find: (key, encoder) => {
          const entry = found(key, encoder);
          return entry && entryOf(entry);
        },
        make: (key, encoder, textures, note) => entryOf(made(key, encoder, textures, note)),
        take: (key, encoder, textures, note) => {
          const entry = found(key, encoder) ?? made(key, encoder, textures, note);
          entry.holds++;
          return {
            entry: entryOf(entry),
            release: () => {
              entry.holds--;
              // Its holder used it until now, so it ranks as just used.
              entry.used = ++clock;
            },
          };
        },
        peek: (key) => held.get(key)?.note ?? null,
        hold: (key) => {
          const entry = held.get(key);
          if (!entry) return null;
          entry.holds++;
          return () => {
            entry.holds--;
          };
        },
        dispose: () => {
          forgetStampGpuCacheStore(held);
          stores.delete(held);
        },
      };
    },
    bytes: () => ({ kept, targets }),
    evictions: () => evicted,
    producers: () => new Map(producers),
    dispose: () => {
      for (const store of stores) forgetStampGpuCacheStore(store);
      stores.clear();
    },
  };
}

/** The entries each producer had evicted between two reads of `producers`, as a span's attributes: none where none was. */
export function stampGpuCacheEvictionAttributes(
  before: ReadonlyMap<StampGpuCacheProducer, StampGpuCacheProducerCounts>, after: ReadonlyMap<StampGpuCacheProducer, StampGpuCacheProducerCounts>,
): Record<string, TraceQuantity> {
  return Object.fromEntries([...after].flatMap(([producer, { evicted }]) => {
    const more = evicted - (before.get(producer)?.evicted ?? 0);
    return more ? [[`evicted ${producer}`, { value: more, unit: 'entries' }]] : [];
  }));
}

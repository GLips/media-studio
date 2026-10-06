// stamp-sheet-films.ts: the films a sheet solve ends with, kept in the device's cache (stamp-paint-gpu-cache.ts) under
// the solve's last key, each cropped to where it was painted within the frame, its box in painting points; and what
// reads them: a composite of sheets (stamp-sheet-composite.ts), and a film's texels read back. A wrapped sheet's halo
// (stamp-sheet-wrap.ts) is never kept.
//
// A kept film can be given up to the cache's budget like any other unless a reader holds it: reading one that's gone
// is refused by its key, and solving the sheet again keeps it anew.

import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import { stampStageFramed, stampStageTexelsOf, type StampPointBox, type StampStage } from '../models/stamp-stage.ts';
import { copyStampLayerForReadback, readStampLayerCopy, type StampLayerReadback } from './stamp-layer-readback.ts';
import type { StampGpuCacheStore } from './stamp-paint-gpu-cache.ts';
import { copyStampTextureBox } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';

/** A kept film's note: the painting points within the frame it was painted over (null for none), cropped to, and its layers. */
type StampSheetFilmNote = { box: StampPointBox | null; layers: number };

/** A film a solve kept: its key in the cache, and the box of painting points it holds (null for a film painted nowhere in the frame). */
export type StampSheetFilmKept = { key: string; box: StampPointBox | null };

const stores = new WeakMap<StampPaintGpuOwner, StampGpuCacheStore<StampSheetFilmNote>>();

/** `owner`'s store of kept films, made the first time it's asked for. */
function stampSheetFilmStore(owner: StampPaintGpuOwner): StampGpuCacheStore<StampSheetFilmNote> {
  const known = stores.get(owner);
  if (known) return known;
  const made = owner.cache.store<StampSheetFilmNote>('film');
  stores.set(owner, made);
  return made;
}

/**
 * Keeps each of `films` (a film the size of `stage` and the stage texels painted in it) under `key`, what of it lies
 * within the frame copied in `encoder`.
 */
export function keepStampSheetFilms(
  owner: StampPaintGpuOwner, encoder: GPUCommandEncoder, key: string, stage: StampStage, films: readonly { texture: GPUTexture; box: StampPixelBox | null }[],
): StampSheetFilmKept[] {
  const store = stampSheetFilmStore(owner), keptUsage = GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING;
  return films.map(({ texture, box: painted }, f) => {
    const filmKey = `${key}|film${f}`, layers = texture.depthOrArrayLayers, box = painted && stampStageFramed(stage, painted);
    const made = store.make(filmKey, encoder, box ? [{ width: box.w, height: box.h, layers, format: texture.format, usage: keptUsage }] : [], { box, layers });
    if (box) copyStampTextureBox(encoder, { texture, ...stampStageTexelsOf(stage, box) }, { texture: made.textures[0], x: 0, y: 0 }, box);
    return { key: filmKey, box };
  });
}

/** The `films` films kept under `key` (keepStampSheetFilms'), or null unless every one still is. */
export function keptStampSheetFilms(owner: StampPaintGpuOwner, key: string, films: number): StampSheetFilmKept[] | null {
  const store = stampSheetFilmStore(owner), kept = Array.from({ length: films }, (_, f) => ({ key: `${key}|film${f}`, note: store.peek(`${key}|film${f}`) }));
  return kept.every(({ note }) => note) ? kept.map(({ key: filmKey, note }) => ({ key: filmKey, box: note!.box })) : null;
}

/**
 * Keeps `films` from the cache's eviction until the returned release runs: a reader holds a solve's films from the
 * solve's end until it has encoded what reads them, as other solves may make entries meanwhile. Throws for a film
 * already given up.
 */
export function holdStampSheetFilms(owner: StampPaintGpuOwner, films: readonly StampSheetFilmKept[]): () => void {
  const store = stampSheetFilmStore(owner), releases: (() => void)[] = [];
  const release = () => releases.splice(0).forEach((each) => each());
  for (const { key } of films) {
    const held = store.hold(key);
    if (!held) {
      release();
      throw new Error(`stamp sheet: film ${key} was given up before it was held (its cache's budget is smaller than one solve's films)`);
    }
    releases.push(held);
  }
  return release;
}

/** `film`'s texture as kept, used by `encoder`; null for a film painted nowhere. Throws once the cache gave it up. */
export function keptStampSheetFilm(owner: StampPaintGpuOwner, film: StampSheetFilmKept, encoder: GPUCommandEncoder): GPUTexture | null {
  const kept = stampSheetFilmStore(owner).find(film.key, encoder);
  if (!kept) throw new Error(`stamp sheet: film ${film.key} is no longer kept on this device (its cache gave it up); solve the sheet again`);
  return kept.textures[0] ?? null;
}

/** A kept film's texels over its box, each layer's rgba as floats; null for a film painted nowhere. */
export async function readStampSheetFilm(owner: StampPaintGpuOwner, film: StampSheetFilmKept): Promise<StampLayerReadback | null> {
  const { box } = film;
  if (!box) return null;
  const copy = await owner.checked(`reading back film ${film.key}`, () => {
    const encoder = owner.device.createCommandEncoder();
    const copied = copyStampLayerForReadback(owner.device, encoder, keptStampSheetFilm(owner, film, encoder)!, { x: 0, y: 0, w: box.w, h: box.h });
    owner.device.queue.submit([encoder.finish()]);
    return copied;
  });
  return readStampLayerCopy(copy);
}

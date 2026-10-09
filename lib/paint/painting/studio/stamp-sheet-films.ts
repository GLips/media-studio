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

/** A kept film's rows as copied out (each padded to 256 bytes, as a copy to a buffer must be), and what lays them back. */
type StampSheetFilmHeader = { box: StampPointBox | null; layers: number; format: GPUTextureFormat; rowBytes: number };

/** A kept film being copied out, for the disk: its key, its header, and the buffer its rows land in (null for none painted). */
export type StampSheetFilmCopy = { key: string; header: StampSheetFilmHeader; buffer: GPUBuffer | null };

/** Bytes a texel of a kept film's format: films are rgba16float. */
const FILM_TEXEL_BYTES = 8;

/** Each of `films` (kept, used by `encoder`) copied in `encoder` into a buffer of its own, to be read once it's submitted. */
export function copyStampSheetFilmsOut(owner: StampPaintGpuOwner, encoder: GPUCommandEncoder, films: readonly StampSheetFilmKept[]): StampSheetFilmCopy[] {
  const store = stampSheetFilmStore(owner);
  return films.map((film) => {
    const kept = store.find(film.key, encoder)!, texture = kept.textures[0];
    if (!texture || !film.box) return { key: film.key, header: { box: null, layers: kept.note.layers, format: 'rgba16float', rowBytes: 0 }, buffer: null };
    const rowBytes = Math.ceil((texture.width * FILM_TEXEL_BYTES) / 256) * 256, layers = texture.depthOrArrayLayers;
    const buffer = owner.device.createBuffer({ size: rowBytes * texture.height * layers, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: rowBytes, rowsPerImage: texture.height }, [texture.width, texture.height, layers]);
    return { key: film.key, header: { box: film.box, layers, format: texture.format, rowBytes }, buffer };
  });
}

/** `copy`'s film as one record (a little-endian u32 header length, the header's JSON, padding to 8, the rows), its buffer destroyed. */
export async function stampSheetFilmRecord({ header, buffer }: StampSheetFilmCopy): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const head = new TextEncoder().encode(JSON.stringify(header)), at = Math.ceil((4 + head.byteLength) / 8) * 8;
    if (buffer) await buffer.mapAsync(GPUMapMode.READ);
    const rows = buffer ? new Uint8Array(buffer.getMappedRange()) : new Uint8Array(0), record = new Uint8Array(at + rows.byteLength);
    new DataView(record.buffer).setUint32(0, head.byteLength, true);
    record.set(head, 4);
    record.set(rows, at);
    return record;
  } finally {
    buffer?.destroy();
  }
}

/** A film's `record` (stampSheetFilmRecord's) kept on `owner`'s device under `key`, as solving it would have. */
export function adoptStampSheetFilm(owner: StampPaintGpuOwner, key: string, record: ArrayBuffer): StampSheetFilmKept {
  const length = new DataView(record).getUint32(0, true), at = Math.ceil((4 + length) / 8) * 8;
  // SAFETY: the record was made by stampSheetFilmRecord, its header that JSON.
  const { box, layers, format, rowBytes } = JSON.parse(new TextDecoder().decode(new Uint8Array(record, 4, length))) as StampSheetFilmHeader;
  const usage = GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING;
  const { entry, release } = stampSheetFilmStore(owner).take(key, null, box ? [{ width: box.w, height: box.h, layers, format, usage }] : [], { box, layers });
  if (box) owner.device.queue.writeTexture({ texture: entry.textures[0] }, new Uint8Array(record, at), { bytesPerRow: rowBytes, rowsPerImage: box.h }, [box.w, box.h, layers]);
  release();
  return { key, box };
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

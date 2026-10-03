// stamp-sheet-films.ts: the films a sheet solve ends with, kept in the device's cache (stamp-paint-gpu-cache.ts) under
// the solve's last key, each cropped to where it was painted; and what reads them: a still of the painting, its films
// laid over its paper as the renderer lays a painting at rest, and a film's texels read back.
//
// A kept film can be given up to the cache's budget like any other: reading one that's gone is refused by its key,
// and solving the sheet again keeps it anew.

import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import { stampSheetMixedPainting, type StampSheetProgram } from '../models/stamp-sheet-program.ts';
import { stampStage, type StampStage } from '../models/stamp-stage.ts';
import { copyStampLayerForReadback, readStampLayerCopy, type StampLayerReadback } from './stamp-layer-readback.ts';
import type { StampPaintTarget } from './stamp-paint-compositor.ts';
import { stampPaintCompositorFor } from './stamp-paint-compositor-for.ts';
import type { StampGpuCacheStore } from './stamp-paint-gpu-cache.ts';
import { copyStampTextureBox, stampBindGroup, stampPaintSamplers } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import { createStampPaintLay, stampPaintOutputWgsl } from './stamp-paint-lay-pass.ts';
import type { StampPaintSurface } from './stamp-paint-surface.ts';
import { createStampUniformArena } from './stamp-uniform-arena.ts';

/** A kept film's note: the stage texels it was painted over (null for none), cropped to, and its layers. */
type StampSheetFilmNote = { box: StampPixelBox | null; layers: number };

/** A film a solve kept: its key in the cache, and the box it holds (null for a film painted nowhere). */
export type StampSheetFilmKept = { key: string; box: StampPixelBox | null };

const stores = new WeakMap<StampPaintGpuOwner, StampGpuCacheStore<StampSheetFilmNote>>();

/** `owner`'s store of kept films, made the first time it's asked for. */
function stampSheetFilmStore(owner: StampPaintGpuOwner): StampGpuCacheStore<StampSheetFilmNote> {
  const known = stores.get(owner);
  if (known) return known;
  const made = owner.cache.store<StampSheetFilmNote>('film');
  stores.set(owner, made);
  return made;
}

const KEPT_USAGE = GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING;

/** Keeps each of `films` (a stage-sized film and the box painted in it) under `key`, copied in `encoder`. */
export function keepStampSheetFilms(owner: StampPaintGpuOwner, encoder: GPUCommandEncoder, key: string, films: readonly { texture: GPUTexture; box: StampPixelBox | null }[]): StampSheetFilmKept[] {
  const store = stampSheetFilmStore(owner);
  return films.map(({ texture, box }, f) => {
    const filmKey = `${key}|film${f}`, layers = texture.depthOrArrayLayers;
    const made = store.make(filmKey, encoder, box ? [{ width: box.w, height: box.h, layers, format: texture.format, usage: KEPT_USAGE }] : [], { box, layers });
    if (box) copyStampTextureBox(encoder, { texture, x: box.x, y: box.y }, { texture: made.textures[0], x: 0, y: 0 }, box);
    return { key: filmKey, box };
  });
}

/** `film`'s texture as kept, used by `encoder`; null for a film painted nowhere. Throws once the cache gave it up. */
function keptStampSheetFilm(owner: StampPaintGpuOwner, film: StampSheetFilmKept, encoder: GPUCommandEncoder): GPUTexture | null {
  const kept = stampSheetFilmStore(owner).find(film.key, encoder);
  if (!kept) throw new Error(`stamp sheet: film ${film.key} is no longer kept on this device (its cache gave it up); solve the sheet again`);
  return kept.textures[0] ?? null;
}

/** `owner`'s target `name` of `stage`'s size shaped as `shape`, sampled and `usage`: a still overwrites all it reads of it. */
function stillTarget(owner: StampPaintGpuOwner, name: string, stage: StampStage, shape: StampPaintTarget, usage: number) {
  const layers = shape.kind === 'array' ? shape.layers : 1;
  const texture = owner.target(`sheet still ${name}`, { size: [stage.width, stage.height, layers], format: 'rgba16float', usage: usage | GPUTextureUsage.TEXTURE_BINDING });
  return { texture, view: texture.createView({ dimension: shape.kind === 'array' ? '2d-array' : '2d' }) };
}

/** `films` (a solve's of `program`) laid back to front over its paper and shown on `surface`, its size. */
export async function drawStampSheetStill(surface: StampPaintSurface, program: StampSheetProgram, films: readonly StampSheetFilmKept[]): Promise<void> {
  const { owner } = surface;
  if (surface.width !== program.width || surface.height !== program.height) {
    throw new Error(`stamp sheet: a ${program.width} × ${program.height} sheet is shown on a surface its size, not ${surface.width} × ${surface.height}`);
  }
  const choice = stampPaintCompositorFor(stampSheetMixedPainting(program));
  const [photograph = null] = program.paper.image ? await owner.images([{ asset: program.paper.image, kind: 'photograph' }]) : [];
  const scope = owner.scope();
  try {
    await owner.checked('laying a sheet\'s films', () => {
      const { device } = scope, compositor = choice.compositorOn(device), stage = stampStage(program);
      const arena = createStampUniformArena(device, 1 + films.length);
      const blank = owner.target('sheet blank', { size: [1, 1], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
      const lay = createStampPaintLay(device, arena, { stage, compositor, paper: program.paper, photograph, blank: blank.createView(), sampler: stampPaintSamplers(device).mirrorTile });
      const painting = stillTarget(owner, 'painting', stage, compositor.targets.painting, GPUTextureUsage.STORAGE_BINDING);
      const layer = stillTarget(owner, 'layer', stage, compositor.targets.layer, GPUTextureUsage.COPY_DST);
      const encoder = device.createCommandEncoder();
      lay.drawPaper(encoder, painting.view, 'paper', stage.width, stage.height);
      films.forEach((film, f) => {
        const kept = keptStampSheetFilm(owner, film, encoder);
        if (!kept || !film.box) return;
        copyStampTextureBox(encoder, { texture: kept, x: 0, y: 0 }, { texture: layer.texture, x: film.box.x, y: film.box.y }, film.box);
        lay.layGroup(encoder, { layer: layer.view, painting: painting.view, index: f, opacity: 1, glaze: true, box: film.box, backing: 'paper', rest: null, paperFromRest: false });
      });
      const module = device.createShaderModule({ code: stampPaintOutputWgsl(compositor, surface.format.endsWith('8unorm'), stage) });
      const output = device.createRenderPipeline({ layout: 'auto', vertex: { module }, fragment: { module, targets: [{ format: surface.format }] } });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: surface.frameTexture().createView(), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(output);
      pass.setBindGroup(0, stampBindGroup(device, output, [painting.view]));
      pass.draw(3);
      pass.end();
      arena.flush();
      device.queue.submit([encoder.finish()]);
    });
  } finally {
    scope.destroy();
  }
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

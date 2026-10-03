// stamp-sheet-targets.ts: what a sheet solve paints in, made in its scope and given up with it: one film a layer,
// each the stage's size, and one working layer the deposit pass and the wet stages paint into. A film is worked on in
// the working layer, swapped in whole: the stages bind the working layer once, as they load.
//
// Per-deposit scratch (mask, cap, blurs, touch, footprint, fresh) is shared by every film; each deposit rewrites it.

import type { StampStage } from '../models/stamp-stage.ts';
import type { StampPaintCompositor } from './stamp-paint-compositor.ts';
import type { StampDepositTarget } from './stamp-deposit-drawing.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';
import { STAMP_WET_FIELD_FORMATS } from './stamp-wet-field.ts';

const RENDER = GPUTextureUsage.RENDER_ATTACHMENT, STORAGE = GPUTextureUsage.STORAGE_BINDING, SAMPLED = GPUTextureUsage.TEXTURE_BINDING;
const COPIED = GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;

/** A layered target: its texture, a view of it as an array, and a view of each layer. */
export type StampSheetLayered = StampDepositTarget & { layers: readonly GPUTextureView[] };

/** A sheet solve's targets on `device` over `stage`, its layer shaped as `compositor` keeps one, `films` of them. */
export function createStampSheetTargets(device: StampPaintDevice, stage: StampStage, compositor: StampPaintCompositor, films: number) {
  const { width, height } = stage, shape = compositor.targets.layer;
  if (shape.kind !== 'array') throw new Error('stamp sheet: a sheet solve paints in pigment, whose layers are arrays');
  const plain = (w: number, h: number, format: GPUTextureFormat, usage: number): StampDepositTarget => {
    const texture = device.createTexture({ size: [w, h], format, usage: usage | SAMPLED });
    return { texture, view: texture.createView() };
  };
  const layered = (usage: number): StampSheetLayered => {
    const texture = device.createTexture({ size: [width, height, shape.layers], format: 'rgba16float', usage: usage | SAMPLED });
    return {
      texture, view: texture.createView({ dimension: '2d-array' }),
      layers: Array.from({ length: shape.layers }, (_, layer) => texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 })),
    };
  };
  const halfW = Math.ceil(width / 2), halfH = Math.ceil(height / 2);
  const working = layered(STORAGE | RENDER | COPIED);
  const filmTargets = Array.from({ length: films }, () => layered(STORAGE | COPIED));
  let current: number | null = null;
  const whole = { width, height, depthOrArrayLayers: shape.layers };
  return {
    working,
    mask: plain(width, height, 'rg16float', RENDER),
    cap: plain(width, height, 'rgba16float', RENDER),
    blurA: plain(halfW, halfH, 'rgba16float', STORAGE),
    blurB: plain(halfW, halfH, 'rgba16float', STORAGE),
    clip: plain(width, height, 'rgba16float', STORAGE | RENDER | COPIED),
    blank: plain(1, 1, 'r8unorm', 0),
    touch: plain(width, height, 'r16float', RENDER),
    footprint: plain(width, height, 'rgba16float', STORAGE),
    fresh: layered(STORAGE),
    paper: plain(width, height, STAMP_WET_FIELD_FORMATS.paper, STORAGE),
    rim: plain(width, height, STAMP_WET_FIELD_FORMATS.rim, STORAGE | RENDER),
    landing: plain(width, height, STAMP_WET_FIELD_FORMATS.landing, STORAGE),
    scale: plain(width, height, STAMP_WET_FIELD_FORMATS.scale, STORAGE),
    open: plain(width, height, 'r32float', STORAGE | RENDER),
    /** A wash's clip base kept (stampSheetFieldPasses' clipBase), for a later wash clipping to it. */
    savedClip: () => plain(width, height, 'rgba16float', STORAGE),
    /** Film `film` in the working layer, the film there before put back first. */
    swap(encoder: GPUCommandEncoder, film: number) {
      if (current === film) return;
      if (current !== null) encoder.copyTextureToTexture({ texture: working.texture }, { texture: filmTargets[current].texture }, whole);
      encoder.copyTextureToTexture({ texture: filmTargets[film].texture }, { texture: working.texture }, whole);
      current = film;
    },
    /** Film `film` as it stands now: the working layer while it's swapped in. */
    film: (film: number) => (current === film ? working : filmTargets[film]),
    /** Puts the film in the working layer back, so every film stands in its own. */
    putBack(encoder: GPUCommandEncoder) {
      if (current !== null) encoder.copyTextureToTexture({ texture: working.texture }, { texture: filmTargets[current].texture }, whole);
      current = null;
    },
  };
}

export type StampSheetTargets = ReturnType<typeof createStampSheetTargets>;

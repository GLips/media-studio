// stamp-sheet-targets.ts: what a sheet solve paints in, the owner's targets (owner.target) for the stage's size,
// shared by every solve of that size: one film a layer, one working layer the deposit pass and the wet stages paint
// into, and the core its schedule reduces over. A film is worked on in the working layer, swapped in whole: stages
// bind it once, as they load.
//
// Warning: targets outlast a solve, and nothing a solve reads may be an earlier one's. Its start clears the films
// (`clear`), its field's prepare the paper and rim; the open mask is cleared before each marking, the clip written at
// each wash's start; each deposit rewrites its scratch (mask, cap, blurs, footprint, fresh, core).

import type { StampStage } from '../models/stamp-stage.ts';
import type { StampPaintCompositor } from './stamp-paint-compositor.ts';
import type { StampDepositTarget } from './stamp-deposit-drawing.ts';
import { clearStampTarget } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import { STAMP_WET_FIELD_FORMATS } from './stamp-wet-field.ts';

const RENDER = GPUTextureUsage.RENDER_ATTACHMENT, STORAGE = GPUTextureUsage.STORAGE_BINDING, SAMPLED = GPUTextureUsage.TEXTURE_BINDING;
const COPIED = GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;

/** A layered target: its texture, a view of it as an array, and a view of each layer. */
export type StampSheetLayered = StampDepositTarget & { layers: readonly GPUTextureView[] };

/** A sheet solve's targets from `owner` over `stage`, its layer shaped as `compositor` keeps one, `films` of them. */
export function createStampSheetTargets(owner: StampPaintGpuOwner, stage: StampStage, compositor: StampPaintCompositor, films: number) {
  const { width, height } = stage, shape = compositor.targets.layer;
  if (shape.kind !== 'array') throw new Error('stamp sheet: a sheet solve paints in pigment, whose layers are arrays');
  // Names start "sheet", apart from the renderer's targets of the same size.
  const plain = (name: string, w: number, h: number, format: GPUTextureFormat, usage: number): StampDepositTarget => {
    const texture = owner.target(`sheet ${name}`, { size: [w, h], format, usage: usage | SAMPLED });
    return { texture, view: texture.createView() };
  };
  const layered = (name: string, usage: number): StampSheetLayered => {
    const texture = owner.target(`sheet ${name}`, { size: [width, height, shape.layers], format: 'rgba16float', usage: usage | SAMPLED });
    return {
      texture, view: texture.createView({ dimension: '2d-array' }),
      layers: Array.from({ length: shape.layers }, (_, layer) => texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 })),
    };
  };
  const halfW = Math.ceil(width / 2), halfH = Math.ceil(height / 2);
  const working = layered('working layer', STORAGE | RENDER | COPIED);
  const filmTargets = Array.from({ length: films }, (_, f) => layered(`film ${f}`, STORAGE | RENDER | COPIED));
  let current: number | null = null;
  const whole = { width, height, depthOrArrayLayers: shape.layers };
  return {
    working,
    mask: plain('mask', width, height, 'rg16float', RENDER),
    cap: plain('cap', width, height, 'rgba16float', RENDER),
    blurA: plain('blur a', halfW, halfH, 'rgba16float', STORAGE),
    blurB: plain('blur b', halfW, halfH, 'rgba16float', STORAGE),
    clip: plain('clip', width, height, 'rgba16float', STORAGE | RENDER | COPIED),
    blank: plain('blank', 1, 1, 'r8unorm', 0),
    touch: plain('touch', width, height, 'r16float', RENDER),
    /** The core a schedule reduces over: an application's touch, drawn before its decision (drawTouch). */
    core: plain('core', width, height, 'r16float', RENDER),
    footprint: plain('footprint', width, height, 'rgba16float', STORAGE),
    fresh: layered('fresh', STORAGE),
    paper: plain('paper', width, height, STAMP_WET_FIELD_FORMATS.paper, STORAGE),
    rim: plain('rim', width, height, STAMP_WET_FIELD_FORMATS.rim, STORAGE | RENDER),
    landing: plain('landing', width, height, STAMP_WET_FIELD_FORMATS.landing, STORAGE),
    scale: plain('scale', width, height, STAMP_WET_FIELD_FORMATS.scale, STORAGE),
    open: plain('open', width, height, 'r32float', STORAGE | RENDER),
    /** What a compositor reading a deposit's pressure or the layer before it reads; null for one that doesn't. */
    press: compositor.reads.press ? plain('press', width, height, 'r16float', RENDER) : null,
    before: compositor.reads.before ? layered('before', GPUTextureUsage.COPY_DST) : null,
    /** Wash `w`'s clip base kept (stampSheetFieldPasses' clipBase), for a later wash clipping to it; written whole. */
    savedClip: (w: number) => plain(`clip base ${w}`, width, height, 'rgba16float', STORAGE),
    /** Clears what a solve reads before it writes: every film, and no film in the working layer. */
    clear(encoder: GPUCommandEncoder) {
      for (const film of filmTargets) for (const view of film.layers) clearStampTarget(encoder, view);
      current = null;
    },
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

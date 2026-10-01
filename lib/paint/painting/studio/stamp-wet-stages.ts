// stamp-wet-stages.ts: what a wash does beyond the pixel it lands on. A deposit lands per pixel (the compositor's
// landDeposit); a stage then works over the neighbourhood of its group's layer: wet paint running into water, a
// bloom's cauliflower edge, pigment gathering at a drying rim. The renderer runs every stage after each wash deposit
// it lands (`after: 'deposit'`) or as each of a wash's dryings ends (`after: 'drying'`), in the order listed.
//
// Warning: a stage keeps nothing from one moment to the next but what it writes into the group's layer. A frame may
// start partway through a group from a checkpoint (stamp-paint-checkpoints.ts), which restores the layer alone.

import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { StampWetLanding, StampWetness } from '../models/stamp-wetness.ts';
import type { StampWashDrying } from '../models/stamp-wet-rim.ts';
import type { CompiledStampDeposit, CompiledStampPaint, CompiledStampPass } from '../models/stamp-paint-recipe-compile.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampWashLayer } from './stamp-paint-compositor.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';
import { STAMP_BLOOM_STAGE } from './stamp-wet-bloom.ts';
import { STAMP_WET_FLOW_STAGE } from './stamp-wet-flow.ts';
import { STAMP_DRYING_RIM_STAGE } from './stamp-wet-rim.ts';

/**
 * What a stage is given as a painting loads. `layer` is the group layer it works on, whole and by layer, kept as
 * `wash` says; `footprint` is each wash deposit's resolve over its box (StampWetDepositMoment); `fresh`, shaped as the
 * layer, is what a paint deposit laid where footprint r > 0.
 */
export type StampWetStageContext = {
  device: StampPaintDevice;
  painting: CompiledStampPaint;
  medium: PaintMedium;
  wetness: StampWetness;
  width: number;
  height: number;
  layer: { texture: GPUTexture; view: GPUTextureView; layers: readonly GPUTextureView[] };
  wash: StampWashLayer;
  footprint: { texture: GPUTexture; view: GPUTextureView };
  fresh: { texture: GPUTexture; view: GPUTextureView; layers: readonly GPUTextureView[] };
  /** Every landing's paper before it, uploaded once: its wetness, workable and settled, one after another from its first. */
  grids: { buffer: GPUBuffer; firsts: ReadonlyMap<CompiledStampDeposit, number> };
  /** How deep the paper's tooth takes paint (its grain's depth), 0 for a paper without. */
  paperDepth: number;
};

/**
 * A wash deposit landed over `box`, the footprint holding the coverage it laid (r), where paint may land (g), and the
 * paper's tooth there and its mean (ba). Deposit and pass are as written, even in a boil's epoch; `seed`, a stage's
 * randomness, is the epoch's own, re-rolling at the authored rate.
 */
export type StampWetDepositMoment = { deposit: CompiledStampDeposit; pass: CompiledStampPass; landing: StampWetLanding; box: StampPixelBox; seed: number };

/** One of a wash's dryings done (stampWashDryings), as written; `seed` as a deposit moment's, of the drying's ID. */
export type StampWetDryingMoment = { drying: StampWashDrying; seed: number };

/** A stage as a painting holds it once loaded, encoding at its moments. */
export type StampLoadedWetStage<Moment> = {
  /**
   * Readies it for a deposit box as big as `box`, before any frame that draws one: the renderer calls it for every
   * wash deposit as it loads them (a boil's epoch's too), so scratch grows only between frames.
   */
  reserve?: (box: { w: number; h: number }) => void;
  /** Adds its work to a frame's encoder and returns the pixels it changed (null for none), which the group is laid over. */
  encode: (encoder: GPUCommandEncoder, moment: Moment) => StampPixelBox | null;
  /** Whether it rims `deposit`'s wet edge itself, so the brush's own wet edge would rim it twice. */
  ownsWetEdges?: (deposit: CompiledStampDeposit) => boolean;
};

/**
 * A stage run after each wash deposit lands, or after each drying. `reach`: how far past a deposit's stamps it reads
 * and writes, px, so its landing window (compileStampWetness's margin) and resolve reach that far; static, as wetness
 * is worked out before any stage loads. `settled`: it waits for its deposit to be wholly shown.
 */
export type StampWetStage = { id: string } & (
  | {
    after: 'deposit';
    reach?: (deposit: CompiledStampDeposit, medium: PaintMedium) => number;
    settled?: boolean;
    load: (context: StampWetStageContext) => StampLoadedWetStage<StampWetDepositMoment>;
  }
  | { after: 'drying'; load: (context: StampWetStageContext) => StampLoadedWetStage<StampWetDryingMoment> }
);

/** Every stage, in the order each moment runs them. */
export const STAMP_WET_STAGES: readonly StampWetStage[] = [STAMP_WET_FLOW_STAGE, STAMP_BLOOM_STAGE, STAMP_DRYING_RIM_STAGE];

/** How far past `deposit`'s stamps any of `stages` reaches, px: its landing window's margin and its resolve's. */
export const stampWetStageReach = (stages: readonly StampWetStage[], deposit: CompiledStampDeposit, medium: PaintMedium) =>
  Math.max(0, ...stages.map((stage) => (stage.after === 'deposit' ? stage.reach?.(deposit, medium) ?? 0 : 0)));

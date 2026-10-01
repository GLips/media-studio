// stamp-wet-stages.ts: what a wash does beyond the pixel it lands on. A deposit lands per pixel (the compositor's
// landDeposit); a stage then works over the neighbourhood of its group's layer: wet paint running into water, a
// bloom's cauliflower edge, pigment gathering at a drying rim. The renderer runs every stage after each wash deposit
// it lands (`after: 'deposit'`) or once a wash's last has landed (`after: 'wash'`), in the order listed.
//
// Warning: a stage keeps nothing from one moment to the next but what it writes into the group's layer. A frame may
// start partway through a group from a checkpoint (stamp-paint-checkpoints.ts), which restores the layer alone.

import type { PaintMedium } from '#lib/picture/paint/models/paint-medium.ts';
import type { StampWashRecord, StampWetLanding, StampWetness } from '../models/stamp-wetness.ts';
import type { CompiledStampDeposit, CompiledStampPaint, CompiledStampPass } from '../models/stamp-paint-recipe.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampWashLayer } from './stamp-paint-compositor.ts';
import { STAMP_WET_FLOW_STAGE } from './stamp-wet-flow.ts';
import { STAMP_DRYING_RIM_STAGE } from './stamp-wet-rim.ts';

/**
 * What a stage is given as a painting loads. `layer` is the group layer it works on, whole and by layer, kept as
 * `wash` says; `footprint` is each wash deposit's resolve over its box (StampWetStageMoment); `fresh`, shaped as the
 * layer, is what a paint deposit laid where footprint r > 0.
 */
export type StampWetStageContext = {
  device: GPUDevice;
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
 * What a stage encodes after: a deposit landed over `box`, the footprint holding the coverage it laid (r), where
 * paint may land (g), and the paper's tooth there and its mean (ba); or a wash done. Deposit and pass are as written,
 * even in a boil's epoch; `seed`, a stage's randomness, is the epoch's own, re-rolling at the authored rate.
 */
export type StampWetStageMoment =
  | { kind: 'deposit'; deposit: CompiledStampDeposit; pass: CompiledStampPass; landing: StampWetLanding; box: StampPixelBox; seed: number }
  | { kind: 'wash'; pass: CompiledStampPass; record: StampWashRecord };

/** A stage as a painting holds it once loaded. */
export type StampLoadedWetStage = {
  /**
   * Readies it for a deposit box as big as `box`, before any frame that draws one: the renderer calls it for every
   * wash deposit as it loads them (a boil's epoch's too), so scratch grows only between frames.
   */
  reserve?: (box: { w: number; h: number }) => void;
  /** Adds its work to a frame's encoder and returns the pixels it changed (null for none), which the group is laid over. */
  encode: (encoder: GPUCommandEncoder, moment: StampWetStageMoment) => StampPixelBox | null;
};

export type StampWetStage = {
  id: string;
  after: StampWetStageMoment['kind'];
  /**
   * How far past a wash deposit's stamps it reads and writes, px: the deposit's landing window reaches that far
   * (compileStampWetness's margin) and the renderer resolves it that much wider. Static, as wetness is worked out
   * before any stage loads.
   */
  reach?: (deposit: CompiledStampDeposit, medium: PaintMedium) => number;
  load: (context: StampWetStageContext) => StampLoadedWetStage;
};

/** Every stage, in the order each moment runs them. */
export const STAMP_WET_STAGES: readonly StampWetStage[] = [STAMP_WET_FLOW_STAGE, STAMP_DRYING_RIM_STAGE];

/** How far past `deposit`'s stamps any stage reaches, px: its landing window's margin and its resolve's. */
export const stampWetStageReach = (deposit: CompiledStampDeposit, medium: PaintMedium) =>
  Math.max(0, ...STAMP_WET_STAGES.map((stage) => stage.reach?.(deposit, medium) ?? 0));

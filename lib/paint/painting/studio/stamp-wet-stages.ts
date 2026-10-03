// stamp-wet-stages.ts: what a wash does beyond the pixel it lands on. A deposit lands per pixel (the compositor's
// landDeposit); a stage then works over the neighbourhood of its group's layer: paint running into water, a bloom,
// a drying rim. The renderer runs every stage, in the order listed, after each wash deposit it lands or as each of a
// wash's dryings ends.
//
// Warning: a stage keeps nothing from one moment to the next but what it writes into the group's layer, which is
// all a group's film keeps, and reads the paper only from its wash's wet field (stamp-wet-field.ts; a deposit's, its
// landing).

import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { StampWashDrying, StampWetLanding, StampWetness } from '../models/stamp-wetness.ts';
import type { CompiledStampDeposit, CompiledStampPaint, CompiledStampPass } from '../models/stamp-paint-recipe-compile.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampStage } from '../models/stamp-stage.ts';
import type { StampWashLayer } from './stamp-paint-compositor.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';
import type { StampWetFieldViews } from './stamp-wet-field.ts';
import { STAMP_BLOOM_STAGE } from './stamp-wet-bloom.ts';
import { STAMP_WET_FLOW_STAGE } from './stamp-wet-flow.ts';
import { STAMP_DRYING_RIM_STAGE } from './stamp-wet-rim.ts';

/**
 * What a stage is given as the renderer loads, whatever it paints: `layer`, the group layer, kept as `wash` says;
 * `footprint`, each wash deposit's resolve over its box (StampWetDepositMoment); `fresh`, what it laid, shaped as the
 * layer; `field`, the wash's wet field, its landing as the deposit's water found the paper. Targets and boxes are
 * `stage` texels.
 */
export type StampWetStageContext = {
  device: StampPaintDevice;
  stage: StampStage;
  layer: { texture: GPUTexture; view: GPUTextureView; layers: readonly GPUTextureView[] };
  wash: StampWashLayer;
  footprint: { texture: GPUTexture; view: GPUTextureView };
  fresh: { texture: GPUTexture; view: GPUTextureView; layers: readonly GPUTextureView[] };
  field: StampWetFieldViews;
  /** How deep the paper's tooth takes paint (its grain's depth), 0 for a paper without. */
  paperDepth: number;
};

/**
 * A set of deposits a stage plans for (the painting as written, a boil's epoch, live marks), each wetted as its own
 * `wetness` lands it. `device` makes what's theirs, freed with them.
 */
export type StampWetBank = {
  device: StampPaintDevice;
  painting: CompiledStampPaint;
  wetness: StampWetness;
  /** The pixels a wash deposit's whole box covers, every stamp shown: the most any of its moments' boxes is. */
  boxOf: (deposit: CompiledStampDeposit) => StampPixelBox | null;
  /**
   * The wall a deposit's paint dries against as on dry paper, its region texture and box on the painting: a walled
   * flood's region (stampDepositWalled; within its pass's `within`), else its pass's `within`; null for none, or one
   * wholly off the painting. A lost edge is no wall.
   */
  wallOf: (deposit: CompiledStampDeposit) => StampWetWall | null;
};

/** A region texture worked out at load (r, 0..1) and the pixels of the painting it covers. */
export type StampWetWall = { view: GPUTextureView; box: StampPixelBox };

/**
 * A wash deposit of a bank landed over `box`, its footprint holding the share of its stroke that landed (r, its
 * water's touch is times it), where paint may land (g), and the paper's tooth and its mean (ba); the wet field's
 * landing holds what its water found and left. `seed` is its boil epoch's.
 */
export type StampWetDepositMoment = { deposit: CompiledStampDeposit; pass: CompiledStampPass; landing: StampWetLanding; box: StampPixelBox; seed: number };

/** One of a wash's dryings done (its StampWashRecord's); `seed` as a deposit moment's, of the drying's ID. */
export type StampWetDryingMoment = { drying: StampWashDrying; seed: number };

/**
 * A stage as the renderer holds it once loaded: its pipelines and scratch, shared by every bank. `plan` readies it
 * for a bank's deposits as the bank loads, between frames, growing its scratch to their boxes (StampWetBank's boxOf).
 */
export type StampLoadedWetStage<Moment> = { plan: (bank: StampWetBank) => StampWetStagePlan<Moment> };

/** A stage planned for a bank, encoding at its moments. */
export type StampWetStagePlan<Moment> = {
  /** Adds its work to a frame's encoder and returns the pixels it changed (null for none), which the group is laid over. */
  encode: (encoder: GPUCommandEncoder, moment: Moment) => StampPixelBox | null;
  /** Whether it rims `deposit`'s wet edge itself, so the brush's own wet edge would rim it twice. */
  ownsWetEdges?: (deposit: CompiledStampDeposit) => boolean;
  /**
   * How far past `deposit`'s box it reads the deposit's landing, px; null where it never runs for it, so a deposit
   * no stage reads lands without one.
   */
  landingReach?: (deposit: CompiledStampDeposit) => number | null;
};

/**
 * A stage run after each wash deposit lands, or after each drying. `reach`: how far past a deposit's stamps it reads
 * and writes, px, so what it finds (compileStampWetness's margin) and its resolve reach that far; static, as the
 * schedule is worked out before any stage loads.
 */
export type StampWetStage = { id: string } & (
  | {
    after: 'deposit';
    reach?: (deposit: CompiledStampDeposit, medium: PaintMedium, water: number) => number;
    load: (context: StampWetStageContext) => StampLoadedWetStage<StampWetDepositMoment>;
  }
  | { after: 'drying'; load: (context: StampWetStageContext) => StampLoadedWetStage<StampWetDryingMoment> }
);

/** Every stage, in the order each moment runs them. */
export const STAMP_WET_STAGES: readonly StampWetStage[] = [STAMP_WET_FLOW_STAGE, STAMP_BLOOM_STAGE, STAMP_DRYING_RIM_STAGE];

/** How far past `deposit`'s stamps, carrying `water`, any of `stages` reaches, px: what it finds' margin and its resolve's. */
export const stampWetStageReach = (stages: readonly StampWetStage[], deposit: CompiledStampDeposit, medium: PaintMedium, water: number) =>
  Math.max(0, ...stages.map((stage) => (stage.after === 'deposit' ? stage.reach?.(deposit, medium, water) ?? 0 : 0)));

// stamp-wet-stages.ts: what a wash does beyond the pixel it lands on. A deposit lands per pixel (the compositor's
// landDeposit); a stage then works over the neighbourhood of its group's layer: paint running into water, a bloom,
// a drying rim. Every stage (stamp-wet-stage-list.ts) runs, in the order listed, after each wash deposit lands or as
// each of a wash's dryings ends.
//
// Warning: a stage keeps nothing from one moment to the next but what it writes into the group's layer, which is
// all a group's film keeps, and reads the paper only from its wash's wet field (stamp-wet-field.ts; a deposit's, its
// landing).

import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { StampWashDrying, StampWetLanding } from '../models/stamp-wetness.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe-compile.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampStage } from '../models/stamp-stage.ts';
import type { StampWashLayer } from './stamp-paint-compositor.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';
import type { StampWetFieldViews } from './stamp-wet-field.ts';

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
};

/**
 * A set of deposits a stage plans for (a painting as written, a boil's epoch, live marks, a solve's), each wash
 * deposit landing as `landings` says, its washes drying as `dryings` (in painting order) say. `device` makes what's
 * theirs, freed with them.
 */
export type StampWetBank = {
  device: StampPaintDevice;
  landings: ReadonlyMap<CompiledStampDeposit, StampWetLanding>;
  dryings: readonly StampWashDrying[];
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
 * A wash deposit landed over `box`, its footprint holding the share of its stroke that landed (r), where paint may
 * land (g), and the paper's tooth and its mean (ba). `seed` is its boil epoch's; `paperDepth`, its paper grain's
 * depth, 0 for none.
 */
export type StampWetDepositMoment = { deposit: CompiledStampDeposit; landing: StampWetLanding; box: StampPixelBox; seed: number; paperDepth: number };

/** One of a wash's dryings done; `seed` as a deposit moment's, of the drying's ID. */
export type StampWetDryingMoment = { drying: StampWashDrying; seed: number };

/** Scratch a stage's encodes work in: as wide and tall as their boxes, holding as many layers as their groups' films. */
export type StampWetStageExtent = { w: number; h: number; layers: number };

/**
 * A stage as loaded: its pipelines and scratch, shared by every bank. `plan` readies it for a bank's deposits,
 * making nothing its encodes share. `reserve` grows the scratch to hold `extent` (planStampWetStage, or once at a
 * solve's start): encodes after it bind the new, and the old is destroyed once the encoder recording it is submitted.
 */
export type StampLoadedWetStage<Moment> = {
  plan: (bank: StampWetBank) => StampWetStagePlan<Moment>;
  reserve: (extent: StampWetStageExtent) => void;
};

/** A stage planned for a bank, encoding at its moments. */
export type StampWetStagePlan<Moment> = {
  /** The most scratch its encodes need (null for none): what reserve must hold before it encodes. */
  extent: StampWetStageExtent | null;
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

/** `stage` planned for `bank`, its scratch grown to hold the plan. */
export function planStampWetStage<Moment>(stage: StampLoadedWetStage<Moment>, bank: StampWetBank): StampWetStagePlan<Moment> {
  const plan = stage.plan(bank);
  if (plan.extent) stage.reserve(plan.extent);
  return plan;
}

/** A wash's stages as loaded, by when each runs, each list in the order STAMP_WET_STAGES gives. */
export type StampLoadedWetStages = {
  deposit: readonly StampLoadedWetStage<StampWetDepositMoment>[];
  drying: readonly StampLoadedWetStage<StampWetDryingMoment>[];
};

/** A wash's stages planned for a bank, by when each runs. */
export type StampWetStagePlans = {
  deposit: readonly StampWetStagePlan<StampWetDepositMoment>[];
  drying: readonly StampWetStagePlan<StampWetDryingMoment>[];
};

/** Each of `stages` planned for `bank` (planStampWetStage). */
export const planStampWetStages = (stages: StampLoadedWetStages, bank: StampWetBank): StampWetStagePlans => ({
  deposit: stages.deposit.map((stage) => planStampWetStage(stage, bank)),
  drying: stages.drying.map((stage) => planStampWetStage(stage, bank)),
});

/** Whether any of `plans` rims `deposit`'s wet edge itself (ownsWetEdges), so its brush's own wet edges stand down. */
export const stampWetStagesOwnWetEdges = (plans: StampWetStagePlans, deposit: CompiledStampDeposit) =>
  [...plans.deposit, ...plans.drying].some((plan) => plan.ownsWetEdges?.(deposit));

/** The least extent holding each of `extents` (null for none). */
export function stampWetStageExtentOf(extents: Iterable<StampWetStageExtent | null>): StampWetStageExtent | null {
  return [...extents].reduce<StampWetStageExtent | null>((most, extent) => {
    if (!extent) return most;
    return most ? { w: Math.max(extent.w, most.w), h: Math.max(extent.h, most.h), layers: Math.max(extent.layers, most.layers) } : extent;
  }, null);
}

/** How far past `deposit`'s stamps, carrying `water`, any of `stages` reaches, px: what it finds' margin and its resolve's. */
export const stampWetStageReach = (stages: readonly StampWetStage[], deposit: CompiledStampDeposit, medium: PaintMedium, water: number) =>
  Math.max(0, ...stages.map((stage) => (stage.after === 'deposit' ? stage.reach?.(deposit, medium, water) ?? 0 : 0)));

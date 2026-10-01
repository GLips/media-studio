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
import { STAMP_WET_FLOW_STAGE } from './stamp-wet-flow.ts';
import { STAMP_LIFT_RUN_BACK_STAGE } from './stamp-wet-lift-run-back.ts';
import { STAMP_DRYING_RIM_STAGE } from './stamp-wet-rim.ts';

/**
 * What a stage is given as a painting loads: its device, size, medium and wetness; the group layer it works on
 * (coverage, then pigment amounts), whole and by layer; `footprint`, where each wash deposit's resolve is left over
 * its box (StampWetStageMoment); and `fresh`, shaped as the layer: what a paint deposit laid, where footprint r > 0.
 */
export type StampWetStageContext = {
  device: GPUDevice;
  painting: CompiledStampPaint;
  medium: PaintMedium;
  wetness: StampWetness;
  width: number;
  height: number;
  layer: { texture: GPUTexture; view: GPUTextureView; layers: readonly GPUTextureView[] };
  footprint: { texture: GPUTexture; view: GPUTextureView };
  fresh: { texture: GPUTexture; view: GPUTextureView; layers: readonly GPUTextureView[] };
};

/**
 * What a stage encodes after: a deposit landed over `box`, the footprint then holding, per pixel of the box, the
 * coverage it laid (r, kept: fluid, `within` and clip applied) and where paint may land (g: the fluid, `within` and
 * clip alone); or a wash done. Its deposit and pass are as written, even in a boil's epoch.
 */
export type StampWetStageMoment =
  | { kind: 'deposit'; deposit: CompiledStampDeposit; pass: CompiledStampPass; landing: StampWetLanding; box: StampPixelBox }
  | { kind: 'wash'; pass: CompiledStampPass; record: StampWashRecord };

export type StampWetStage = {
  id: string;
  after: StampWetStageMoment['kind'];
  /**
   * Made once a painting loads; `encode` adds its work to a frame's encoder and returns the pixels it changed (null
   * for none), which the renderer lays the group over with its deposits'. `reach`: how far past a wash deposit's
   * stamps it works, px, so the renderer resolves the deposit that much wider.
   */
  load: (context: StampWetStageContext) => {
    reach?: (deposit: CompiledStampDeposit) => number;
    encode: (encoder: GPUCommandEncoder, moment: StampWetStageMoment) => StampPixelBox | null;
  };
};

/** Every stage, in the order each moment runs them. */
export const STAMP_WET_STAGES: readonly StampWetStage[] = [STAMP_LIFT_RUN_BACK_STAGE, STAMP_WET_FLOW_STAGE, STAMP_DRYING_RIM_STAGE];

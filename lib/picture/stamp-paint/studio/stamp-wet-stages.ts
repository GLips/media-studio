// stamp-wet-stages.ts: what a wash does beyond the pixel it lands on. A deposit lands per pixel (the compositor's
// landDeposit); a stage then works over the neighbourhood of its group's layer: wet paint running into water, a
// bloom's cauliflower edge, pigment gathering at a drying rim. The renderer runs every stage after each wash deposit
// it lands (`after: 'deposit'`) or once a wash's last has landed (`after: 'wash'`), in the order listed.

import type { PaintMedium } from '#lib/picture/paint/models/paint-medium.ts';
import type { StampWashRecord, StampWetLanding, StampWetness } from '../models/stamp-wetness.ts';
import type { CompiledStampDeposit, CompiledStampPaint, CompiledStampPass } from '../models/stamp-paint-recipe.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import { STAMP_LIFT_RUN_BACK_STAGE } from './stamp-wet-lift-run-back.ts';

/**
 * What a stage is given as the renderer loads a painting: its device, the painting's size, medium and wetness; the
 * group layer it works on, rgba16float layers (coverage, then pigment amounts), whole and by layer; and `footprint`,
 * rgba16float, where the renderer leaves each wash deposit's resolve over its box (StampWetStageMoment).
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
};

/**
 * What a stage encodes after: a deposit landed over `box`, the footprint then holding, per pixel of the box, the
 * coverage it laid (r, kept: fluid, `within` and clip applied) and where paint may land (g: the fluid, `within` and
 * clip alone); or a wash done.
 */
export type StampWetStageMoment =
  | { kind: 'deposit'; deposit: CompiledStampDeposit; pass: CompiledStampPass; landing: StampWetLanding; box: StampPixelBox }
  | { kind: 'wash'; pass: CompiledStampPass; record: StampWashRecord };

export type StampWetStage = {
  id: string;
  after: StampWetStageMoment['kind'];
  /**
   * Made once a painting loads; `encode` adds its work to a frame's encoder and returns the pixels it changed (null
   * for none), which the renderer lays the group over along with its deposits'.
   */
  load: (context: StampWetStageContext) => { encode: (encoder: GPUCommandEncoder, moment: StampWetStageMoment) => StampPixelBox | null };
};

/** Every stage, in the order each moment runs them. */
export const STAMP_WET_STAGES: readonly StampWetStage[] = [STAMP_LIFT_RUN_BACK_STAGE];

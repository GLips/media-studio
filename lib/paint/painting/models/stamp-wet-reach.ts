// stamp-wet-reach.ts: how far a sheet deposit's water carries past its stamps, as pure arithmetic, so what a sheet
// loads (each deposit's box) and how far a wrapped sheet's halo reaches (stamp-sheet-wrap.ts) read one account of it
// before anything loads.
//
// Warning: it must hold every wet stage in STAMP_WET_STAGES that runs after a deposit, the flow's and the bloom's; a
// new one adds its reach here. The drying rim runs at a drying, within what was wetted.

import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { CompiledStampDeposit } from './stamp-paint-recipe-compile.ts';
import { stampBloomReach } from './stamp-wet-bloom.ts';
import { stampWetFlowReach, type StampWetCarrier } from './stamp-wet-flow.ts';

/** How far past its stamps `deposit`, giving `water`, carries paint in `medium`, px: its flow's or its bloom's reach. */
export const stampWetDepositReach = (deposit: StampWetCarrier, medium: PaintMedium, water: number) =>
  Math.max(stampWetFlowReach(deposit, medium), stampBloomReach(deposit, medium, water));

/**
 * How far `deposit`'s water carries on a sheet whose films are in `media`, px: in its own `medium` or any film's, as
 * its water lands in every film's paint.
 */
export const stampSheetWetReach = (media: readonly PaintMedium[], deposit: CompiledStampDeposit, medium: PaintMedium, water: number) =>
  Math.max(...[medium, ...media].map((each) => stampWetDepositReach(deposit, each, water)));

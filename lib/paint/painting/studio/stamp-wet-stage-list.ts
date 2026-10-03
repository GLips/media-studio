// stamp-wet-stage-list.ts: every wet stage there is (stamp-wet-stages.ts), apart from the contract they keep, so a
// stage reads the contract's helpers without importing itself back.

import { STAMP_BLOOM_STAGE } from './stamp-wet-bloom.ts';
import { STAMP_WET_FLOW_STAGE } from './stamp-wet-flow.ts';
import { STAMP_DRYING_RIM_STAGE } from './stamp-wet-rim.ts';
import type { StampWetStage } from './stamp-wet-stages.ts';

/** Every stage, in the order each moment runs them. */
export const STAMP_WET_STAGES: readonly StampWetStage[] = [STAMP_WET_FLOW_STAGE, STAMP_BLOOM_STAGE, STAMP_DRYING_RIM_STAGE];

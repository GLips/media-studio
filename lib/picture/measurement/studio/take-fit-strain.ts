// take-fit-strain.ts: fits (take.ts) that play a take, or retimes that play generated footage, too far from its own
// pace, noted as scenes render so the framing probe can hand them to `studio check`. Both are computed in render,
// where nothing else reaches the check.
// Not part of the authoring api.

import type { TakeFitStrain } from '../models/framing-marks.ts';

// Keyed, so renders without a probe to drain it don't grow it.
const strainsSinceDrain = new Map<string, TakeFitStrain>();

export function noteTakeFitStrain(strain: TakeFitStrain) {
  strainsSinceDrain.set(JSON.stringify(strain), strain);
}

/** The strained fits noted since the last call: the frame's, when the probe calls it once each frame. */
export function drainTakeFitStrains(): TakeFitStrain[] {
  const strains = [...strainsSinceDrain.values()];
  strainsSinceDrain.clear();
  return strains;
}

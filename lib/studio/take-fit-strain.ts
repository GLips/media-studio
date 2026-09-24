// take-fit-strain.ts: fits (take.ts) that play a take too far from its own pace, noted as scenes render so the
// framing probe can hand them to `studio check`. fitTake is called from render, where nothing else reaches the check.
// Not part of the authoring api.

/** Two neighbouring pins of a fit that play the take between them at `speed` times its own pace. */
export type TakeFitStrain = { from: string; to: string; speed: number };

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

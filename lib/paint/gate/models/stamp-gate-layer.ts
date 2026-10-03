// stamp-gate-layer.ts: what the gate's property checks read off a group's layer read back: a pigment slot's amounts,
// their total, and whether a wet effect kept every pigment's total.

/** A layer as the renderer reads one back (StampLayerReadback), restated so models needn't import the studio. */
export type StampGateLayer = { width: number; height: number; layers: number; values: Float32Array };

/** How far a pigment's total may drift from the same wash's without the ops under test: its layer's half-float rounding summed over a few thousand pixels. */
export const STAMP_GATE_CONSERVED_TOLERANCE = 0.005;

/** How far past a bound a pixel's amount may read: a half-float's step near the small amounts these bounds sit at. */
export const STAMP_GATE_LAYER_TOLERANCE = 2e-3;

/** `slot`'s amount at each pixel of `layer`. */
export function stampGateSlotAmounts(layer: StampGateLayer, slot: number): Float32Array {
  const channel = slot + 1, l = channel >> 2, c = channel & 3, pixels = layer.width * layer.height;
  return Float32Array.from({ length: pixels }, (_, i) => layer.values[(l * pixels + i) * 4 + c]);
}

/** A pigment's amounts summed over a layer. */
export const stampGateTotal = (amounts: Float32Array) => amounts.reduce((sum, v) => sum + v, 0);

/** One of a case's checks as the gate reports it. */
export type StampGateWashCheck = { id: string; passed: boolean; detail: string };

/** Whether each pigment's total in `subject`'s layer is `without`'s, within STAMP_GATE_CONSERVED_TOLERANCE of it. */
export function checkStampGateConserved(id: string, pigments: readonly string[], subject: StampGateLayer, without: StampGateLayer): StampGateWashCheck {
  const drifts = pigments.map((pigment, slot) => {
    const had = stampGateTotal(stampGateSlotAmounts(without, slot)), has = stampGateTotal(stampGateSlotAmounts(subject, slot));
    return { pigment, had, has, drift: had > 0 ? Math.abs(has - had) / had : has };
  });
  const worst = drifts.reduce((a, b) => (b.drift > a.drift ? b : a));
  return {
    id: `${id}: conserved`, passed: drifts.every(({ drift }) => drift <= STAMP_GATE_CONSERVED_TOLERANCE),
    detail: drifts.map(({ pigment, had, has }) => `${pigment} ${had.toFixed(1)} → ${has.toFixed(1)}`).join(', ') + `; worst drift ${(worst.drift * 100).toFixed(3)}% (${worst.pigment}), past ${STAMP_GATE_CONSERVED_TOLERANCE * 100}% fails`,
  };
}

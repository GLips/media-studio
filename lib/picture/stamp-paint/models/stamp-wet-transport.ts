// stamp-wet-transport.ts: how anything moves across wet paper in the wet stages (flow, bloom, drying rim). A ladder of
// passes trades between pixels a stride apart, x then y, the stride growing about √2 a level, so a spread sigma px
// wide costs a few passes, not sigma² taps. A pair trades only as far as the paper between lets: its driest (wet) and
// least open to paint (open), so nothing crosses a dry gap, masking fluid or a `within`'s edge.
// studio/stamp-wet-transport.ts runs it.

/**
 * The passes a spread of up to `sigma` px takes: each's stride, and the variance the passes before it lay when each
 * is taken whole (transportLevelShare's `before`). None for 0.
 */
export function stampWetTransportStrides(sigma: number): { stride: number; before: number }[] {
  const strides: { stride: number; before: number }[] = [];
  for (let stride = 1, before = 0; before < sigma * sigma; stride = Math.max(stride + 1, Math.round(stride * Math.SQRT2))) {
    strides.push({ stride, before });
    before += (stride * stride) / 2;
  }
  return strides;
}

/** How far a spread of `sigma` px reaches, px: three of its sigma. */
export const stampWetTransportReach = (sigma: number) => (sigma > 0 ? Math.ceil(3 * sigma) : 0);

/** The ladder's law per pixel pair and pass. */
export const STAMP_WET_TRANSPORT_WGSL = /* wgsl */ `
// How much of a pass at \`stride\` a pair whose spread is \`sigma\` wide takes, the passes below having laid \`before\`.
fn transportLevelShare(sigma: f32, stride: f32, before: f32) -> f32 {
  return clamp((sigma * sigma - before) / (stride * stride * 0.5), 0.0, 1.0);
}
// The share of a pass two pixels trade, by the driest paper on the way between (a spread over paper as wet as \`wet\`
// is that much narrower) and the least open to paint. At most 1/4 a partner, so a pixel keeps at least half.
fn transportConductance(sigma: f32, stride: f32, before: f32, wet: f32, open: f32) -> f32 {
  return 0.25 * transportLevelShare(sigma * clamp(wet, 0.0, 1.0), stride, before) * clamp(open, 0.0, 1.0);
}`;

// stamp-deposit-keep.ts: how much of a deposit's paint is kept at a point, apart from its brush: under its masking
// fluid, within its pass's region, and for a fill its load and how far its front has crossed. The renderer's resolve
// reads the same, the fluid and `within` from textures worked out at load (stamp-paint-renderer.ts), the load and
// front per pixel; the CPU reference reads this.

import { STAMP_FILL_FRONT_SHARE } from './stamp-fill.ts';
import { stampPaintFieldAt } from './stamp-paint-field.ts';
import { stampFillProgressAt, type CompiledStampDeposit, type CompiledStampMask } from './stamp-paint-recipe.ts';
import { stampEdgeCoverage, stampEdgedCoverage, stampPolygonDistance, type StampPoint } from './stamp-region.ts';

/**
 * The masking fluid at (x, y), 0..1: each op in turn over the fluid before it, a mask joined by max, an unmask lifting
 * its amount of it, everywhere when it has no region. What paint lands there is (1 − fluid) of it.
 */
export function stampMaskFluidAt(mask: CompiledStampMask | null, x: number, y: number): number {
  if (!mask) return 0;
  const under = stampMaskFluidAt(mask.under, x, y);
  const r = mask.area ? stampEdgedCoverage(mask.area.polygon, mask.area.edge, mask.area.seed, x, y) : 1;
  return mask.kind === 'mask' ? Math.max(under, r) : under * (1 - mask.amount * r);
}

/** The share of `deposit`'s paint kept at (x, y) at `t` seconds, its pass `within` a region (null for none). */
export function stampDepositKeepAt(deposit: CompiledStampDeposit, within: readonly StampPoint[] | null, t: number, x: number, y: number): number {
  let keep = 1 - stampMaskFluidAt(deposit.mask, x, y);
  if (within) keep *= stampEdgeCoverage(stampPolygonDistance(within, x, y), 1);
  if (deposit.kind === 'fill') {
    keep *= Math.min(1, Math.max(0, stampPaintFieldAt(deposit.fill.load, x, y)));
    keep *= STAMP_FILL_FRONT_SHARE.cpu(deposit.fill.front, stampFillProgressAt(deposit, t), x, y);
  }
  return keep;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { stampBloomBound } from './stamp-wet-bloom.ts';

const watercolour = PAINT_MEDIA.watercolour;
const drop = { action: { kind: 'water' as const, water: 0.7 }, diameter: 36 };
const workable = { wet: true, workable: true };

test('a drop may bloom on paint still workable, as wide as its water could drive it; on set paint, as a lift, or in crayon, never', () => {
  const bound = stampBloomBound(drop, { water: 0.7, medium: watercolour, finds: workable });
  assert.ok(bound.sigma !== null && bound.sigma > 10);
  assert.match(stampBloomBound(drop, { water: 0.7, medium: watercolour, finds: { wet: false, workable: false } }).reason ?? '', /has set/);
  assert.match(stampBloomBound({ ...drop, action: { kind: 'lift', strength: 1 } }, { water: 0, medium: watercolour, finds: workable }).reason ?? '', /lift/);
  const crayon = { ...watercolour, wetting: { ...watercolour.wetting, spread: 0 } };
  assert.match(stampBloomBound(drop, { water: 0.7, medium: crayon, finds: workable }).reason ?? '', /doesn't spread/);
});

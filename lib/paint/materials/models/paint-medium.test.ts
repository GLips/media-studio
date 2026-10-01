import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPaintCapability, PAINT_MEDIA, paintMediumCan } from './paint-medium.ts';

test('a painting is held to what its medium declares: crayon lifts and burnishes but has no sheen to wait for; flat colour declares nothing', () => {
  const { watercolour, crayon } = PAINT_MEDIA;
  assert.doesNotThrow(() => checkPaintCapability(crayon, 'lift', 'g/p/erase'));
  assert.doesNotThrow(() => checkPaintCapability(crayon, 'burnish', 'g/p/lit'));
  assert.throws(() => checkPaintCapability(crayon, 'wet-conditions', "g/p/drop's wait for damp"), /g\/p\/drop's wait for damp needs 'wet-conditions', which crayon doesn't declare/);
  assert.throws(() => checkPaintCapability(watercolour, 'burnish', 'g/p/lit'), /which watercolour doesn't declare/);
  assert.throws(() => checkPaintCapability(null, 'lift', 'g/p/erase'), /which flat colour, in no medium, doesn't declare/);
  // Every medium has wetting and a sheen, crayon's too: neither makes a capability.
  assert.equal(paintMediumCan({ ...crayon, wetting: watercolour.wetting }, 'wet-conditions'), false);
});

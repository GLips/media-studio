import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPriceHold, explainPriceHold, PRICE_HOLD_CLEAN, type PriceHoldParams } from './hold-price.ts';

const explain = (p: PriceHoldParams) => {
  const verdict = checkPriceHold(p, 30);
  return { verdict, plain: explainPriceHold(verdict, p.need) };
};

test('the clean scene keeps its hold and says for how long', () => {
  const { verdict, plain } = explain(PRICE_HOLD_CLEAN);
  assert.equal(verdict.problem, null);
  assert.match(plain, /^It sat still and fully visible for [\d.]+s \([\d.]+s to [\d.]+s\)/);
});

// explainPriceHold rewords hold-check's message by its phrasing; a reworded message would leak through raw.
test('every broken hold is explained in plain words, none of the check’s own', () => {
  for (const change of [{ wobble: 2.5 }, { entrance: 3.2 }, { drift: 3 }, { fadeAt: 1.8 }, { peak: 0.85 }]) {
    const { verdict, plain } = explain({ ...PRICE_HOLD_CLEAN, ...change });
    assert.notEqual(verdict.problem, null, JSON.stringify(change));
    assert.doesNotMatch(plain, /its [xy] |opaque|Review:|holds within/, plain);
  }
});

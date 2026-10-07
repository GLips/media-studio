import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampCanonicalDigest, stampCanonicalJson, type StampCanonicalDatum } from './stamp-sheet-state-key.ts';

test('two values share a digest exactly when their canonical JSON is equal, whatever was digested before', () => {
  const long = 'x'.repeat(70_000);
  const values: StampCanonicalDatum[] = [
    {}, { '': 1 }, { a: 1, b: 2 }, { b: 2, a: 1 }, { 'a\u0000b': 1 }, { a: 1, b: undefined }, { a: 1, b: () => 1 },
    [{ x: 1, y: 2 }, { y: 2, x: 1 }, { x: 1 }], [{ x: 1, y: 2 }, { x: 1, y: 2 }, { x: 1 }], [{ x: 1 }, { x: 1, y: 2 }],
    { a: [{ p: 1 }, { p: [{ p: 2 }] }] }, { a: [{ p: 1 }, { p: [{ q: 2 }] }] },
    [0], [-0], [NaN], ['NaN'], [Infinity], ['Infinity'], [1, '1'], [1, 1], [[1]], [null], [undefined], [() => 1],
    new Float32Array([0.5, 1]), [0.5, 1], new Set([1, 2]), new Map([[1, 'a']]), [[1, 'a']],
    [long, 1], [long, 2], { [long]: 1 }, true, false, 'true', null,
  ];
  const before = values.map(stampCanonicalDigest);
  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values.length; j++) {
      const sameJson = stampCanonicalJson(values[i]) === stampCanonicalJson(values[j]);
      assert.equal(before[i] === before[j], sameJson, `${stampCanonicalJson(values[i]).slice(0, 60)} vs ${stampCanonicalJson(values[j]).slice(0, 60)}`);
    }
  }
  // Digested again in reverse, after every other: the same digests.
  assert.deepEqual(values.toReversed().map(stampCanonicalDigest).toReversed(), before);
});

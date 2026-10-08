import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerStampCanonicalList, stampCanonicalDigest, stampCanonicalJson, type StampCanonicalDatum } from './stamp-canonical.ts';

test('two values share a digest exactly when their canonical JSON is equal, whatever was digested before', () => {
  const long = 'x'.repeat(70_000), marks = Array.from({ length: 100 }, (_, i) => ({ x: i / 3, y: i, tint: { hue: 0 } }));
  const values: StampCanonicalDatum[] = [
    {}, { '': 1 }, { a: 1, b: 2 }, { b: 2, a: 1 }, { 'a\u0000b': 1 }, { a: 1, b: undefined }, { a: 1, b: () => 1 },
    [{ x: 1, y: 2 }, { y: 2, x: 1 }, { x: 1 }], [{ x: 1, y: 2 }, { x: 1, y: 2 }, { x: 1 }], [{ x: 1 }, { x: 1, y: 2 }],
    { a: [{ p: 1 }, { p: [{ p: 2 }] }] }, { a: [{ p: 1 }, { p: [{ q: 2 }] }] },
    [0], [-0], [NaN], ['NaN'], [Infinity], ['Infinity'], [1, '1'], [1, 1], [[1]], [null], [undefined], [() => 1],
    new Float32Array([0.5, 1]), [0.5, 1], new Set([1, 2]), new Map([[1, 'a']]), [[1, 'a']],
    [long, 1], [long, 2], { marks }, { marks: marks.map((mark) => ({ ...mark })) }, { marks: Object.freeze([...marks]) }, { marks: marks.toReversed() },
    { marks: marks.map((mark, i) => (i === 99 ? { ...mark, x: 0 } : mark)) }, [marks, marks], { [long]: 1 }, true, false, 'true', null,
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

const frozenMark = (i: number) => Object.freeze({ x: i / 3, y: i, tint: Object.freeze({ hue: 0 }) });

test("a registered list's digest is its inputs', or remembered by its name across copies; an unregistered one's is read afresh", () => {
  const placed = Object.freeze(Array.from({ length: 100 }, (_, i) => frozenMark(i))), again = Object.freeze(placed.map((_, i) => frozenMark(i)));
  registerStampCanonicalList(placed, { content: 'placement' });
  registerStampCanonicalList(placed, { content: 'placement' });
  registerStampCanonicalList(again, { content: 'placement' });
  assert.equal(stampCanonicalDigest({ marks: again }), stampCanonicalDigest({ marks: placed.map((each) => ({ ...each })) }));
  assert.throws(() => registerStampCanonicalList(placed, { inputs: 'placement' }));

  // Placed from inputs: equal inputs share a digest, other inputs don't, whatever the marks hold.
  const fromInputs = (inputs: string) => {
    const list = Object.freeze(Array.from({ length: 100 }, (_, i) => frozenMark(i)));
    registerStampCanonicalList(list, { inputs });
    return stampCanonicalDigest({ marks: list });
  };
  assert.equal(fromInputs('brush a'), fromInputs('brush a'));
  assert.notEqual(fromInputs('brush a'), fromInputs('brush b'));
  assert.notEqual(fromInputs('brush a'), stampCanonicalDigest({ marks: again }));

  // Frozen but unregistered, holding a record that changes: each digest reads it as it is.
  const tint = { hue: 0 }, held = Object.freeze(Array.from({ length: 100 }, (_, i) => ({ x: i, tint })));
  const first = stampCanonicalDigest({ marks: held });
  tint.hue = 1;
  assert.notEqual(stampCanonicalDigest({ marks: held }), first);
});

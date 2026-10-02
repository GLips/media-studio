import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gpuUniformLayout, gpuUniformStruct, gpuUniformWriter } from './gpu-uniform-layout.ts';

const INNER = gpuUniformLayout('Inner', [['a', 'f32'], ['b', 'vec3f']]);
const OUTER = gpuUniformLayout('Outer', [
  ['x', 'f32'], ['v', 'vec2u'], ['inner', gpuUniformStruct(INNER)], ['y', 'i32'], ['c', 'vec3f'], ['z', 'u32'], ['hull', { vec4fArray: 2 }], ['w', 'vec2f'],
]);

test("a struct lays out by WGSL's uniform rules and writes each field through its own type", () => {
  // A vec3f aligns to 16 bytes but a scalar packs into its fourth word; a nested struct and an array align to 16 bytes.
  assert.deepEqual(INNER.at, { a: 0, b: 4 });
  assert.deepEqual([INNER.words, INNER.align], [8, 4]);
  assert.deepEqual(OUTER.at, { x: 0, v: 2, inner: 4, y: 12, c: 16, z: 19, hull: 20, w: 28 });
  assert.deepEqual([OUTER.words, OUTER.align], [32, 4]);
  assert.equal(OUTER.wgsl, 'struct Outer { x: f32, v: vec2u, inner: Inner, y: i32, c: vec3f, z: u32, hull: array<vec4f, 2>, w: vec2f }');

  const buffer = new ArrayBuffer(OUTER.words * 4);
  const views = { floats: new Float32Array(buffer), ints: new Int32Array(buffer), words: new Uint32Array(buffer) };
  const put = gpuUniformWriter(OUTER, views);
  put('inner', { a: 1, b: [2, 3, 4] });
  put('y', -2);
  put('z', 7);
  assert.deepEqual([...views.floats.subarray(4, 11)], [1, 0, 0, 0, 2, 3, 4]);
  assert.deepEqual([views.ints[12], views.words[19]], [-2, 7]);
  // @ts-expect-error: a vec2f takes two, which its type says; the check at runtime catches what slips past.
  assert.throws(() => put('w', [1, 2, 3]), { message: 'gpu uniform Outer.w: vec2f takes 2 values, given 3' });
  assert.throws(() => put('hull', [1, 2, 3]),{ message: 'gpu uniform Outer.hull: array<vec4f, 2> takes 8 values, given 3' });
});

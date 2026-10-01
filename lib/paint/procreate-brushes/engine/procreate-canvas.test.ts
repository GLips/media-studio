import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decompressAppleLz4 } from './procreate-canvas.ts';

const block = (magic: string, size: number, payload: number[]) => {
  const header = Buffer.alloc(magic === 'bv41' ? 12 : 8);
  header.write(magic, 0, 'latin1');
  header.writeUInt32LE(size, 4);
  if (magic === 'bv41') header.writeUInt32LE(payload.length, 8);
  return Buffer.concat([header, Buffer.from(payload)]);
};

test("an Apple LZ4 block's match can copy from the block before it", () => {
  const stream = Buffer.concat([
    block('bv41', 4, [0x40, ...Buffer.from('abcd')]), // four literals
    block('bv41', 6, [0x02, 0x04, 0x00]), // no literals; a six-byte match four bytes back, into the first block
    block('bv4-', 2, [...Buffer.from('xy')]),
    Buffer.from('bv4$', 'latin1'),
  ]);
  assert.equal(Buffer.from(decompressAppleLz4(stream)).toString(), 'abcdabcdabxy');
});

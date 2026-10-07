import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createSha256, textSha256Hex } from './sha256.ts';

const nodeSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test("SHA-256 is Node's, whole or fed in runs across block edges, and text's is of its UTF-8, lone surrogates included", () => {
  const long = new TextEncoder().encode(Array.from({ length: 300 }, (_, i) => `{"x":${i * 1.25},"tint":"é→🎨"}`).join(','));
  for (const size of [0, 3, 55, 56, 63, 64, 65, 119, 120, long.length]) {
    const bytes = long.subarray(0, size), hash = createSha256();
    hash.update(bytes);
    assert.equal(hash.hex(), nodeSha256(bytes), `${size} bytes`);
  }
  const runs = createSha256();
  for (let at = 0; at < long.length; at += 37) runs.update(long, at, Math.min(at + 37, long.length));
  assert.equal(runs.hex(), nodeSha256(long));
  for (const text of ['', 'half \ud83c pair', '\udc00 first', 'é→🎨']) assert.equal(textSha256Hex(text), nodeSha256(new TextEncoder().encode(text)), JSON.stringify(text));
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createTextSha256, textSha256Hex } from './text-sha256.ts';

const nodeSha256 = (text: string) => createHash('sha256').update(new TextEncoder().encode(text)).digest('hex');

test("text's SHA-256 is Node's of its UTF-8, whole or fed in pieces, across block edges, wide characters and lone surrogates", () => {
  const long = Array.from({ length: 300 }, (_, i) => `{"x":${i * 1.25},"tint":"é→🎨"}`).join(',');
  for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), long, 'half \ud83c pair', '\udc00 first']) {
    assert.equal(textSha256Hex(text), nodeSha256(text), JSON.stringify(text.slice(0, 40)));
  }
  const pieces = createTextSha256();
  for (let at = 0; at < long.length; at += 37) pieces.update(long.slice(at, at + 37));
  assert.equal(pieces.hex(), nodeSha256(long));
});

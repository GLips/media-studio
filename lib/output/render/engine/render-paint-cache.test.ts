// The solved-paint cache as a render's pages meet it, over HTTP: a film is kept by the first page to send it, a memo
// never gives way to one knowing less, and the folder is pruned to its cap, least recently used first.
import assert from 'node:assert/strict';
import { readdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { prunePaintCache, servePaintCache } from './render-paint-cache.ts';

const withDir = (run: (dir: string) => Promise<void>) => withStudioTemp('paint-cache', run);

test('a film is kept by the first page to send it, and a memo never gives way to one knowing less', () => withDir(async (dir) => {
  const { url } = await servePaintCache({ dir, namespace: 'n' });
  const film = `${url}/film/${encodeURIComponent('k|finished|film0')}`;
  assert.equal((await fetch(film)).status, 404);
  await fetch(film, { method: 'PUT', body: new Blob([new Uint8Array([1, 2, 3])]) });
  await fetch(film, { method: 'PUT', body: new Blob([new Uint8Array([9])]) });
  // A film is written after its sender is answered.
  await new Promise((written) => setTimeout(written, 500));
  assert.deepEqual(new Uint8Array(await (await fetch(film)).arrayBuffer()), new Uint8Array([1, 2, 3]));

  const put = (rank: number, memo: string) => fetch(`${url}/memos/put`, { method: 'POST', body: JSON.stringify([['a', rank, memo]]) });
  await put(1, 'decision');
  await put(0, 'past');
  await put(2, 'decision with damp windows');
  const found: unknown = await (await fetch(`${url}/memos`, { method: 'POST', body: JSON.stringify(['a', 'b']) })).json();
  assert.deepEqual(found, [['a', 'decision with damp windows']]);
}));

test('the cache is pruned to its cap, the least recently used files first', () => withDir(async (dir) => {
  await Promise.all(([['old', 30], ['used', 20], ['new', 10]] as const).map(async ([name, age]) => {
    const file = join(dir, `${name}.bin`), at = new Date(Date.now() - age * 1000);
    await writeFile(file, new Uint8Array(100));
    await utimes(file, at, at);
  }));
  await prunePaintCache(dir, 250);
  assert.deepEqual((await readdir(dir)).toSorted(), ['new.bin', 'used.bin']);
}));

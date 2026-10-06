// A device's cache past its budget: what it gives up and what it never may. A destroyed texture an unsubmitted
// encoder reads, or one a solve still paints in, is a WebGPU validation error deep in a long render, so the rules are
// held here on a device whose textures only record that they were destroyed, under a budget of a few entries.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampPaintGpuCache, type StampGpuCacheStore } from './stamp-paint-gpu-cache.ts';

/** 100 bytes. */
const ENTRY = { width: 10, height: 10, layers: 1, format: 'r8unorm', usage: 0 } as const;

function recordingDevice() {
  const destroyed = new Set<GPUTexture>();
  const createTexture = () => {
    const texture = { destroy: () => destroyed.add(texture) } as unknown as GPUTexture;
    return texture;
  };
  return { device: { createTexture }, destroyed };
}

/** An encoder as the cache sees it: only who it is. */
const frame = () => ({}) as GPUCommandEncoder;

const made = (store: StampGpuCacheStore<null>, key: string, encoder: GPUCommandEncoder) => store.make(key, encoder, [ENTRY], null).textures[0];

test('past its budget a cache gives up checkpoints, then the least recently used, never what the frame being encoded uses or what is held', () => {
  const { device, destroyed } = recordingDevice(), cache = stampPaintGpuCache(device, 300);
  const pictures = cache.store<null>('picture'), checkpoints = cache.store<null>('checkpoint'), targets = cache.store<null>('target');
  const a = frame(), b = frame(), c = frame();
  const checkpoint = made(checkpoints, 'wash 2', a), sky = made(pictures, 'sky', a), layer = made(targets, 'layer', a);
  // Frame b takes the target again, then makes pictures: the checkpoint goes first, then the oldest picture.
  targets.find('layer', b);
  const heron = made(pictures, 'heron', b);
  assert.deepEqual([...destroyed], [checkpoint]);
  const reeds = made(pictures, 'reeds', b);
  assert.deepEqual([...destroyed], [checkpoint, sky]);
  // All that's left is frame b's: one more overruns the budget rather than give up what it's about to read.
  const mist = made(pictures, 'mist', b);
  assert.deepEqual([...destroyed], [checkpoint, sky]);
  assert.deepEqual(cache.bytes(), { kept: 300, targets: 100 });
  // Frame c, the heron held by a reader: the target and the reeds go, least recently used first.
  const release = pictures.hold('heron')!;
  made(pictures, 'rain', c);
  assert.deepEqual([...destroyed], [checkpoint, sky, layer, reeds]);
  assert.ok(!destroyed.has(heron) && !destroyed.has(mist));
  assert.deepEqual(cache.bytes(), { kept: 300, targets: 0 });
  assert.equal(cache.evictions(), 4);
  release();
});

test("a scope's target is held across frames until it ends, then ranks as just used", () => {
  const { device, destroyed } = recordingDevice(), cache = stampPaintGpuCache(device, 200);
  const pictures = cache.store<null>('picture'), targets = cache.store<null>('target');
  const sky = made(pictures, 'sky', frame());
  // A solve loads with no encoder open, and holds its film while its steps run.
  const film = targets.take('sheet film', null, [ENTRY], null);
  // A frame between its steps: the sky goes, the film stays, and the budget overruns.
  const b = frame(), heron = made(pictures, 'heron', b), reeds = made(pictures, 'reeds', b);
  assert.deepEqual([...destroyed], [sky]);
  assert.deepEqual(cache.bytes(), { kept: 200, targets: 100 });
  // The solve ends after the frame's pictures were made, so they go before its film.
  film.release();
  made(pictures, 'mist', frame());
  assert.deepEqual([...destroyed], [sky, heron, reeds]);
  assert.equal(targets.take('sheet film', null, [ENTRY], null).entry.textures[0], film.entry.textures[0]);
});

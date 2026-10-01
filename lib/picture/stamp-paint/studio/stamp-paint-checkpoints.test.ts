import assert from 'node:assert/strict';
import test from 'node:test';
import { stampPaintCheckpoints, type StampPaintCheckpoint } from './stamp-paint-checkpoints.ts';

// The GPU is the boundary: textures here only have a size and know whether they were destroyed.
type FakeTexture = { width: number; height: number; depthOrArrayLayers: number; format: string; destroyed: boolean; destroy: () => void };
const texture = (layers: number): FakeTexture => ({
  width: 10, height: 10, depthOrArrayLayers: layers, format: 'rgba16float', destroyed: false,
  destroy() {
    this.destroyed = true;
  },
});
const made: FakeTexture[] = [];
Object.assign(globalThis, { GPUTextureUsage: { COPY_SRC: 1, COPY_DST: 2 } });
const device = {
  createTexture: ({ size: [, , layers] }: { size: [number, number, number] }) => {
    const twin = texture(layers);
    made.push(twin);
    return twin;
  },
} as unknown as GPUDevice;
const frame = () => ({ copyTextureToTexture: () => {} }) as unknown as GPUCommandEncoder;

// 800 bytes a layer: the painting 2 layers (1600), the layer 4 and the clip 1 (4000 more).
const targets = { painting: texture(2), layer: texture(4), clip: texture(1) } as unknown as Parameters<typeof stampPaintCheckpoints>[1];
const at = (event: number, inGroup: boolean): StampPaintCheckpoint => ({ event, key: '', inGroup, painted: null });

test('a budget too small for a checkpoint partway through a group keeps none of those, but keeps those between groups', () => {
  made.length = 0;
  const checkpoints = stampPaintCheckpoints(device, targets, 4000);
  checkpoints.save(frame(), at(3, true));
  assert.equal(checkpoints.latest(10, () => ''), null);
  checkpoints.save(frame(), at(2, false));
  checkpoints.save(frame(), at(5, false));
  checkpoints.save(frame(), at(7, false));
  // A third painting-only one (4800 bytes in all) is past the budget: the least recently used is given up for it.
  assert.equal(checkpoints.latest(10, () => '')?.event, 7);
  assert.equal(checkpoints.latest(4, () => ''), null);
  assert.equal(made.length, 2);
});

test("a checkpoint the frame restored isn't given up in that frame, and one given up after is destroyed or reused", () => {
  made.length = 0;
  const checkpoints = stampPaintCheckpoints(device, targets, 5600);
  checkpoints.save(frame(), at(4, true));
  const now = frame();
  checkpoints.restore(now, checkpoints.latest(10, () => '')!);
  checkpoints.save(now, at(6, false));
  assert.equal(checkpoints.latest(10, () => '')?.event, 4);
  checkpoints.save(frame(), at(6, false));
  assert.equal(checkpoints.latest(10, () => '')?.event, 6);
  // The full checkpoint's painting holds the new one; its layer and clip are destroyed.
  assert.equal(made.length, 3);
  assert.deepEqual(made.map(({ destroyed }) => destroyed), [false, true, true]);
});

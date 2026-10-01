import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampBlurRegion } from './stamp-blur-region.ts';

/** The texels a bilinear sample reads, as the resolve samples the blur: at a pixel's centre over the whole painting. */
function texelsRead(pixel: number, size: number, half: number): number[] {
  const at = ((pixel + 0.5) / size) * half - 0.5;
  return [Math.floor(at), Math.floor(at) + 1].map((t) => Math.min(half - 1, Math.max(0, t)));
}

test('a deposit\'s resolve reads only blur texels its own blur wrote, at every edge and on odd sizes', () => {
  for (const size of [1080, 1081, 37]) {
    const half = Math.ceil(size / 2);
    for (let start = 0; start < Math.min(size, 40); start++) {
      for (const length of [1, 2, 3, 10, size - start]) {
        if (start + length > size) continue;
        const region = stampBlurRegion({ x: start, y: 0, w: length, h: 1 }, half, 1);
        for (let pixel = start; pixel < start + length; pixel++) {
          for (const texel of texelsRead(pixel, size, half)) {
            assert.ok(texel >= region.x && texel < region.x + region.w, `size ${size}, box ${start}+${length}: pixel ${pixel} reads texel ${texel}, outside ${region.x}+${region.w}`);
          }
        }
      }
    }
  }
});

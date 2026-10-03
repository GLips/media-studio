import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { decodePngRgba } from './png-decode.ts';

/** A PNG chunk: its length, type, body and CRC. */
function chunk(type: string, body: Uint8Array) {
  const out = new Uint8Array(12 + body.length), view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(Buffer.from(type, 'latin1'), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** The Paeth predictor, as PNG spec 9.4 writes it. */
function paethPredictor(a: number, b: number, c: number) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** A PNG of `w` × `h` texels of colour type `colour`, each row filtered as `filters` says, at bit depth `depth`, interlaced if asked. */
function png(w: number, h: number, colour: number, channels: number, texels: readonly number[], filters: readonly number[], { depth = 8, interlace = 0 } = {}) {
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, w);
  view.setUint32(4, h);
  header.set([depth, colour, 0, 0, interlace], 8);
  // Each row filtered by its filter (PNG spec 9.2), against the unfiltered row above.
  const stride = w * channels, raw = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = filters[y];
    for (let i = 0; i < stride; i++) {
      const x = texels[y * stride + i], a = i >= channels ? texels[y * stride + i - channels] : 0, b = y ? texels[(y - 1) * stride + i] : 0;
      const c = y && i >= channels ? texels[(y - 1) * stride + i - channels] : 0;
      const predicted = [0, a, b, (a + b) >> 1, paethPredictor(a, b, c)][filters[y]];
      raw[y * (stride + 1) + 1 + i] = (x - predicted) & 255;
    }
  }
  return new Uint8Array(Buffer.concat([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]));
}

test('a PNG decodes to the RGBA it was written with, whatever its colour type and row filters', async () => {
  const rgba = [10, 200, 30, 255, 250, 5, 128, 0, 77, 77, 77, 9, 1, 2, 3, 4, 200, 100, 50, 25, 0, 255, 0, 255, 60, 70, 80, 90, 255, 255, 255, 255, 3, 3, 3, 3, 9, 8, 7, 6];
  const filters = [0, 1, 2, 3, 4];
  assert.deepEqual([...(await decodePngRgba(png(2, 5, 6, 4, rgba, filters), 'rgba')).data], rgba);

  const rgb = rgba.filter((_, i) => i % 4 !== 3);
  const fromRgb = rgba.map((v, i) => (i % 4 === 3 ? 255 : v));
  assert.deepEqual([...(await decodePngRgba(png(2, 5, 2, 3, rgb, filters), 'rgb')).data], fromRgb);

  const greyAlpha = [0, 255, 128, 64, 255, 0, 33, 200];
  const decoded = await decodePngRgba(png(2, 2, 4, 2, greyAlpha, [4, 3]), 'grey-alpha');
  assert.deepEqual({ w: decoded.w, h: decoded.h, data: [...decoded.data] }, { w: 2, h: 2, data: [0, 0, 0, 255, 128, 128, 128, 64, 255, 255, 255, 0, 33, 33, 33, 200] });
});

test('a PNG past what the decoder reads is refused, not misread', async () => {
  await assert.rejects(decodePngRgba(png(1, 1, 6, 4, [1, 2, 3, 4], [0], { interlace: 1 }), 'interlaced'), /interlaced/);
  await assert.rejects(decodePngRgba(png(1, 1, 6, 4, [1, 2, 3, 4], [0], { depth: 16 }), 'deep'), /16-bit/);
  await assert.rejects(decodePngRgba(Uint8Array.from([1, 2, 3]), 'junk'), /junk isn't a PNG/);
});

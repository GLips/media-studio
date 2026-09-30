// stamp-pigment-page.ts: the pigment command's browser side, run by engine/stamp-pigment-parity.ts through
// withBrowserModulePage. It builds the pigment fixture itself, as a compiled painting's typed arrays don't survive the
// trip from Node, paints it with the studio's GPU renderer and hands back the frame as RGB bytes.

import { createStampPaintRenderer } from '#lib/picture/stamp-paint/studio/stamp-paint-renderer.ts';
import { stampPigmentFixture, type STAMP_PIGMENT_FIXTURE_MEDIA, type StampPigmentFixtureImage } from '../models/stamp-pigment-reference.ts';

/** A grey image as a PNG data URL, lossless, so the GPU samples the bytes the CPU does. */
function fixtureImageUrl({ size, pixels }: StampPigmentFixtureImage): string {
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const context = canvas.getContext('2d')!, image = context.createImageData(size, size);
  pixels.forEach((v, i) => image.data.set([v, v, v, 255], i * 4));
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** The pigment fixture painted in `mediumName`; the frame as RGB bytes, row by row. */
async function paintStampPigment(mediumName: (typeof STAMP_PIGMENT_FIXTURE_MEDIA)[number]): Promise<number[]> {
  const { painting, mixing, paper, width, height, tip, grain } = stampPigmentFixture(mediumName);
  const urls: Record<string, string> = { 'tip.png': fixtureImageUrl(tip), 'grain.png': fixtureImageUrl(grain) };
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const renderer = await createStampPaintRenderer(canvas, painting, paper, mixing, width, height, ({ file }) => urls[file]);
  try {
    await renderer.draw(Number.MAX_VALUE);
    await renderer.finish();
    const context = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d')!;
    context.drawImage(canvas, 0, 0);
    const rgba = context.getImageData(0, 0, width, height).data;
    return Array.from({ length: width * height * 3 }, (_, i) => rgba[Math.floor(i / 3) * 4 + (i % 3)]);
  } finally {
    renderer.dispose();
  }
}

Object.assign(globalThis, { paintStampPigment });

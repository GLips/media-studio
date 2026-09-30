// stamp-deposit-parity-page.ts: the deposits command's browser side, run by engine/stamp-deposit-parity.ts through
// withBrowserModulePage. It paints each case with the studio's GPU renderer and with the CPU reference, its images
// read from the same files as the renderer reads them (1 − red is paint), and compares them (stamp-deposit-parity.ts).

import { bindStampBrushImages, type StampBrush, type StampBrushAsset, type StampBrushImageSource } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { compileStampPaintRecipe } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import { createStampPaintRenderer } from '#lib/picture/stamp-paint/studio/stamp-paint-renderer.ts';
import {
  compareStampDepositCoverage, STAMP_DEPOSIT_PARITY_SIZE, STAMP_DEPOSIT_PARITY_TIME, stampDepositParityRecipe, stampDepositParityReference, type StampDepositParityCase,
} from '../models/stamp-deposit-parity.ts';
import { stampReferenceMips, type StampReferenceMips } from '../models/stamp-reference-image.ts';

const { width: W, height: H } = STAMP_DEPOSIT_PARITY_SIZE;

/** An image's key: a pack's by its path, a drawn one by its own. */
const imageKey = (image: StampBrushImageSource) => ('draw' in image ? image.key : `${image.style}/${image.pack}/${image.file}`);

async function fileMips(url: string): Promise<StampReferenceMips> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`stamp deposit parity: ${url} answered ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const context = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height }).getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  return stampReferenceMips({ width: bitmap.width, height: bitmap.height, paint: Float32Array.from({ length: bitmap.width * bitmap.height }, (_, i) => 1 - rgba[i * 4] / 255) });
}

/** Every image the painting's deposits bind, as the reference's mips. */
async function referenceImages(painting: ReturnType<typeof compileStampPaintRecipe>, assetUrl: (asset: StampBrushAsset) => string) {
  const sources = new Map<string, StampBrushImageSource>();
  for (const deposit of painting.groups.flatMap((group) => group.passes).flatMap((pass) => pass.deposits)) {
    bindStampBrushImages(deposit.brush, deposit.diameter, (image) => sources.set(imageKey(image), image));
  }
  const mips = new Map(await Promise.all([...sources].map(async ([key, image]): Promise<[string, StampReferenceMips]> => {
    if (!('draw' in image)) return [key, await fileMips(assetUrl(image))];
    const { size, pixels } = image.draw();
    return [key, stampReferenceMips({ width: size, height: size, paint: Float32Array.from(pixels, (v) => 1 - v / 255) })];
  })));
  return (image: StampBrushImageSource) => mips.get(imageKey(image))!;
}

/** A sheet of the GPU's coverage, the CPU's and their difference × 8, as a PNG data URL. */
function paritySheet(gpu: ArrayLike<number>, cpu: ArrayLike<number>): string {
  const context = Object.assign(document.createElement('canvas'), { width: W * 3, height: H }).getContext('2d')!;
  const image = context.createImageData(W * 3, H);
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = Math.floor(i / W);
    [1 - gpu[i], 1 - cpu[i], 1 - Math.min(1, 8 * Math.abs(gpu[i] - cpu[i]))].forEach((v, k) => image.data.set([v * 255, v * 255, v * 255, 255], (y * W * 3 + k * W + x) * 4));
  }
  context.putImageData(image, 0, 0);
  return context.canvas.toDataURL('image/png');
}

/** One case of `brush` on the GPU and the CPU, its images from `assetUrl`: how far apart, and a sheet when asked for. */
async function paintParityCase(brush: StampBrush, assetUrl: (asset: StampBrushAsset) => string, parityCase: StampDepositParityCase, withSheets: boolean) {
  const painting = compileStampPaintRecipe(stampDepositParityRecipe(brush, parityCase));
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const renderer = await createStampPaintRenderer(canvas, painting, { color: '#ffffff' }, { kind: 'flat' }, W, H, assetUrl);
  const read = Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d')!;
  try {
    await renderer.draw(STAMP_DEPOSIT_PARITY_TIME);
    await renderer.finish();
    read.drawImage(canvas, 0, 0);
  } finally {
    renderer.dispose();
  }
  const rgba = read.getImageData(0, 0, W, H).data;
  const gpu = Float32Array.from({ length: W * H }, (_, i) => 1 - (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / (3 * 255));
  const cpu = stampDepositParityReference(painting, await referenceImages(painting, assetUrl), STAMP_DEPOSIT_PARITY_TIME);
  return { parityCase, ...compareStampDepositCoverage(gpu, cpu), ...(withSheets && { png: paritySheet(gpu, cpu) }) };
}

/** Each case of `brush`, its images at `packUrl`, one at a time: each holds the GPU for a painting. */
function runStampDepositParity(brush: StampBrush, packUrl: string, cases: readonly StampDepositParityCase[], withSheets: boolean) {
  const assetUrl = (asset: StampBrushAsset) => `${packUrl}/${asset.file}`;
  return cases.reduce<Promise<Awaited<ReturnType<typeof paintParityCase>>[]>>(
    async (done, parityCase) => [...(await done), await paintParityCase(brush, assetUrl, parityCase, withSheets)], Promise.resolve([]));
}

Object.assign(globalThis, { runStampDepositParity });

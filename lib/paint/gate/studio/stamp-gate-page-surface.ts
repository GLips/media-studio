// stamp-gate-page-surface.ts: how the gate page draws a gate painting: its images as data URLs, a surface and
// renderer of its own each, disposed after, and a frame read back once the GPU has drawn it.

import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { createStampPaintRenderer, type StampPaintRenderer, type StampPaintRendererOptions } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { createStampPaintSurface, type StampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import type { StampGateImage, StampGatePainting } from '../models/stamp-gate-paintings.ts';

/** A grey image as a PNG data URL, lossless, so the GPU samples the bytes drawn. */
export function imageUrl({ size, pixels }: StampGateImage): string {
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const context = canvas.getContext('2d')!, image = context.createImageData(size, size);
  pixels.forEach((v, i) => image.data.set([v, v, v, 255], i * 4));
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** A surface of its own `width` × `height`, its images at `url`, handed to `use` with what reads its frame; disposed after. */
export async function withGateSurface<T>({ width, height }: { width: number; height: number }, url: (file: string) => string, use: (surface: StampPaintSurface, frame: () => Uint8ClampedArray) => Promise<T>): Promise<T> {
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const surface = await createStampPaintSurface({ canvas, width, height }, ({ file }) => url(file));
  const frame = () => {
    const context = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d')!;
    context.drawImage(canvas, 0, 0);
    return context.getImageData(0, 0, width, height).data;
  };
  try {
    return await use(surface, frame);
  } finally {
    surface.dispose();
  }
}

export const gateRenderer = ({ painting, paper, mixing }: Omit<StampGatePainting, 'images'>, surface: StampPaintSurface, options: StampPaintRendererOptions = {}) =>
  createStampPaintRenderer(surface, painting, paper, mixing, options);

/** `gate` on a renderer (made with `options`) and surface of its own, its images at `url`, handed to `use`; disposed after. */
export const withGateRenderer = <T,>(
  gate: Omit<StampGatePainting, 'images'>, url: (file: string) => string, use: (renderer: StampPaintRenderer, frame: () => Uint8ClampedArray) => Promise<T>,
  options: StampPaintRendererOptions = {},
) => withGateSurface(gate, url, async (surface, frame) => use(await gateRenderer(gate, surface, options), frame));

export const drawnImages = (gate: StampGatePainting) => {
  const urls = Object.fromEntries(Object.entries(gate.images).map(([file, image]) => [file, imageUrl(image)]));
  return (file: string) => urls[file];
};

/** `renderer`'s frame at `t` in frame state `state`, once the GPU has drawn it. */
export async function drawn(renderer: StampPaintRenderer, frame: () => Uint8ClampedArray, t: number, state?: StampPaintFrameState) {
  await renderer.draw(t, state);
  await renderer.finish();
  return frame();
}


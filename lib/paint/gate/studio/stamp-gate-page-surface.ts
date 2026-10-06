// stamp-gate-page-surface.ts: how the gate page draws a gate painting: its images as data URLs, a surface, its
// device owner and a renderer of its own each, disposed after, and a frame read back once the GPU has drawn it.

import type { StampBrushAsset } from '#lib/paint/brush/models/stamp-brush.ts';
import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampLensFrame } from '#lib/paint/painting/models/stamp-plane.ts';
import { createStampPaintRenderer, type StampPaintFrame, type StampPaintRenderer, type StampPaintRendererOptions } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { createStampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintSurface, type StampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import type { StampGateImage, StampGatePainting } from '../models/stamp-gate-paintings.ts';

/** A frame's RGBA bytes as RGB, as baselines hold them. */
export const stampGateRgb = (rgba: Uint8ClampedArray) => rgba.filter((_, i) => i % 4 !== 3);

/** A frame's RGBA bytes as its RGB bytes row by row, in base64: how the page hands a baseline's frame to the gate. */
export function stampGateRgbBase64(rgba: Uint8ClampedArray): string {
  const rgb = stampGateRgb(rgba);
  let binary = '';
  for (let i = 0; i < rgb.length; i += 0x8000) binary += String.fromCharCode(...rgb.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A grey image as a PNG data URL, lossless, so the GPU samples the bytes drawn. */
export function imageUrl({ size, pixels }: StampGateImage): string {
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const context = canvas.getContext('2d')!, image = context.createImageData(size, size);
  pixels.forEach((v, i) => image.data.set([v, v, v, 255], i * 4));
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** `canvas`'s RGBA bytes as the browser reads it back, unpremultiplied: a WebGPU canvas off the page, its last frame. */
export function stampGateCanvasBytes(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const context = Object.assign(document.createElement('canvas'), { width: canvas.width, height: canvas.height }).getContext('2d')!;
  context.drawImage(canvas, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

/**
 * An opaque surface (and the device owner under it) of its own `width` × `height`, its images at `url`, handed to
 * `use` with what reads its frame; disposed after.
 */
export async function withGateSurface<T>({ width, height }: { width: number; height: number }, url: (asset: StampBrushAsset) => string, use: (surface: StampPaintSurface, frame: () => Uint8ClampedArray) => Promise<T>): Promise<T> {
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const owner = await createStampPaintGpuOwner(url);
  try {
    const surface = await createStampPaintSurface(owner, { canvas, width, height });
    try {
      return await use(surface, () => stampGateCanvasBytes(canvas));
    } finally {
      surface.dispose();
    }
  } finally {
    owner.dispose();
  }
}

export const gateRenderer = ({ painting }: Omit<StampGatePainting, 'images'>, surface: StampPaintSurface, options: StampPaintRendererOptions = {}) =>
  createStampPaintRenderer(surface, painting, options);

/** `gate` on a renderer (made with `options`) and surface of its own, its images at `url`, handed to `use`; disposed after. */
export const withGateRenderer = <T,>(
  gate: Omit<StampGatePainting, 'images'>, url: (asset: StampBrushAsset) => string, use: (renderer: StampPaintRenderer, frame: () => Uint8ClampedArray) => Promise<T>,
  options: StampPaintRendererOptions = {},
) => withGateSurface(gate, url, async (surface, frame) => use(await gateRenderer(gate, surface, options), frame));

export const drawnImages = (gate: StampGatePainting) => {
  const urls = Object.fromEntries(Object.entries(gate.images).map(([file, image]) => [file, imageUrl(image)]));
  return ({ file }: StampBrushAsset) => urls[file];
};

/** `renderer`'s frame at `t` in frame state `state`, through `lens` with its shutter shut if given, once the GPU has drawn it. */
export const drawn = (renderer: StampPaintRenderer, frame: () => Uint8ClampedArray, t: number, state?: StampPaintFrameState, lens?: StampLensFrame) =>
  drawnExposures(renderer, frame, [lens ? { kind: 'fast', t, state, lens, shutter: null } : { kind: 'once', t, state }]);

/** `renderer`'s frame drawn as `draws` say, in turn (a reference frame's exposures, the last developing it), once the GPU has drawn it. */
export async function drawnExposures(renderer: StampPaintRenderer, frame: () => Uint8ClampedArray, draws: readonly StampPaintFrame[]) {
  await draws.reduce(async (before, draw) => {
    await before;
    await renderer.draw(draw);
  }, Promise.resolve());
  await renderer.finish();
  return frame();
}


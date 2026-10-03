// stamp-paint-surface.ts: one output stamp paintings are shown on, a canvas or a frame texture, on the device an
// owner holds (stamp-paint-gpu-owner.ts). Everything that outlasts a painting is the owner's, so outputs on one device
// share their images, pipelines, targets and cache; a surface frees only its output.

import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';

export type StampPaintSurface = {
  owner: StampPaintGpuOwner;
  width: number;
  height: number;
  /** The texture to draw a frame into: the canvas's current one, or the lent frame. */
  frameTexture: () => GPUTexture;
  /** The format `frameTexture` is in. */
  format: GPUTextureFormat;
  /** How the page lays it: opaque, or premultiplied colour over what lies behind the canvas. */
  alphaMode: GPUCanvasAlphaMode;
  /** Unconfigures the canvas; the owner and what it holds stay. */
  dispose: () => void;
};

/**
 * Where a surface draws: a canvas of `width` × `height`, opaque unless `alphaMode` says it's laid premultiplied over
 * the page; or `frame`, which gets the canvas's colour, gamma-encoded and opaque, dithered only into bytes.
 */
export type StampPaintSurfaceOutput = { canvas: HTMLCanvasElement; width: number; height: number; alphaMode?: GPUCanvasAlphaMode } | { frame: GPUTexture };

/**
 * The output pass writes encoded colour to one 2D image it renders to: an -srgb format would encode it twice, and an
 * integer one can't hold it.
 */
const STAMP_PAINT_FRAME_FORMATS: ReadonlySet<GPUTextureFormat> = new Set(['rgba8unorm', 'bgra8unorm', 'rgba16float', 'rgba32float']);

function checkStampPaintFrameTexture(frame: GPUTexture) {
  if (!(frame.usage & GPUTextureUsage.RENDER_ATTACHMENT)) throw new Error('stamp paint: the texture a painting is drawn into needs RENDER_ATTACHMENT usage');
  if (!STAMP_PAINT_FRAME_FORMATS.has(frame.format)) throw new Error(`stamp paint: a painting is drawn into ${[...STAMP_PAINT_FRAME_FORMATS].join(', ')}, not ${frame.format}`);
  if (frame.dimension !== '2d' || frame.depthOrArrayLayers !== 1 || frame.sampleCount !== 1) throw new Error('stamp paint: a painting is drawn into one single-sampled 2D image');
}

/** A surface drawing to `output` on `owner`'s device. */
export async function createStampPaintSurface(owner: StampPaintGpuOwner, output: StampPaintSurfaceOutput): Promise<StampPaintSurface> {
  if ('frame' in output) {
    checkStampPaintFrameTexture(output.frame);
    const { frame } = output;
    return { owner, width: frame.width, height: frame.height, format: frame.format, alphaMode: 'opaque', frameTexture: () => frame, dispose: () => {} };
  }
  // SAFETY: the canvas is the surface's alone, so it has no other kind of context to refuse 'webgpu' for.
  const context = output.canvas.getContext('webgpu') as GPUCanvasContext;
  const format: GPUTextureFormat = 'rgba8unorm', alphaMode = output.alphaMode ?? 'opaque';
  await owner.checked('configuring the canvas', () => context.configure({ device: owner.webgpu, format, alphaMode }));
  return { owner, width: output.width, height: output.height, format, alphaMode, frameTexture: () => context.getCurrentTexture(), dispose: () => context.unconfigure() };
}

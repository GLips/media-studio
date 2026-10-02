// gpu-canvas-output.ts: a canvas on an owner's device showing a texture of ours, which three.js or a pass draws
// each frame into and then copies to the canvas: nothing renders to the canvas's own texture, which changes each frame.

import type { GpuDeviceOwner } from './gpu-device-owner.ts';

/** A canvas showing a texture of ours: draw a frame into `texture`, then `present` it. */
export type GpuCanvasOutput = { texture: GPUTexture; present: () => void; dispose: () => void };

/**
 * `canvas` configured on `owner`'s device, `width` × `height`, with a texture to draw its frames into: encoded colour
 * (rgba8unorm), opaque, or premultiplied over the page with `transparent`.
 */
export async function createGpuCanvasOutput(owner: GpuDeviceOwner, canvas: HTMLCanvasElement, { width, height, transparent }: { width: number; height: number; transparent: boolean }): Promise<GpuCanvasOutput> {
  Object.assign(canvas, { width, height });
  // SAFETY: the canvas is the output's alone, so it has no other kind of context to refuse 'webgpu' for.
  const context = canvas.getContext('webgpu') as GPUCanvasContext;
  const format: GPUTextureFormat = 'rgba8unorm';
  await owner.checked('configuring the canvas', () => context.configure({
    device: owner.webgpu, format, alphaMode: transparent ? 'premultiplied' : 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
  }));
  const texture = owner.webgpu.createTexture({
    size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
  });
  return {
    texture,
    present: () => {
      const encoder = owner.webgpu.createCommandEncoder();
      encoder.copyTextureToTexture({ texture }, { texture: context.getCurrentTexture() }, [width, height]);
      owner.webgpu.queue.submit([encoder.finish()]);
    },
    dispose: () => {
      context.unconfigure();
      texture.destroy();
    },
  };
}

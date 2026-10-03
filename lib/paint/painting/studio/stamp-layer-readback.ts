// stamp-layer-readback.ts: a layered rgba16float target read back to the CPU as floats, as the renderer reads its
// group layer and a sheet solve a kept film: a box of every layer copied into a mappable buffer as work is encoded,
// then mapped and decoded once that work is done.

import { gpuHalfValue } from '#lib/platform/gpu/models/gpu-half-float.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';

/**
 * A group's layer as read back: `layers` of rgba16float, each `width` × `height`, in `values` layer by layer, row by
 * row, four channels a texel. For pigment, layer 0's first channel is coverage and each other channel a pigment's amount.
 */
export type StampLayerReadback = { width: number; height: number; layers: number; values: Float32Array };

/** A readback copied in an encoder and not yet decoded: its buffer, the box it holds and its layers. */
export type StampLayerCopy = { buffer: GPUBuffer; box: StampPixelBox; layers: number };

const rowBytesOf = (width: number) => Math.ceil((width * 8) / 256) * 256;

/** `box` of every layer of `texture` (rgba16float) copied in `encoder` into a buffer of its own, made through `device`. */
export function copyStampLayerForReadback(device: StampPaintDevice, encoder: GPUCommandEncoder, texture: GPUTexture, box: StampPixelBox): StampLayerCopy {
  const layers = texture.depthOrArrayLayers, rowBytes = rowBytesOf(box.w);
  const buffer = device.createBuffer({ size: rowBytes * box.h * layers, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  encoder.copyTextureToBuffer({ texture, origin: { x: box.x, y: box.y } }, { buffer, bytesPerRow: rowBytes, rowsPerImage: box.h }, [box.w, box.h, layers]);
  return { buffer, box, layers };
}

/** `copy` decoded once the encoder that made it has been submitted; its buffer destroyed, read or not. */
export async function readStampLayerCopy(copy: StampLayerCopy): Promise<StampLayerReadback> {
  const { buffer, box, layers } = copy, rowBytes = rowBytesOf(box.w);
  try {
    await buffer.mapAsync(GPUMapMode.READ);
    const halves = new Uint16Array(buffer.getMappedRange()), values = new Float32Array(box.w * box.h * 4 * layers);
    for (let l = 0; l < layers; l++) {
      for (let y = 0; y < box.h; y++) {
        const from = (l * box.h + y) * (rowBytes / 2), to = (l * box.h + y) * box.w * 4;
        for (let i = 0; i < box.w * 4; i++) values[to + i] = gpuHalfValue(halves[from + i]);
      }
    }
    buffer.unmap();
    return { width: box.w, height: box.h, layers, values };
  } finally {
    buffer.destroy();
  }
}

// gpu-uniform-ring.ts: uniforms for passes encoded now and submitted together, a 256-byte slot a pass (WebGPU's
// uniform offset alignment). Each slot is written into staging as its pass is encoded, and every slot is uploaded by
// `flush` before the submit. A full chunk opens another, twice as big, so no count of passes need be known first.

import type { GpuUniformViews } from '../models/gpu-uniform-layout.ts';

const GPU_UNIFORM_SLOT = 256;

type GpuUniformChunk = { buffer: GPUBuffer; staging: ArrayBuffer; views: GpuUniformViews; slots: number; used: number };

export type GpuUniformRing = {
  /** A zeroed slot filled by `fill`, which writes its words from 0 into the views it's given. */
  slot: (fill: (views: GpuUniformViews) => void) => GPUBufferBinding;
  /**
   * Uploads every slot filled since the last flush, and starts over. Warning: call it after encoding and before the
   * submit; a slot filled after it waits for the next.
   */
  flush: () => void;
  destroy: () => void;
};

export function createGpuUniformRing(device: GPUDevice, { label, slots: first = 64 }: { label: string; slots?: number }): GpuUniformRing {
  const chunks: GpuUniformChunk[] = [];
  const open = (slots: number) => {
    const staging = new ArrayBuffer(slots * GPU_UNIFORM_SLOT);
    const buffer = device.createBuffer({ label: `${label} uniforms`, size: staging.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    chunks.push({ buffer, staging, views: { floats: new Float32Array(staging), ints: new Int32Array(staging), words: new Uint32Array(staging) }, slots, used: 0 });
  };
  open(first);
  return {
    slot: (fill) => {
      let chunk = chunks.find(({ slots, used }) => used < slots);
      if (!chunk) {
        open(chunks.at(-1)!.slots * 2);
        chunk = chunks.at(-1)!;
      }
      const offset = chunk.used++ * GPU_UNIFORM_SLOT, word = offset / 4, words = GPU_UNIFORM_SLOT / 4;
      const { floats, ints, words: all } = chunk.views;
      all.fill(0, word, word + words);
      fill({ floats: floats.subarray(word, word + words), ints: ints.subarray(word, word + words), words: all.subarray(word, word + words) });
      return { buffer: chunk.buffer, offset, size: GPU_UNIFORM_SLOT };
    },
    flush: () => {
      for (const chunk of chunks) {
        if (chunk.used) device.queue.writeBuffer(chunk.buffer, 0, chunk.staging, 0, chunk.used * GPU_UNIFORM_SLOT);
        chunk.used = 0;
      }
    },
    destroy: () => {
      for (const { buffer } of chunks.splice(0)) buffer.destroy();
    },
  };
}

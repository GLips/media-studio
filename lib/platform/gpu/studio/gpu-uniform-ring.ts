// gpu-uniform-ring.ts: uniforms for passes encoded now and submitted together, a 256-byte slot a pass (WebGPU's
// uniform offset alignment), staged and uploaded before the submit by gpu-staged-ring.ts.

import type { GpuUniformViews } from '../models/gpu-uniform-layout.ts';
import { createGpuStagedRing } from './gpu-staged-ring.ts';

const GPU_UNIFORM_SLOT = 256;

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

export function createGpuUniformRing(device: GPUDevice, { label, slots = 64 }: { label: string; slots?: number }): GpuUniformRing {
  const ring = createGpuStagedRing(device, { label: `${label} uniforms`, usage: GPUBufferUsage.UNIFORM, unitBytes: GPU_UNIFORM_SLOT, units: slots });
  const words = GPU_UNIFORM_SLOT / 4;
  return {
    slot: (fill) => {
      const { buffer, staging, offset, size } = ring.take(1);
      fill({ floats: new Float32Array(staging, offset, words), ints: new Int32Array(staging, offset, words), words: new Uint32Array(staging, offset, words) });
      return { buffer, offset, size };
    },
    flush: ring.flush,
    destroy: ring.destroy,
  };
}

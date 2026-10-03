// stamp-uniform-arena.ts: the uniforms of the work one submit carries, a slot a pass at the offsets WebGPU binds at,
// filled on the CPU as the work is encoded and uploaded once before it's submitted. A painting's frame, its load's
// own submits and a solve's many alike take theirs from an arena sized for the most one submit encodes.

import type { GpuUniformViews } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';

/** Bytes per uniform slot: every pass's uniforms sit at an offset WebGPU allows binding at (256). */
export const STAMP_UNIFORM_SLOT = 256;

export type StampUniformArena = {
  /**
   * A zeroed slot filled by `fill`, which writes its words from 0 into the views it's given: zeroed, so no field keeps
   * what an earlier pass left there. Throws past the arena's slots rather than binding past its buffer.
   */
  slot: (fill: (views: GpuUniformViews) => void) => GPUBufferBinding;
  /** Uploads the slots filled since the last reset: before the submit carrying the work that binds them. */
  flush: () => void;
  /** Fills from the first slot again: only once the work bound to the slots before is flushed and submitted. */
  reset: () => void;
};

/** An arena of `slots` uniform slots on `device`. */
export function createStampUniformArena(device: StampPaintDevice, slots: number): StampUniformArena {
  const buffer = device.createBuffer({ size: Math.max(1, slots) * STAMP_UNIFORM_SLOT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const staging = new ArrayBuffer(Math.max(1, slots) * STAMP_UNIFORM_SLOT);
  const floats = new Float32Array(staging), ints = new Int32Array(staging), words = new Uint32Array(staging);
  let used = 0;
  return {
    slot: (fill) => {
      if (used >= slots) throw new Error(`stamp paint: a submit's work took more than the ${slots} uniform slots its arena holds; size the arena for the most one submit encodes`);
      const offset = used++ * STAMP_UNIFORM_SLOT, word = offset / 4, count = STAMP_UNIFORM_SLOT / 4;
      words.fill(0, word, word + count);
      fill({ floats: floats.subarray(word, word + count), ints: ints.subarray(word, word + count), words: words.subarray(word, word + count) });
      return { buffer, offset, size: STAMP_UNIFORM_SLOT };
    },
    flush: () => {
      if (used) device.queue.writeBuffer(buffer, 0, staging, 0, used * STAMP_UNIFORM_SLOT);
    },
    reset: () => {
      used = 0;
    },
  };
}

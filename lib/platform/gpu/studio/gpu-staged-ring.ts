// gpu-staged-ring.ts: buffer space for work encoded now and submitted together, in units of a fixed size. A unit run
// is written into CPU staging as its work is encoded, and every run is uploaded by `flush` before the submit. A chunk
// too full for a run opens another, at least twice as big, so no total need be known first. gpu-uniform-ring.ts and
// gpu-instance-ring.ts are this, configured.

type GpuStagedChunk = { readonly buffer: GPUBuffer; readonly staging: ArrayBuffer; readonly units: number; used: number };

/** A run of zeroed units: its chunk's buffer and staging, and the bytes it spans in both from `offset`. */
export type GpuStagedRun = { readonly buffer: GPUBuffer; readonly staging: ArrayBuffer; readonly offset: number; readonly size: number };

export type GpuStagedRing = {
  /** `count` units side by side, zeroed, to fill in the run's staging before the flush. */
  take: (count: number) => GpuStagedRun;
  /**
   * Uploads every run taken since the last flush, and starts over. Warning: call it after encoding and before the
   * submit; a run taken after it waits for the next.
   */
  flush: () => void;
  destroy: () => void;
};

/** Units of `unitBytes` on `device` in buffers of `usage` (COPY_DST added), its first chunk holding `units`. */
export function createGpuStagedRing(device: GPUDevice, { label, usage, unitBytes, units: first }: { label: string; usage: number; unitBytes: number; units: number }): GpuStagedRing {
  const chunks: GpuStagedChunk[] = [];
  const open = (units: number) => {
    const staging = new ArrayBuffer(units * unitBytes);
    const chunk = { buffer: device.createBuffer({ label, size: staging.byteLength, usage: usage | GPUBufferUsage.COPY_DST }), staging, units, used: 0 };
    chunks.push(chunk);
    return chunk;
  };
  open(first);
  return {
    take: (count) => {
      const chunk = chunks.find(({ units, used }) => units - used >= count) ?? open(Math.max(count, chunks.at(-1)!.units * 2));
      const offset = chunk.used * unitBytes, size = count * unitBytes;
      chunk.used += count;
      new Uint8Array(chunk.staging, offset, size).fill(0);
      return { buffer: chunk.buffer, staging: chunk.staging, offset, size };
    },
    flush: () => {
      for (const chunk of chunks) {
        if (chunk.used) device.queue.writeBuffer(chunk.buffer, 0, chunk.staging, 0, chunk.used * unitBytes);
        chunk.used = 0;
      }
    },
    destroy: () => {
      for (const { buffer } of chunks.splice(0)) buffer.destroy();
    },
  };
}

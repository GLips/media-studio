// gpu-instance-ring.ts: per-instance vertex rows for draws encoded now and submitted together, as gpu-uniform-ring.ts
// holds their uniforms. A draw's rows are written into staging as it's encoded, side by side, and every row is
// uploaded by `flush` before the submit. A chunk too full for a draw's rows opens another, at least twice as big, so
// no count of rows need be known first.

type GpuInstanceChunk = { buffer: GPUBuffer; staging: Float32Array; rows: number; used: number };

/** Where a draw's rows lie: bound as an instance-step vertex buffer, row 0 at instance 0. */
export type GpuInstanceRows = { readonly buffer: GPUBuffer; readonly offset: number; readonly size: number };

export type GpuInstanceRing = {
  /** `count` rows, each `floats` wide, filled by `fill`, which writes row i from float i × floats of what it's given. */
  rows: (count: number, fill: (floats: Float32Array) => void) => GpuInstanceRows;
  /**
   * Uploads every row filled since the last flush, and starts over. Warning: call it after encoding and before the
   * submit; rows filled after it wait for the next.
   */
  flush: () => void;
  destroy: () => void;
};

/** Instance rows of `floats` floats each on `device`, its first chunk holding `rows`. */
export function createGpuInstanceRing(device: GPUDevice, { label, floats, rows: first = 256 }: { label: string; floats: number; rows?: number }): GpuInstanceRing {
  const chunks: GpuInstanceChunk[] = [], rowBytes = floats * 4;
  const open = (rows: number) => {
    const buffer = device.createBuffer({ label: `${label} instances`, size: rows * rowBytes, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const chunk = { buffer, staging: new Float32Array(rows * floats), rows, used: 0 };
    chunks.push(chunk);
    return chunk;
  };
  open(first);
  return {
    rows: (count, fill) => {
      const chunk = chunks.find(({ rows, used }) => rows - used >= count) ?? open(Math.max(count, chunks.at(-1)!.rows * 2));
      const from = chunk.used * floats, size = count * rowBytes, offset = chunk.used * rowBytes;
      chunk.used += count;
      const into = chunk.staging.subarray(from, from + count * floats);
      into.fill(0);
      fill(into);
      return { buffer: chunk.buffer, offset, size };
    },
    flush: () => {
      for (const chunk of chunks) {
        if (chunk.used) device.queue.writeBuffer(chunk.buffer, 0, chunk.staging, 0, chunk.used * floats);
        chunk.used = 0;
      }
    },
    destroy: () => {
      for (const { buffer } of chunks.splice(0)) buffer.destroy();
    },
  };
}

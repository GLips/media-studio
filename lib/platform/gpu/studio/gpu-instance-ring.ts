// gpu-instance-ring.ts: per-instance vertex rows for draws encoded now and submitted together, a draw's rows side by
// side, staged and uploaded before the submit by gpu-staged-ring.ts; and a row's layout, its fields read in order.

import { createGpuStagedRing } from './gpu-staged-ring.ts';

/** Where a draw's rows lie: bound as an instance-step vertex buffer, row 0 at instance 0. */
export type GpuInstanceRows = { readonly buffer: GPUBuffer; readonly offset: number; readonly size: number };

export type GpuInstanceRing = {
  /** `count` zeroed rows, each `floats` wide, filled by `fill`, which writes row i from float i × floats of what it's given. */
  rows: (count: number, fill: (floats: Float32Array) => void) => GpuInstanceRows;
  /**
   * Uploads every row filled since the last flush, and starts over. Warning: call it after encoding and before the
   * submit; rows filled after it wait for the next.
   */
  flush: () => void;
  destroy: () => void;
};

/** Instance rows of `floats` floats each on `device`, its first chunk holding `rows`. */
export function createGpuInstanceRing(device: GPUDevice, { label, floats, rows = 256 }: { label: string; floats: number; rows?: number }): GpuInstanceRing {
  const ring = createGpuStagedRing(device, { label: `${label} instances`, usage: GPUBufferUsage.VERTEX, unitBytes: floats * 4, units: rows });
  return {
    rows: (count, fill) => {
      const { buffer, staging, offset, size } = ring.take(count);
      fill(new Float32Array(staging, offset, count * floats));
      return { buffer, offset, size };
    },
    flush: ring.flush,
    destroy: ring.destroy,
  };
}

/** An instance row: its floats, and its instance-step layout. */
export type GpuInstanceRow = { readonly floats: number; readonly layout: GPUVertexBufferLayout };

/** A row of fields `widths` floats wide, side by side, field i read at shader location i: its floats and layout made together. */
export function gpuInstanceRow(widths: readonly (1 | 2 | 3 | 4)[]): GpuInstanceRow {
  const offsets = widths.map((_, i) => widths.slice(0, i).reduce((sum, width) => sum + width, 0)), floats = widths.reduce((sum, width) => sum + width, 0);
  const attributes = widths.map((width, shaderLocation): GPUVertexAttribute => ({ shaderLocation, offset: offsets[shaderLocation] * 4, format: width === 1 ? 'float32' : `float32x${width}` }));
  return { floats, layout: { arrayStride: floats * 4, stepMode: 'instance', attributes } };
}

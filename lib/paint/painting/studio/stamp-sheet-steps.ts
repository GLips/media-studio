// stamp-sheet-steps.ts: a sheet solve's GPU work a step at a time (ENGINE 4.7), and the probes its schedule reads.
// A step is encoded and submitted inside one of the owner's checks, its uniforms flushed before the submit and the
// arena reset after; a readback's mapping is awaited outside it, so no encoder is held across an await.
//
// The field keeps times after a base (ENGINE 3.4), which the solve's state holds: a step reads a time through its
// time base, which moves the base up in that step, before anything reads it, once the time runs far past it.

import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampPaintCostTally } from '../models/stamp-paint-costs.ts';
import { STAMP_DAMP_HISTOGRAM_WORDS, stampDampHistogram, type StampDampHistogram } from '../models/stamp-damp-histogram.ts';
import { STAMP_SHEET_TOTALS, stampSheetFailureMap, stampSheetTotals, type StampSheetFailureMap, type StampSheetTotals } from '../models/stamp-sheet-schedule.ts';
import type { StampSheetWetness } from '../models/stamp-sheet-program.ts';
import type { StampDrying } from '../models/stamp-wetness.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import type { StampSheetSolveGpu } from './stamp-sheet-load.ts';
import { stampSheetFailureGrid, type StampSheetCore } from './stamp-sheet-reductions.ts';

/** A storage buffer the reductions write, and the buffer it's read back through. */
type StampSheetWords = { count: number; storage: GPUBuffer; read: GPUBuffer };

/** Work a probe encodes before its reduction: the core's touch, the open-paint mask. */
export type StampSheetPrepare = (encoder: GPUCommandEncoder) => void;

/**
 * The field's time base as a solve's state holds it: `base()`, now; `after(encoder, tau)`, `tau` after the base as the
 * GPU holds it, the base moved first in `encoder` (stampSheetRebased) when `tau` is far past it.
 */
export type StampSheetTimeBase = { base: () => number; after: (encoder: GPUCommandEncoder, tau: number) => number };

/**
 * A solve's steps on `owner` through `device` (its scope's), over `gpu`, the paper drying as `drying` says and its
 * times read through `timeBase`; readbacks counted into `costs`.
 */
export function createStampSheetSteps(owner: StampPaintGpuOwner, device: StampPaintDevice, gpu: StampSheetSolveGpu, drying: StampDrying, timeBase: StampSheetTimeBase, costs: StampPaintCostTally | null) {
  const { after } = timeBase;
  const words = (count: number): StampSheetWords => ({
    count,
    storage: device.createBuffer({ size: count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }),
    read: device.createBuffer({ size: count * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
  });
  const whole = stampSheetFailureGrid({ x: 0, y: 0, w: gpu.stage.width, h: gpu.stage.height });
  const buffers = { totals: words(STAMP_SHEET_TOTALS.words), histogram: words(STAMP_DAMP_HISTOGRAM_WORDS), cells: words(whole.columns * whole.rows) };

  /** Encodes `work` and submits it, named `what` in a GPU error. Resolves what it returns once WebGPU has checked it. */
  const step = <T,>(what: string, work: (encoder: GPUCommandEncoder) => T): Promise<T> => owner.checked(what, () => {
    const encoder = device.createCommandEncoder();
    const result = work(encoder);
    gpu.arena.flush();
    device.queue.submit([encoder.finish()]);
    gpu.arena.reset();
    return result;
  });

  /** `buffer`'s words once `work` has written them from clear. */
  const readback = async (what: string, buffer: StampSheetWords, work: (encoder: GPUCommandEncoder) => void): Promise<Uint32Array> => {
    await step(what, (encoder) => {
      encoder.clearBuffer(buffer.storage);
      work(encoder);
      encoder.copyBufferToBuffer(buffer.storage, 0, buffer.read, 0, buffer.count * 4);
    });
    const waited = costs?.waiting('readback');
    await buffer.read.mapAsync(GPUMapMode.READ);
    waited?.();
    const read = new Uint32Array(buffer.read.getMappedRange().slice(0));
    buffer.read.unmap();
    costs?.count('readbacks');
    return read;
  };

  return {
    step,
    /** `core`'s totals at `tau`, `prepare` encoded first; able to bloom by water `bloom` (null for no bloom sum). */
    async totalsAt(core: StampSheetCore, tau: number, prepare: StampSheetPrepare | null, bloom: number | null): Promise<StampSheetTotals> {
      const read = await readback(`reading a core at ${tau} s`, buffers.totals, (encoder) => {
        const probe = { core, tau: after(encoder, tau), drying };
        prepare?.(encoder);
        gpu.reductions.totals(encoder, buffers.totals.storage, probe, bloom);
      });
      return stampSheetTotals(read, timeBase.base());
    },
    /** A damp histogram of `core` from `tau0`, bins `width` steps wide from step `start`. */
    async histogramAt(core: StampSheetCore, tau0: number, start: number, width: number): Promise<StampDampHistogram> {
      const read = await readback(`binning a core from ${tau0} s`, buffers.histogram, (encoder) => {
        gpu.reductions.histogram(encoder, buffers.histogram.storage, { core, tau: after(encoder, tau0), drying }, start, width);
      });
      return stampDampHistogram(read, start, width);
    },
    /** Where `on` fails over `core` at `tau`: its failing cells as boxes, document px. */
    async failureAt(core: StampSheetCore, tau: number, on: StampSheetWetness): Promise<StampSheetFailureMap> {
      const read = await readback(`mapping where a core fails at ${tau} s`, buffers.cells, (encoder) => {
        gpu.reductions.failure(encoder, buffers.cells.storage, { core, tau: after(encoder, tau), drying }, on);
      });
      const { columns, rows } = stampSheetFailureGrid(core.box);
      const { margin, frame } = gpu.stage;
      return stampSheetFailureMap(read, columns, rows, { x: core.box.x - margin, y: core.box.y - margin }, frame);
    },
    /** The latest anything wetted in `boxes` sets, model s; null where nothing is. */
    async latestSetOver(boxes: readonly StampPixelBox[]): Promise<number | null> {
      if (!boxes.length) return null;
      const read = await readback('reading when boxes set', buffers.totals, (encoder) => {
        for (const box of boxes) gpu.reductions.boxLatest(encoder, buffers.totals.storage, box, drying);
      });
      return stampSheetTotals(read, timeBase.base()).boxLatestSet;
    },
  };
}

export type StampSheetSteps = ReturnType<typeof createStampSheetSteps>;

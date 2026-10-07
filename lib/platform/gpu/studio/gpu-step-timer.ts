// gpu-step-timer.ts: what the GPU took for one command encoder's work, by timestamps on its own passes, first start to
// last end. Bracketing passes wouldn't do: touching nothing the work does, Metal runs them out of order with it. Only
// where the adapter offers `timestamp-query` (gpu-device-owner.ts); Chrome rounds them to 100 µs.
//
// Read back without waiting, once the submit is done, after the step has gone on. A bounded pool: a step finding no
// block of pairs free isn't timed, nor its passes past a block's.

/** Blocks of pairs in flight at once, one a step submitted and not yet read back. */
const GPU_STEP_TIMER_BLOCKS = 32;
/** The passes a step times at most: a block's pairs. With the blocks, WebGPU's 4096 queries a set. */
const GPU_STEP_TIMER_PASSES = 64;
/** A block's bytes as resolved: two 8-byte timestamps a pass, a multiple of resolveQuerySet's 256-byte alignment. */
const BLOCK_BYTES = GPU_STEP_TIMER_PASSES * 16;

/**
 * What the GPU took for a step: `ms` from its first pass's start to its last's end, and `busyMs` its passes' own
 * times summed (more than `ms` where they overlapped); `passes` timed, `untimed` past a block's. Null when it went
 * untimed: no block free, no pass, or the read failed.
 */
export type GpuStepTime = { readonly ms: number; readonly busyMs: number; readonly passes: number; readonly untimed: number } | null;

/** Times the work steps encode. */
export type GpuStepTimer = {
  /**
   * `encoder` as `encode` is given it, each pass it begins timed; `submitted`, called once `encoder` is submitted,
   * reads the times back and tells `timed`.
   */
  readonly bracket: <T>(encoder: GPUCommandEncoder, encode: (timed: GPUCommandEncoder) => T, timed: (time: GpuStepTime) => void) => { readonly result: T; readonly submitted: () => void };
};

const timers = new WeakMap<GPUDevice, GpuStepTimer | null>();

/** `device`'s step timer, made the first time it's asked for; null for a device without timestamp queries. */
export function gpuStepTimer(device: GPUDevice): GpuStepTimer | null {
  if (!timers.has(device)) timers.set(device, device.features.has('timestamp-query') ? createGpuStepTimer(device) : null);
  return timers.get(device)!;
}

/** The time `stamps` (begin, end per pass) give `passes` passes; null where none wrote. */
function gpuStepTimeOf(stamps: BigUint64Array, passes: number, untimed: number): GpuStepTime {
  let first: bigint | null = null, last: bigint | null = null, busy = 0n;
  for (let p = 0; p < passes; p++) {
    const begun = stamps[2 * p], ended = stamps[2 * p + 1];
    // A GPU's timestamps may run backwards across a power state change: such a pass is left out, not counted negative.
    if (ended < begun || begun === 0n) continue;
    busy += ended - begun;
    if (first === null || begun < first) first = begun;
    if (last === null || ended > last) last = ended;
  }
  return first === null || last === null ? null : { ms: Number(last - first) / 1e6, busyMs: Number(busy) / 1e6, passes, untimed };
}

function createGpuStepTimer(device: GPUDevice): GpuStepTimer {
  const querySet = device.createQuerySet({ type: 'timestamp', count: 2 * GPU_STEP_TIMER_PASSES * GPU_STEP_TIMER_BLOCKS });
  const resolved = device.createBuffer({ size: BLOCK_BYTES * GPU_STEP_TIMER_BLOCKS, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const free = Array.from({ length: GPU_STEP_TIMER_BLOCKS }, (_, block) => block), reads = new Map<number, GPUBuffer>();
  const readOf = (block: number) => {
    let read = reads.get(block);
    if (!read) reads.set(block, (read = device.createBuffer({ size: BLOCK_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })));
    return read;
  };
  return {
    bracket: (encoder, encode, timed) => {
      const block = free.pop();
      if (block === undefined) {
        timed(null);
        return { result: encode(encoder), submitted: () => {} };
      }
      let passes = 0, untimed = 0;
      /** The next pair of the block's, or none once they're spent. */
      const writes = () => {
        if (passes === GPU_STEP_TIMER_PASSES) {
          untimed++;
          return {};
        }
        const first = 2 * (block * GPU_STEP_TIMER_PASSES + passes++);
        return { timestampWrites: { querySet, beginningOfPassWriteIndex: first, endOfPassWriteIndex: first + 1 } };
      };
      // Bound to the encoder: WebGPU's methods refuse any other `this`. The work sees this one encoder throughout, so
      // what it keys by its encoder (a cache entry's frame) is alike.
      const traced = new Proxy(encoder, {
        get: (target, key: keyof GPUCommandEncoder) => {
          if (key === 'beginRenderPass') return (descriptor: GPURenderPassDescriptor) => target.beginRenderPass({ ...descriptor, ...writes() });
          if (key === 'beginComputePass') return (descriptor: GPUComputePassDescriptor = {}) => target.beginComputePass({ ...descriptor, ...writes() });
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const result = encode(traced);
      const read = readOf(block), at = BLOCK_BYTES * block;
      if (passes) {
        encoder.resolveQuerySet(querySet, 2 * GPU_STEP_TIMER_PASSES * block, 2 * passes, resolved, at);
        encoder.copyBufferToBuffer(resolved, at, read, 0, 16 * passes);
      }
      return {
        result,
        submitted: () => {
          if (!passes) {
            free.push(block);
            timed(null);
            return;
          }
          read.mapAsync(GPUMapMode.READ, 0, 16 * passes).then(() => {
            const stamps = new BigUint64Array(read.getMappedRange(0, 16 * passes).slice(0));
            read.unmap();
            free.push(block);
            timed(gpuStepTimeOf(stamps, passes, untimed));
            return undefined;
          }, () => {
            // A device lost or destroyed: the block goes with it.
            timed(null);
          });
        },
      };
    },
  };
}

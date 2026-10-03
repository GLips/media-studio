// stamp-solve-lease.ts: the device's solve lease (ENGINE 4.7), a FIFO async mutex beside its owner. A solve holds it
// from its first encode to its last readback, so two solves on one device never interleave: they share stage scratch,
// targets and the cache's eviction, each of which another's encodes would rewrite or destroy under it.
//
// Under the lease each step still encodes and submits inside `owner.checked` and awaits readbacks outside it: the
// lease serialises solves, never an encoder across an await. A frame's draw takes none; it reads films that exist.

import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';

/** Each owner's lease: the last solve queued on it, settled or not. */
const leases = new WeakMap<StampPaintGpuOwner, Promise<void>>();

/**
 * Runs `solve` once every solve queued on `owner` before it has settled, in the order they were asked for, and
 * resolves or rejects as it does. A failed solve releases the lease as a finished one does.
 */
export function withStampSolveLease<T>(owner: StampPaintGpuOwner, solve: () => Promise<T>): Promise<T> {
  const before = leases.get(owner) ?? Promise.resolve();
  const run = before.then(solve);
  leases.set(owner, run.then(() => undefined, () => undefined));
  return run;
}

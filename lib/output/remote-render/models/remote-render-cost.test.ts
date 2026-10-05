// What a remote command prints it billed is how someone decides how long to keep containers warm: a cold call must
// count its container's start, a warm one the idle wait before it, each at what Modal bills (reserved or used).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remoteCallBilling, remoteWarmDollarsPerHour, REMOTE_CPU_CORE_DOLLARS_PER_SECOND, REMOTE_GPU_DOLLARS_PER_SECOND, REMOTE_MEMORY_GIB_DOLLARS_PER_SECOND } from './remote-render-cost.ts';

const settings = { gpu: 'T4', cpu: { request: 2, limit: 8 }, memoryMiB: { request: 4096, limit: 16384 } } as const;
const perSecond = (cores: number, gib: number) => REMOTE_GPU_DOLLARS_PER_SECOND.T4 + cores * REMOTE_CPU_CORE_DOLLARS_PER_SECOND + gib * REMOTE_MEMORY_GIB_DOLLARS_PER_SECOND;

test('a cold call bills from its container\'s start and a warm one from the call before, each at the larger of reserved and used', () => {
  const cold = remoteCallBilling(settings, {
    gpuName: 'Tesla T4', containerStarted: 1000, previousCallEnded: null, callStarted: 1005, callEnded: 1105, cpuSeconds: 400, memoryPeakBytes: 6 * 2 ** 30,
  });
  assert.equal(cold.cold, true);
  assert.equal(cold.seconds, 105);
  assert.ok(Math.abs(cold.dollars - 105 * perSecond(4, 6)) < 1e-9);

  const warm = remoteCallBilling(settings, {
    gpuName: 'Tesla T4', containerStarted: 1000, previousCallEnded: 1105, callStarted: 1135, callEnded: 1165, cpuSeconds: 30, memoryPeakBytes: null,
  });
  assert.equal(warm.cold, false);
  assert.equal(warm.seconds, 60);
  assert.ok(Math.abs(warm.dollars - 60 * perSecond(2, 4)) < 1e-9);
});

test('an idle warm container costs its GPU and its reservation: about $0.72 an hour on the defaults', () => {
  assert.equal(remoteWarmDollarsPerHour(settings).toFixed(2), '0.72');
});

// remote-cost.ts: what a remote call costs on Modal, estimated from what the container reports of itself. Pure.
// Rates are Modal's list prices (modal.com/pricing, October 2026), per second.
//
// Modal bills a container from its start to its stop: the cold start, every call, and the warm wait after the last
// call (the settings' warmSeconds). CPU and memory are billed at the larger of what it reserved and what it
// used; a GPU whole.
import { formatRemoteWarmWindow, type RemoteContainerSize, type RemoteGpu } from './remote-settings.ts';

export const REMOTE_GPU_DOLLARS_PER_SECOND: Readonly<Record<RemoteGpu, number>> = { T4: 0.000164, L4: 0.000222, A10: 0.000306, L40S: 0.000542 };
export const REMOTE_CPU_CORE_DOLLARS_PER_SECOND = 0.0000131;
export const REMOTE_MEMORY_GIB_DOLLARS_PER_SECOND = 0.00000222;

/** What a container says of one call: when it and the call ran (epoch seconds), and what the call used. */
export type RemoteCallReport = {
  /** The GPU and its driver, or null in a container with none. */
  readonly gpuName: string | null;
  readonly containerStarted: number;
  /** When the call before it on this container ended, or null for its first: the warm wait between is billed too. */
  readonly previousCallEnded: number | null;
  readonly callStarted: number;
  readonly callEnded: number;
  /** CPU seconds the container used over the call, and its memory's peak, when its cgroup tells. */
  readonly cpuSeconds: number | null;
  readonly memoryPeakBytes: number | null;
};

const isNumberOrNull = (value: unknown): value is number | null => value === null || typeof value === 'number';

export function isRemoteCallReport(value: unknown): value is RemoteCallReport {
  return typeof value === 'object' && value !== null &&
    'gpuName' in value && (value.gpuName === null || typeof value.gpuName === 'string') &&
    'containerStarted' in value && typeof value.containerStarted === 'number' &&
    'previousCallEnded' in value && isNumberOrNull(value.previousCallEnded) &&
    'callStarted' in value && typeof value.callStarted === 'number' &&
    'callEnded' in value && typeof value.callEnded === 'number' &&
    'cpuSeconds' in value && isNumberOrNull(value.cpuSeconds) &&
    'memoryPeakBytes' in value && isNumberOrNull(value.memoryPeakBytes);
}

/** A call's billed stretch: since the container started (a cold call) or since its call before, to its end; s. */
export type RemoteCallBilling = { readonly cold: boolean; readonly seconds: number; readonly startSeconds: number; readonly dollars: number };

/** Dollars a container of `size` costs for `seconds`, using `cores` and `memoryGiB` on average. */
export function remoteContainerDollars(size: RemoteContainerSize, { seconds, cores, memoryGiB }: { seconds: number; cores: number; memoryGiB: number }): number {
  const billedCores = Math.max(size.cpu.request, cores), billedGiB = Math.max(size.memoryMiB.request / 1024, memoryGiB);
  const gpu = size.gpu === null ? 0 : REMOTE_GPU_DOLLARS_PER_SECOND[size.gpu];
  return seconds * (gpu + billedCores * REMOTE_CPU_CORE_DOLLARS_PER_SECOND + billedGiB * REMOTE_MEMORY_GIB_DOLLARS_PER_SECOND);
}

/** The cores a call used on average, when its container told. */
const coresUsed = (report: RemoteCallReport) =>
  (report.cpuSeconds === null || report.callEnded <= report.callStarted ? null : report.cpuSeconds / (report.callEnded - report.callStarted));

/** What one call on a container of `size` was billed, estimated: its stretch, at the cores it used and its memory's peak. */
export function remoteCallBilling(size: RemoteContainerSize, report: RemoteCallReport): RemoteCallBilling {
  const cold = report.previousCallEnded === null, since = report.previousCallEnded ?? report.containerStarted;
  const seconds = report.callEnded - since;
  const memoryGiB = report.memoryPeakBytes === null ? size.memoryMiB.request / 1024 : report.memoryPeakBytes / 2 ** 30;
  return { cold, seconds, startSeconds: report.callStarted - report.containerStarted, dollars: remoteContainerDollars(size, { seconds, cores: coresUsed(report) ?? size.cpu.request, memoryGiB }) };
}

/** Dollars an hour a container of `size` costs idle and warm: its GPU and what it reserves. */
export const remoteWarmDollarsPerHour = (size: RemoteContainerSize) => remoteContainerDollars(size, { seconds: 3600, cores: 0, memoryGiB: 0 });

const dollars = (amount: number) => `$${amount < 0.1 ? amount.toFixed(3) : amount.toFixed(2)}`;

/** One container's call: what it's called in the bill (`render 1/2`, `lint`), what it reserves, and its report. */
export type RemoteBilledCall = { readonly label: string; readonly size: RemoteContainerSize; readonly report: RemoteCallReport };

/** A container as a bill names it: its GPU, if it has one, and the cores it reserves. */
function describeContainer({ size, report }: RemoteBilledCall): string {
  const gpu = report.gpuName ?? size.gpu;
  return gpu === null ? `${size.cpu.request} cores` : `${gpu} and ${size.cpu.request} cores`;
}

/**
 * The lines a remote command prints of what it billed: each container's call (cold or warm, its stretch, its estimate),
 * the total, and what the containers cost if they wait out their warm window (`warmSeconds`) unused.
 */
export function formatRemoteBilling(calls: readonly RemoteBilledCall[], warmSeconds: number): string[] {
  const bills = calls.map((call) => ({ call, bill: remoteCallBilling(call.size, call.report) }));
  const total = bills.reduce((sum, { bill }) => sum + bill.dollars, 0), seconds = bills.reduce((sum, { bill }) => sum + bill.seconds, 0);
  const warm = calls.reduce((sum, { size }) => sum + remoteWarmDollarsPerHour(size) * (warmSeconds / 3600), 0);
  return [
    ...bills.map(({ call, bill }) => {
      const used = coresUsed(call.report);
      return `  ${call.label}: ${bill.cold ? `cold (started ${bill.startSeconds.toFixed(0)} s before the call)` : 'warm'}, ` +
        `${bill.seconds.toFixed(0)} s billed on ${describeContainer(call)}${used === null ? '' : `, ${used.toFixed(1)} cores used`} ≈ ${dollars(bill.dollars)}`;
    }),
    `billed ≈ ${dollars(total)} for ${seconds.toFixed(0)} container-seconds (estimate: Modal's rates × what each container reports)`,
    `warm for ${formatRemoteWarmWindow(warmSeconds)} after: ≈ ${dollars(warm)} more if unused (studio remote stop ends ${calls.length > 1 ? 'them' : 'it'} now)`,
  ];
}

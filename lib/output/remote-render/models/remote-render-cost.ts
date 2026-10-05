// remote-render-cost.ts: what a remote call costs on Modal, estimated from what the container reports of itself.
// Pure. Rates are Modal's list prices (modal.com/pricing, October 2026), per second.
//
// Modal bills a container from its start to its stop: the cold start, every call, and the warm wait after the last
// call (the settings' warmSeconds). CPU and memory are billed at the larger of what it reserved and what it
// used; the GPU whole.
import { formatRemoteWarmWindow, type RemoteRenderGpu, type RemoteRenderSettings } from './remote-render-settings.ts';

export const REMOTE_GPU_DOLLARS_PER_SECOND: Readonly<Record<RemoteRenderGpu, number>> = { T4: 0.000164, L4: 0.000222, A10: 0.000306, L40S: 0.000542 };
export const REMOTE_CPU_CORE_DOLLARS_PER_SECOND = 0.0000131;
export const REMOTE_MEMORY_GIB_DOLLARS_PER_SECOND = 0.00000222;

/** What a container says of one call: when it and the call ran (epoch seconds), and what the call used. */
export type RemoteCallReport = {
  readonly gpuName: string;
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
    'gpuName' in value && typeof value.gpuName === 'string' &&
    'containerStarted' in value && typeof value.containerStarted === 'number' &&
    'previousCallEnded' in value && isNumberOrNull(value.previousCallEnded) &&
    'callStarted' in value && typeof value.callStarted === 'number' &&
    'callEnded' in value && typeof value.callEnded === 'number' &&
    'cpuSeconds' in value && isNumberOrNull(value.cpuSeconds) &&
    'memoryPeakBytes' in value && isNumberOrNull(value.memoryPeakBytes);
}

/** A call's billed stretch: since the container started (a cold call) or since its call before, to its end; s. */
export type RemoteCallBilling = { readonly cold: boolean; readonly seconds: number; readonly startSeconds: number; readonly dollars: number };

/** Dollars a container on `settings` costs for `seconds`, using `cores` and `memoryGiB` on average. */
export function remoteContainerDollars(settings: Pick<RemoteRenderSettings, 'gpu' | 'cpu' | 'memoryMiB'>, { seconds, cores, memoryGiB }: { seconds: number; cores: number; memoryGiB: number }): number {
  const billedCores = Math.max(settings.cpu.request, cores), billedGiB = Math.max(settings.memoryMiB.request / 1024, memoryGiB);
  return seconds * (REMOTE_GPU_DOLLARS_PER_SECOND[settings.gpu] + billedCores * REMOTE_CPU_CORE_DOLLARS_PER_SECOND + billedGiB * REMOTE_MEMORY_GIB_DOLLARS_PER_SECOND);
}

/** What one call was billed, estimated: its stretch, at the cores it used on average and its memory's peak. */
export function remoteCallBilling(settings: Pick<RemoteRenderSettings, 'gpu' | 'cpu' | 'memoryMiB'>, report: RemoteCallReport): RemoteCallBilling {
  const cold = report.previousCallEnded === null, since = report.previousCallEnded ?? report.containerStarted;
  const seconds = report.callEnded - since, callSeconds = report.callEnded - report.callStarted;
  const cores = report.cpuSeconds === null || callSeconds <= 0 ? settings.cpu.request : report.cpuSeconds / callSeconds;
  const memoryGiB = report.memoryPeakBytes === null ? settings.memoryMiB.request / 1024 : report.memoryPeakBytes / 2 ** 30;
  return { cold, seconds, startSeconds: report.callStarted - report.containerStarted, dollars: remoteContainerDollars(settings, { seconds, cores, memoryGiB }) };
}

/** Dollars an hour a container on `settings` costs idle and warm: its GPU and what it reserves. */
export const remoteWarmDollarsPerHour = (settings: Pick<RemoteRenderSettings, 'gpu' | 'cpu' | 'memoryMiB'>) =>
  remoteContainerDollars(settings, { seconds: 3600, cores: 0, memoryGiB: 0 });

const dollars = (amount: number) => `$${amount < 0.1 ? amount.toFixed(3) : amount.toFixed(2)}`;

/**
 * The lines a remote command prints of what it billed: each container's call (cold or warm, its stretch, its estimate),
 * the total, and what the containers cost if they wait out their warm window unused.
 */
export function formatRemoteBilling(settings: RemoteRenderSettings, reports: readonly RemoteCallReport[]): string[] {
  const bills = reports.map((report) => ({ report, bill: remoteCallBilling(settings, report) }));
  const total = bills.reduce((sum, { bill }) => sum + bill.dollars, 0), seconds = bills.reduce((sum, { bill }) => sum + bill.seconds, 0);
  const warm = remoteWarmDollarsPerHour(settings) * (settings.warmSeconds / 3600) * reports.length;
  return [
    ...bills.map(({ report, bill }, i) => `  container ${i + 1}: ${bill.cold ? `cold (started ${bill.startSeconds.toFixed(0)} s before the call)` : 'warm'}, ` +
      `${bill.seconds.toFixed(0)} s billed on ${report.gpuName}${report.cpuSeconds === null ? '' : `, ${(report.cpuSeconds / Math.max(1, report.callEnded - report.callStarted)).toFixed(1)} cores`} ≈ ${dollars(bill.dollars)}`),
    `billed ≈ ${dollars(total)} for ${seconds.toFixed(0)} container-seconds on ${settings.gpu} (estimate: Modal's rates × what each container reports)`,
    `warm for ${formatRemoteWarmWindow(settings.warmSeconds)} after: ≈ ${dollars(warm)} more if unused (studio remote stop ends ${reports.length > 1 ? 'them' : 'it'} now)`,
  ];
}

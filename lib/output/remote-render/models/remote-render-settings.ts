// remote-render-settings.ts: what the deployed remote-render app runs on, chosen at `studio remote deploy` and baked
// into the deployment, which reports it back on every call. Pure.

/** The Modal GPUs a render server may run on: each Turing or newer NVIDIA card, with WebGPU through Dawn on Vulkan. */
export const REMOTE_RENDER_GPUS = ['T4', 'L4', 'A10', 'L40S'] as const;
export type RemoteRenderGpu = (typeof REMOTE_RENDER_GPUS)[number];

export const isRemoteRenderGpu = (name: string): name is RemoteRenderGpu => REMOTE_RENDER_GPUS.some((gpu) => gpu === name);

/** CPU cores or memory a container reserves (`request`, billed whenever it runs) and may burst to (`limit`). */
export type RemoteRenderReservation = { readonly request: number; readonly limit: number };

export type RemoteRenderSettings = {
  readonly gpu: RemoteRenderGpu;
  /** How long a container stays up after its last call, warm for the next: Modal's scaledown_window, 2 s to 20 min. */
  readonly warmSeconds: number;
  readonly maxContainers: number;
  /** Render browsers each container keeps open, each drawing its own piece of a video. */
  readonly browsers: number;
  readonly cpu: RemoteRenderReservation;
  readonly memoryMiB: RemoteRenderReservation;
  /** The Node version the image installs: the deploying machine's, so the container runs what the Mac does. */
  readonly node: string;
  /** SHA-256 of package-lock.json the image installed from, and of the app's own file, as deployed. */
  readonly lockHash: string;
  readonly appHash: string;
};

/** The deployed app's name, and the Volume its uploads live in, keyed by content. */
export const REMOTE_RENDER_APP = 'media-studio-render';
export const REMOTE_RENDER_VOLUME = 'media-studio-render-blobs';

/**
 * A deploy's settings unless its flags say otherwise. The T4 is the cheapest GPU that renders as well as the L4 here
 * (its GPU idles at 10–15%: each browser's GPU process is CPU-bound). Two cores and 4 GiB reserved keep a warm,
 * idle container cheap; a render bursts to the limits, billed as used.
 */
export const REMOTE_RENDER_DEFAULTS = {
  gpu: 'T4', warmSeconds: 600, maxContainers: 4, browsers: 3,
  cpu: { request: 2, limit: 8 }, memoryMiB: { request: 4096, limit: 16384 },
} as const satisfies Omit<RemoteRenderSettings, 'node' | 'lockHash' | 'appHash'>;

/** A warm window as people say it: whole minutes, else seconds. */
export const formatRemoteWarmWindow = (seconds: number) => (seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`);

/** Modal's bounds on scaledown_window, s. */
export const REMOTE_WARM_SECONDS_RANGE = { least: 2, most: 1200 } as const;

function isReservation(value: unknown): value is RemoteRenderReservation {
  return typeof value === 'object' && value !== null && 'request' in value && typeof value.request === 'number' && 'limit' in value && typeof value.limit === 'number';
}

/** Whether `value` (a call's answer, decoded) is a deployment's settings. */
export function isRemoteRenderSettings(value: unknown): value is RemoteRenderSettings {
  return typeof value === 'object' && value !== null &&
    'gpu' in value && typeof value.gpu === 'string' && isRemoteRenderGpu(value.gpu) &&
    'warmSeconds' in value && typeof value.warmSeconds === 'number' &&
    'maxContainers' in value && typeof value.maxContainers === 'number' &&
    'browsers' in value && typeof value.browsers === 'number' &&
    'node' in value && typeof value.node === 'string' &&
    'lockHash' in value && typeof value.lockHash === 'string' &&
    'appHash' in value && typeof value.appHash === 'string' &&
    'cpu' in value && isReservation(value.cpu) && 'memoryMiB' in value && isReservation(value.memoryMiB);
}

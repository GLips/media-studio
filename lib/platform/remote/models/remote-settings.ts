// remote-settings.ts: what the deployed remote app runs on, chosen at `studio remote deploy` and baked into the
// deployment, which reports it back on every call; and what any of its containers reserves, which its bill reads. Pure.

/** The Modal GPUs a render server may run on: each Turing or newer NVIDIA card, with WebGPU through Dawn on Vulkan. */
export const REMOTE_GPUS = ['T4', 'L4', 'A10', 'L40S'] as const;
export type RemoteGpu = (typeof REMOTE_GPUS)[number];

export const isRemoteGpu = (name: string): name is RemoteGpu => REMOTE_GPUS.some((gpu) => gpu === name);

/** CPU cores or memory a container reserves (`request`, billed whenever it runs) and may burst to (`limit`). */
export type RemoteReservation = { readonly request: number; readonly limit: number };

/** What a container runs on: a GPU or none, and the cores and memory it reserves. */
export type RemoteContainerSize = { readonly gpu: RemoteGpu | null; readonly cpu: RemoteReservation; readonly memoryMiB: RemoteReservation };

/** The render server's containers: a GPU each, up to `maxContainers` at once, drawing in `browsers` kept browsers. */
export type RemoteRenderServerSettings = RemoteContainerSize & {
  readonly gpu: RemoteGpu;
  readonly maxContainers: number;
  /** Render browsers each container draws its share in, each its own piece; it keeps one more for the sound. */
  readonly browsers: number;
};

export type RemoteSettings = {
  /**
   * How long a render container stays up after its last call, warm for the next, and a check container: Modal's
   * scaledown_window, 2 s to 20 min.
   */
  readonly warmSeconds: number;
  readonly checkWarmSeconds: number;
  readonly render: RemoteRenderServerSettings;
  /** The Node version the image installs: the deploying machine's, so the container runs what the Mac does. */
  readonly node: string;
  /** SHA-256 of package-lock.json the image installed from, and of the app's own file, as deployed. */
  readonly lockHash: string;
  readonly appHash: string;
};

/** The deployed app's name, and the Volume its uploads live in, keyed by content. */
export const REMOTE_APP = 'media-studio-remote';
export const REMOTE_VOLUME = 'media-studio-remote-blobs';

/**
 * A deploy's settings unless its flags say otherwise. The T4 is the cheapest GPU that renders as well as the L4 here
 * (its GPU idles at 10–15%: each browser's GPU process is CPU-bound). Two cores and 4 GiB reserved keep a warm,
 * idle render container cheap; a render bursts to the limits, billed as used.
 */
export const REMOTE_DEFAULTS = {
  warmSeconds: 600,
  // A cold check takes 13–19 s longer than a warm one and bills about what 15 s of waiting warm would: so a check
  // container waits only for a quick rerun.
  checkWarmSeconds: 120,
  render: { gpu: 'T4', maxContainers: 4, browsers: 3, cpu: { request: 2, limit: 8 }, memoryMiB: { request: 4096, limit: 16384 } },
} as const satisfies Omit<RemoteSettings, 'node' | 'lockHash' | 'appHash'>;

/** A warm window as people say it: whole minutes, else seconds. */
export const formatRemoteWarmWindow = (seconds: number) => (seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`);

/** Modal's bounds on scaledown_window, s. */
export const REMOTE_WARM_SECONDS_RANGE = { least: 2, most: 1200 } as const;

const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

function isReservation(value: unknown): value is RemoteReservation {
  return typeof value === 'object' && value !== null && 'request' in value && typeof value.request === 'number' && 'limit' in value && typeof value.limit === 'number';
}

function isRenderServerSettings(value: unknown): value is RemoteRenderServerSettings {
  return typeof value === 'object' && value !== null &&
    'gpu' in value && typeof value.gpu === 'string' && isRemoteGpu(value.gpu) &&
    'maxContainers' in value && isWhole(value.maxContainers) && 'browsers' in value && isWhole(value.browsers) &&
    'cpu' in value && isReservation(value.cpu) && 'memoryMiB' in value && isReservation(value.memoryMiB);
}

/** Whether `value` (a call's answer, decoded) is a deployment's settings. */
export function isRemoteSettings(value: unknown): value is RemoteSettings {
  return typeof value === 'object' && value !== null &&
    'warmSeconds' in value && typeof value.warmSeconds === 'number' &&
    'checkWarmSeconds' in value && typeof value.checkWarmSeconds === 'number' &&
    'render' in value && isRenderServerSettings(value.render) &&
    'node' in value && typeof value.node === 'string' &&
    'lockHash' in value && typeof value.lockHash === 'string' &&
    'appHash' in value && typeof value.appHash === 'string';
}

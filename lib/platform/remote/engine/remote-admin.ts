// remote-admin.ts: `studio remote`'s deploy, status and stop: the app deployed with its settings, what it runs on
// and costs warm, and its containers stopped now rather than at the end of their warm window. Node only.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { remoteWarmDollarsPerHour } from '../models/remote-cost.ts';
import { REMOTE_PROGRAM_SIZE, REMOTE_TEST_RUNNER_SIZE } from '../models/remote-run.ts';
import {
  formatRemoteWarmWindow, isRemoteGpu, REMOTE_APP, REMOTE_DEFAULTS, REMOTE_GPUS, REMOTE_WARM_SECONDS_RANGE, type RemoteContainerSize, type RemoteSettings,
} from '../models/remote-settings.ts';
import { REMOTE_APP_FILE, remoteAppHash, remoteLockHash } from './remote-call.ts';
import { deployRemoteApp, listRemoteContainers, openRemoteApp, stopRemoteContainers } from './remote-modal.ts';

/** What a deploy's flags may set; the rest are REMOTE_DEFAULTS. */
export type RemoteDeployChoices = {
  readonly gpu?: string; readonly warmSeconds?: number; readonly checkWarmSeconds?: number; readonly maxContainers?: number; readonly browsers?: number;
};

/** Most browsers a render container keeps: each holds a share of the GPU's memory (a T4 fits three painting tabs). */
const MOST_REMOTE_BROWSERS = 6;

const wholeIn = (value: number, least: number, most: number) => Number.isInteger(value) && value >= least && value <= most;

/** `choices` over the defaults, checked, with what binds the deployment to this checkout. */
function remoteSettingsOf(choices: RemoteDeployChoices): RemoteSettings {
  const { render } = REMOTE_DEFAULTS;
  const gpu = choices.gpu ?? render.gpu, warmSeconds = choices.warmSeconds ?? REMOTE_DEFAULTS.warmSeconds;
  const checkWarmSeconds = choices.checkWarmSeconds ?? REMOTE_DEFAULTS.checkWarmSeconds;
  const maxContainers = choices.maxContainers ?? render.maxContainers, browsers = choices.browsers ?? render.browsers;
  if (!isRemoteGpu(gpu)) throw new Error(`--gpu is one of ${REMOTE_GPUS.join(', ')}, not ${gpu}`);
  const { least, most } = REMOTE_WARM_SECONDS_RANGE;
  if (!wholeIn(warmSeconds, least, most)) throw new Error(`--warm is ${least}–${most} seconds (Modal's scaledown window), not ${warmSeconds}`);
  if (!wholeIn(checkWarmSeconds, least, most)) throw new Error(`--check-warm is ${least}–${most} seconds (Modal's scaledown window), not ${checkWarmSeconds}`);
  if (!wholeIn(maxContainers, 1, 32)) throw new Error(`--max-containers is a whole number 1–32, not ${maxContainers}`);
  if (!wholeIn(browsers, 1, MOST_REMOTE_BROWSERS)) throw new Error(`--browsers is a whole number 1–${MOST_REMOTE_BROWSERS}, not ${browsers}`);
  return {
    warmSeconds, checkWarmSeconds, render: { gpu, maxContainers, browsers, cpu: render.cpu, memoryMiB: render.memoryMiB },
    node: process.versions.node, lockHash: remoteLockHash(), appHash: remoteAppHash(),
  };
}

const describeSize = ({ cpu, memoryMiB }: RemoteContainerSize) =>
  `${cpu.request === cpu.limit ? cpu.request : `${cpu.request}–${cpu.limit}`} cores, ${memoryMiB.request / 1024}–${memoryMiB.limit / 1024} GiB`;
const warmCost = (size: RemoteContainerSize) => `≈ $${remoteWarmDollarsPerHour(size).toFixed(2)}/h`;
/** A check container's size, its GPU first when it has one, and what it costs warm. */
const describeCheckSize = (size: RemoteContainerSize) => `${size.gpu === null ? '' : `a ${size.gpu}, `}${describeSize(size)} (${warmCost(size)} warm)`;

/** Lines of what a deployment runs on and costs warm. */
export const describeRemoteSettings = ({ render, warmSeconds, checkWarmSeconds }: RemoteSettings) => [
  `renders: a ${render.gpu} a container, ${render.browsers} browser${render.browsers > 1 ? 's' : ''} in it, up to ${render.maxContainers} at once; ` +
    `${describeSize(render)}; ${warmCost(render)} warm`,
  `checks: ${describeCheckSize(REMOTE_TEST_RUNNER_SIZE)} for a test runner, ${describeCheckSize(REMOTE_PROGRAM_SIZE)} for any other script`,
  `a render container stays warm ${formatRemoteWarmWindow(warmSeconds)} after its last call, a check container ${formatRemoteWarmWindow(checkWarmSeconds)}`,
];

/**
 * Deploys the app with `choices`, building its image when the lockfile or Node changed, and stops the containers the
 * deployment before it left warm: they would answer calls on its settings and code until their window ran out. Returns
 * the settings and how many it stopped.
 */
export async function deployRemote(choices: RemoteDeployChoices): Promise<{ settings: RemoteSettings; stopped: number }> {
  const settings = remoteSettingsOf(choices);
  withStudioTemp('remote-deploy', (dir) => {
    const file = join(dir, 'remote-settings.json');
    writeFileSync(file, JSON.stringify(settings));
    deployRemoteApp(REMOTE_APP_FILE, file);
  });
  return { settings, stopped: await stopRemote() };
}

/** What the deployed app runs on, and how many of its containers are up now. */
export async function remoteStatus(): Promise<string[]> {
  const app = await openRemoteApp();
  try {
    const { settings } = await app.prepare({ files: [], generations: [] });
    const running = listRemoteContainers(await app.appId()).length;
    const current = settings.lockHash === remoteLockHash() && settings.appHash === remoteAppHash();
    return [
      `${REMOTE_APP}:`, ...describeRemoteSettings(settings).map((line) => `  ${line}`),
      `${running} container${running === 1 ? '' : 's'} up now${running ? ' (studio remote stop ends them)' : ''}`,
      ...(current ? [] : ['deployed from another lockfile or app than this checkout\'s: run studio remote deploy before using it']),
    ];
  } finally {
    app.close();
  }
}

/** Stops the app's containers now, renders' and checks'; returns how many. */
export async function stopRemote(): Promise<number> {
  const app = await openRemoteApp();
  try {
    const containers = listRemoteContainers(await app.appId());
    stopRemoteContainers(containers);
    return containers.length;
  } finally {
    app.close();
  }
}

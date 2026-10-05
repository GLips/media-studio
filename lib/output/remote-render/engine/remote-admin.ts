// remote-admin.ts: `studio remote`'s deploy, status and stop: the app deployed with its settings, what it runs on
// and costs warm, and its containers stopped now rather than at the end of their warm window. Node only.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { remoteWarmDollarsPerHour } from '../models/remote-render-cost.ts';
import {
  formatRemoteWarmWindow, isRemoteRenderGpu, REMOTE_RENDER_APP, REMOTE_RENDER_DEFAULTS, REMOTE_RENDER_GPUS, REMOTE_WARM_SECONDS_RANGE, type RemoteRenderSettings,
} from '../models/remote-render-settings.ts';
import { REMOTE_RENDER_APP_FILE, remoteAppHash, remoteLockHash } from './remote-call.ts';
import { deployRemoteRenderApp, openRemoteRenderApp, stopRemoteRenderContainers } from './remote-modal.ts';

/** What a deploy's flags may set; the rest are REMOTE_RENDER_DEFAULTS. */
export type RemoteDeployChoices = { readonly gpu?: string; readonly warmSeconds?: number; readonly maxContainers?: number; readonly browsers?: number };

/** Most browsers a container keeps: each holds a share of the GPU's memory (a T4 fits three painting tabs). */
const MOST_REMOTE_BROWSERS = 6;

const wholeIn = (value: number, least: number, most: number) => Number.isInteger(value) && value >= least && value <= most;

/** `choices` over the defaults, checked, with what binds the deployment to this checkout. */
function remoteSettingsOf(choices: RemoteDeployChoices): RemoteRenderSettings {
  const gpu = choices.gpu ?? REMOTE_RENDER_DEFAULTS.gpu, warmSeconds = choices.warmSeconds ?? REMOTE_RENDER_DEFAULTS.warmSeconds;
  const maxContainers = choices.maxContainers ?? REMOTE_RENDER_DEFAULTS.maxContainers, browsers = choices.browsers ?? REMOTE_RENDER_DEFAULTS.browsers;
  if (!isRemoteRenderGpu(gpu)) throw new Error(`--gpu is one of ${REMOTE_RENDER_GPUS.join(', ')}, not ${gpu}`);
  const { least, most } = REMOTE_WARM_SECONDS_RANGE;
  if (!wholeIn(warmSeconds, least, most)) throw new Error(`--warm is ${least}–${most} seconds (Modal's scaledown window), not ${warmSeconds}`);
  if (!wholeIn(maxContainers, 1, 32)) throw new Error(`--max-containers is a whole number 1–32, not ${maxContainers}`);
  if (!wholeIn(browsers, 1, MOST_REMOTE_BROWSERS)) throw new Error(`--browsers is a whole number 1–${MOST_REMOTE_BROWSERS}, not ${browsers}`);
  return {
    gpu, warmSeconds, maxContainers, browsers, cpu: REMOTE_RENDER_DEFAULTS.cpu, memoryMiB: REMOTE_RENDER_DEFAULTS.memoryMiB,
    node: process.versions.node, lockHash: remoteLockHash(), appHash: remoteAppHash(),
  };
}

/** One line of what a deployment runs on and costs warm. */
export const describeRemoteSettings = (settings: RemoteRenderSettings) =>
  `${settings.gpu}, ${settings.browsers} browser${settings.browsers > 1 ? 's' : ''} a container, up to ${settings.maxContainers} containers; ` +
  `${settings.cpu.request}–${settings.cpu.limit} cores, ${settings.memoryMiB.request / 1024}–${settings.memoryMiB.limit / 1024} GiB; ` +
  `warm ${formatRemoteWarmWindow(settings.warmSeconds)} after a call at ≈ $${remoteWarmDollarsPerHour(settings).toFixed(2)}/h a container`;

/**
 * Deploys the app with `choices`, building its image when the lockfile or Node changed, and stops the containers the
 * deployment before it left warm: they would answer calls on its settings and code until their window ran out. Returns
 * the settings and how many it stopped.
 */
export async function deployRemoteRender(choices: RemoteDeployChoices): Promise<{ settings: RemoteRenderSettings; stopped: number }> {
  const settings = remoteSettingsOf(choices);
  withStudioTemp('remote-deploy', (dir) => {
    const file = join(dir, 'remote-settings.json');
    writeFileSync(file, JSON.stringify(settings));
    deployRemoteRenderApp(REMOTE_RENDER_APP_FILE, file);
  });
  return { settings, stopped: await stopRemoteRender() };
}

/** What the deployed app runs on, and how many render containers it runs now. */
export async function remoteRenderStatus(): Promise<string[]> {
  const app = await openRemoteRenderApp();
  try {
    const { settings } = await app.prepare({ files: [], generations: [] });
    const running = await app.runningServers();
    const current = settings.lockHash === remoteLockHash() && settings.appHash === remoteAppHash();
    return [
      `${REMOTE_RENDER_APP}: ${describeRemoteSettings(settings)}`,
      `${running} render container${running === 1 ? '' : 's'} up now${running ? ' (studio remote stop ends them)' : ''}`,
      ...(current ? [] : ['deployed from another lockfile or app than this checkout\'s: run studio remote deploy before rendering']),
    ];
  } finally {
    app.close();
  }
}

/** Stops the app's containers now; returns how many. */
export async function stopRemoteRender(): Promise<number> {
  const app = await openRemoteRenderApp();
  try {
    return stopRemoteRenderContainers(await app.appId());
  } finally {
    app.close();
  }
}

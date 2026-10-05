// remote-admin.ts: `studio remote`'s deploy, status and stop: this checkout's version of the app deployed with its
// settings, the versions deployed with what this one runs on and costs warm, and containers stopped now rather than at
// the end of their warm window. Node only.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { remoteWarmDollarsPerHour } from '../models/remote-cost.ts';
import { REMOTE_PROGRAM_SIZE, REMOTE_TEST_RUNNER_SIZE } from '../models/remote-run.ts';
import {
  formatRemoteWarmWindow, isRemoteAppVersion, isRemoteGpu, REMOTE_DEFAULTS, REMOTE_GPUS, REMOTE_WARM_SECONDS_RANGE, type RemoteContainerSize, type RemoteSettings,
} from '../models/remote-settings.ts';
import { REMOTE_APP_FILE, remoteCheckoutApp } from './remote-call.ts';
import { deployRemoteApp, listDeployedRemoteApps, openRemoteApp, stopRemoteContainers, type DeployedRemoteApp } from './remote-modal.ts';

/** What a deploy's flags may set; the rest are REMOTE_DEFAULTS. */
export type RemoteDeployChoices = {
  readonly gpu?: string; readonly warmSeconds?: number; readonly checkWarmSeconds?: number; readonly maxContainers?: number; readonly browsers?: number;
};

/** Most browsers a render container keeps: each holds a share of the GPU's memory (a T4 fits three painting tabs). */
const MOST_REMOTE_BROWSERS = 6;

const wholeIn = (value: number, least: number, most: number) => Number.isInteger(value) && value >= least && value <= most;

/** `choices` over the defaults, checked, with this checkout's Node and version. */
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
    node: process.versions.node, app: remoteCheckoutApp(),
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
 * Deploys this checkout's version of the app with `choices`, its image built when the lockfile or Node changed, and
 * returns its settings. The containers that version's deployment before left are ended (deployRemoteApp); no other
 * version's are touched.
 */
export function deployRemote(choices: RemoteDeployChoices): RemoteSettings {
  const settings = remoteSettingsOf(choices);
  withStudioTemp('remote-deploy', (dir) => {
    const file = join(dir, 'remote-settings.json');
    writeFileSync(file, JSON.stringify(settings));
    deployRemoteApp(REMOTE_APP_FILE, file);
  });
  return settings;
}

const containersUp = (count: number) => `${count || 'no'} container${count === 1 ? '' : 's'} up`;

/** The versions of the app deployed, each with its containers up now, and what this checkout's runs on when it's one. */
export async function remoteStatus(): Promise<string[]> {
  const mine = remoteCheckoutApp(), versions = listDeployedRemoteApps(isRemoteAppVersion);
  const listed = versions.length
    ? ['versions of the remote app deployed:', ...versions.map(({ name, containers }) => `  ${name}: ${containersUp(containers.length)}${name === mine ? ' (this checkout\'s)' : ''}`)]
    : ['no version of the remote app is deployed'];
  const stopping = versions.some(({ containers }) => containers.length) ? ['studio remote stop ends this checkout\'s version\'s containers now, --all every version\'s'] : [];
  if (!versions.some(({ name }) => name === mine)) return [...listed, `this checkout's version, ${mine}, isn't deployed: studio remote deploy deploys it`, ...stopping];
  const app = await openRemoteApp(mine);
  try {
    const { settings } = await app.prepare({ files: [], generations: [] });
    return [...listed, `${mine}, this checkout's, runs:`, ...describeRemoteSettings(settings).map((line) => `  ${line}`), ...stopping];
  } finally {
    app.close();
  }
}

/**
 * Stops the containers of this checkout's version of the app now, renders' and checks', or with `all` every version's;
 * returns the versions it looked at, each with the containers it stopped.
 */
export function stopRemote({ all }: { all: boolean }): { mine: string; stopped: DeployedRemoteApp[] } {
  const mine = remoteCheckoutApp(), stopped = listDeployedRemoteApps(all ? isRemoteAppVersion : (name) => name === mine);
  for (const { containers } of stopped) stopRemoteContainers(containers);
  return { mine, stopped };
}

// remote-modal.ts: the studio's one door to Modal. The deployed remote-render app (modal_render_app.py) is called
// through Modal's JS SDK, which reads the machine's Modal token from ~/.modal.toml itself; what the SDK can't do
// (deploy, list and stop containers) goes through the `modal` CLI. Nothing here prints or keeps a token. Node only.
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { ModalClient, NotFoundError } from 'modal';
import { REMOTE_RENDER_APP, isRemoteRenderSettings, type RemoteRenderSettings } from '../models/remote-render-settings.ts';
import { isRemoteCallReport, type RemoteCallReport } from '../models/remote-render-cost.ts';

/** The app's classes: uploads into its Volume (a small CPU container), and the GPU render server. */
const BLOBS_CLASS = 'StudioRenderBlobs', SERVER_CLASS = 'StudioRenderServer';

/** What `prepare` answers: the deployment's settings, and which of the asked-after uploads its Volume lacks. */
export type RemotePrepareAnswer = { readonly settings: RemoteRenderSettings; readonly missingFiles: readonly string[]; readonly missingGenerations: readonly string[] };

/** A batch of uploads: files by content hash, or files of one brush generation by path in it, `complete` on its last. */
export type RemotePutRequest =
  | { readonly kind: 'files'; readonly files: readonly { readonly hash: string; readonly bytes: Uint8Array }[] }
  | { readonly kind: 'generation'; readonly key: string; readonly files: readonly { readonly path: string; readonly bytes: Uint8Array }[]; readonly complete: boolean };

/** What a render call answers: whether its job ran, the files it made by name, and its container's report. */
export type RemoteRunAnswer = { readonly ok: boolean; readonly error: string | null; readonly files: ReadonlyMap<string, Uint8Array>; readonly report: RemoteCallReport };

/**
 * A render call's request: the files its container lays out as [path, content hash], the brush generations it links
 * as [path, key], and its job as JSON.
 */
export type RemoteRunRequest = {
  readonly files: readonly (readonly [string, string])[]; readonly generations: readonly (readonly [string, string])[]; readonly job: string;
};

const isText = (value: unknown): value is string => typeof value === 'string';
const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);

/** A made file as it crosses CBOR: its name and bytes. */
function isNamedBytes(value: unknown): value is [string, Uint8Array] {
  return Array.isArray(value) && value.length === 2 && isText(value[0]) && value[1] instanceof Uint8Array;
}

function isRemotePrepareAnswer(value: unknown): value is RemotePrepareAnswer {
  return typeof value === 'object' && value !== null && 'settings' in value && isRemoteRenderSettings(value.settings) &&
    'missingFiles' in value && isTextList(value.missingFiles) && 'missingGenerations' in value && isTextList(value.missingGenerations);
}

/** A run's answer as it crosses CBOR: its files a list of [name, bytes] pairs. */
function isRunAnswerWire(value: unknown): value is { ok: boolean; error: string | null; files: [string, Uint8Array][]; report: RemoteCallReport } {
  return typeof value === 'object' && value !== null && 'ok' in value && typeof value.ok === 'boolean' &&
    'error' in value && (value.error === null || isText(value.error)) && 'report' in value && isRemoteCallReport(value.report) &&
    'files' in value && Array.isArray(value.files) && value.files.every(isNamedBytes);
}

export type RemoteRenderApp = Awaited<ReturnType<typeof openRemoteRenderApp>>;

/** How long a finished call's last log lines may take to arrive before the command goes on without them. */
const LOG_TAIL_MS = 3000;

/** The deployed app, its classes looked up; refuses with how to deploy it when it isn't. */
export async function openRemoteRenderApp() {
  const client = new ModalClient();
  const lookUp = async (name: string) => {
    try {
      return await (await client.cls.fromName(REMOTE_RENDER_APP, name)).instance();
    } catch (error) {
      if (error instanceof NotFoundError) throw new Error(`the remote render app (${REMOTE_RENDER_APP}) isn't deployed: run studio remote deploy`, { cause: error });
      throw error;
    }
  };
  const [blobs, server] = await Promise.all([lookUp(BLOBS_CLASS), lookUp(SERVER_CLASS)]);

  /** Which of `files` (content hashes) and `generations` (brush generation keys) the Volume lacks, and the settings. */
  async function prepare(request: { files: readonly string[]; generations: readonly string[] }): Promise<RemotePrepareAnswer> {
    const answer: unknown = await blobs.method('prepare').remote([request]);
    if (!isRemotePrepareAnswer(answer)) throw new Error(`the remote render app answered prepare with something else: deploy it again (studio remote deploy)`);
    return answer;
  }

  /**
   * Runs `request` (a job and the files it needs) on a render server, each line its container logs told to `onLine`
   * as it comes, and returns its answer.
   */
  async function run(request: RemoteRunRequest, onLine: (line: string) => void): Promise<RemoteRunAnswer> {
    const call = await server.method('run').spawn([request]);
    let pending = '';
    // Following the log is best effort: a dropped stream loses lines, never the call's answer.
    const following = (async () => {
      for await (const entry of call.logs.stream()) {
        pending += entry.message;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) onLine(line);
      }
    })().catch(() => {});
    const answer: unknown = await call.get();
    await Promise.race([following, sleep(LOG_TAIL_MS)]);
    if (!isRunAnswerWire(answer)) throw new Error('the remote render app answered run with something else: deploy it again (studio remote deploy)');
    return { ...answer, files: new Map(answer.files) };
  }

  return {
    prepare,
    put: (request: RemotePutRequest) => blobs.method('put').remote([request]),
    run,
    /** Containers the render server runs now, warm or busy. */
    runningServers: async () => (await server.method('run').getCurrentStats()).numTotalRunners,
    appId: async () => (await client.apps.fromName(REMOTE_RENDER_APP)).appId,
    close: () => client.close(),
  };
}

/** Runs the `modal` CLI with `args`, its output on stderr; refuses with its status when it fails. */
function runModalCli(args: readonly string[], { env }: { env?: NodeJS.ProcessEnv } = {}): void {
  const { status, error } = spawnSync('modal', args, { stdio: ['ignore', 2, 2], env: { ...process.env, ...env } });
  if (error) throw new Error(`modal ${args[0]}: ${error.message} (install Modal's CLI and log in: modal setup)`);
  if (status !== 0) throw new Error(`modal ${args.join(' ')} failed (exit ${status})`);
}

/**
 * Deploys the app at `appFile` with the settings in the JSON file `settingsFile`. Modal imports the app here to read
 * it, which would leave a __pycache__ in lib/.
 */
export function deployRemoteRenderApp(appFile: string, settingsFile: string): void {
  runModalCli(['deploy', appFile], { env: { STUDIO_REMOTE_SETTINGS: settingsFile, PYTHONDONTWRITEBYTECODE: '1' } });
}

/** A row of `modal container list --json`, keyed by its columns in snake case. */
function isListedContainer(value: unknown): value is { container_id: string } {
  return typeof value === 'object' && value !== null && 'container_id' in value && isText(value.container_id);
}

/** Stops every container of the app now, warm or busy (a busy one's call fails); returns how many. */
export function stopRemoteRenderContainers(appId: string): number {
  const listed = spawnSync('modal', ['container', 'list', '--json', '--app-id', appId], { encoding: 'utf8', stdio: ['ignore', 'pipe', 2] });
  if (listed.error || listed.status !== 0) throw new Error(`modal container list failed${listed.error ? `: ${listed.error.message}` : ''}`);
  const containers: unknown = JSON.parse(listed.stdout);
  if (!Array.isArray(containers) || !containers.every(isListedContainer)) throw new Error('modal container list answered in a shape this studio doesn\'t read');
  for (const container of containers) runModalCli(['container', 'stop', '--yes', container.container_id]);
  return containers.length;
}

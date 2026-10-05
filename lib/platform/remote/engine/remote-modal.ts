// remote-modal.ts: the studio's one door to Modal. The deployed remote app (modal_remote_app.py) is called through
// Modal's JS SDK, which reads the machine's Modal token from ~/.modal.toml itself; what the SDK can't do (deploy, list
// and stop containers) goes through the `modal` CLI. Nothing here prints or keeps a token. Node only.
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { ModalClient, NotFoundError, type FunctionCall } from 'modal';
import { isRemoteCallReport, type RemoteCallReport } from '../models/remote-cost.ts';
import { REMOTE_APP, isRemoteSettings, type RemoteContainerSize, type RemoteSettings } from '../models/remote-settings.ts';

/** The app's classes: uploads into its Volume (a small CPU container), the GPU render server, the CPU check server. */
const BLOBS_CLASS = 'StudioRemoteBlobs', RENDER_CLASS = 'StudioRenderServer', CHECK_CLASS = 'StudioCheckServer';

/** What `prepare` answers: the deployment's settings, and which of the asked-after uploads its Volume lacks. */
export type RemotePrepareAnswer = { readonly settings: RemoteSettings; readonly missingFiles: readonly string[]; readonly missingGenerations: readonly string[] };

/** A batch of uploads: files by content hash, or files of one brush generation by path in it, `complete` on its last. */
export type RemotePutRequest =
  | { readonly kind: 'files'; readonly files: readonly { readonly hash: string; readonly bytes: Uint8Array }[] }
  | { readonly kind: 'generation'; readonly key: string; readonly files: readonly { readonly path: string; readonly bytes: Uint8Array }[]; readonly complete: boolean };

/** The tree a container lays out: files as [path, content hash] and brush generations as [path, key], paths studio-relative. */
export type RemoteLayout = { readonly files: readonly (readonly [string, string])[]; readonly generations: readonly (readonly [string, string])[] };

/** A render call's request: its layout and its job as JSON. */
export type RemoteRenderRequest = RemoteLayout & { readonly job: string };

/** What a render call answers: whether its job ran, the files it made by name, and its container's report. */
export type RemoteRenderAnswer = { readonly ok: boolean; readonly error: string | null; readonly files: ReadonlyMap<string, Uint8Array>; readonly report: RemoteCallReport };

/**
 * A check call's request: its layout, the repositories it holds (`root` '' the studio, 'work' its workspace) with the
 * paths each tracks, the npm script to run and the processors it sees.
 */
export type RemoteCheckRequest = RemoteLayout & {
  readonly repos: readonly { readonly root: string; readonly tracked: readonly string[] }[]; readonly script: string; readonly cores: number;
};

/** What a check call answers: the script's exit code and whole output, its seconds, what laying out did, and the report. */
export type RemoteCheckAnswer = { readonly exitCode: number; readonly output: string; readonly seconds: number; readonly setup: string; readonly report: RemoteCallReport };

const isText = (value: unknown): value is string => typeof value === 'string';
const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);

/** A made file as it crosses CBOR: its name and bytes. */
function isNamedBytes(value: unknown): value is [string, Uint8Array] {
  return Array.isArray(value) && value.length === 2 && isText(value[0]) && value[1] instanceof Uint8Array;
}

function isRemotePrepareAnswer(value: unknown): value is RemotePrepareAnswer {
  return typeof value === 'object' && value !== null && 'settings' in value && isRemoteSettings(value.settings) &&
    'missingFiles' in value && isTextList(value.missingFiles) && 'missingGenerations' in value && isTextList(value.missingGenerations);
}

/** A render's answer as it crosses CBOR: its files a list of [name, bytes] pairs. */
function isRenderAnswerWire(value: unknown): value is { ok: boolean; error: string | null; files: [string, Uint8Array][]; report: RemoteCallReport } {
  return typeof value === 'object' && value !== null && 'ok' in value && typeof value.ok === 'boolean' &&
    'error' in value && (value.error === null || isText(value.error)) && 'report' in value && isRemoteCallReport(value.report) &&
    'files' in value && Array.isArray(value.files) && value.files.every(isNamedBytes);
}

function isCheckAnswer(value: unknown): value is RemoteCheckAnswer {
  return typeof value === 'object' && value !== null && 'exitCode' in value && typeof value.exitCode === 'number' &&
    'output' in value && isText(value.output) && 'seconds' in value && typeof value.seconds === 'number' &&
    'setup' in value && isText(value.setup) && 'report' in value && isRemoteCallReport(value.report);
}

export type RemoteApp = Awaited<ReturnType<typeof openRemoteApp>>;

/** How long a finished call's last log lines may take to arrive before the command goes on without them. */
const LOG_TAIL_MS = 3000;

/** What a call should answer: `isAnswer` checks it, `what` names it in the refusal, and `linesIn` counts its lines. */
type RemoteCallExpectation<T> = { readonly what: string; readonly isAnswer: (value: unknown) => value is T; readonly linesIn?: (answer: T) => number };

/**
 * Each whole line `call` logs, told to `onLine` as it comes, until the call ends; then its answer, refused unless it is
 * what `expect` says. When `linesIn` says how many lines the call printed, the log is followed only until they have
 * all come: its stream may stay open past the call's end.
 */
async function followRemoteCall<T>(call: FunctionCall, onLine: (line: string) => void, expect: RemoteCallExpectation<T>): Promise<T> {
  let pending = '', seen = 0, expected = Number.POSITIVE_INFINITY;
  // Following the log is best effort: a dropped stream loses lines, never the call's answer.
  const following = (async () => {
    for await (const entry of call.logs.stream()) {
      pending += entry.message;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      seen += lines.length;
      for (const line of lines) onLine(line);
      if (seen >= expected) return;
    }
  })().catch(() => {});
  const answer: unknown = await call.get();
  if (!expect.isAnswer(answer)) throw new Error(`the remote app answered ${expect.what} with something else: deploy it again (studio remote deploy)`);
  expected = expect.linesIn?.(answer) ?? expected;
  if (seen < expected) await Promise.race([following, sleep(LOG_TAIL_MS)]);
  return answer;
}

/** The lines in a call's printed `output`, a last one unended counted too. */
export const remoteOutputLines = (output: string) => output.split('\n').length - (output.endsWith('\n') || output === '' ? 1 : 0);

/** The deployed app, its classes looked up; refuses with how to deploy it when it isn't. */
export async function openRemoteApp() {
  const client = new ModalClient();
  const lookUp = async (name: string) => {
    try {
      return await client.cls.fromName(REMOTE_APP, name);
    } catch (error) {
      if (error instanceof NotFoundError) throw new Error(`the remote app (${REMOTE_APP}) isn't deployed: run studio remote deploy`, { cause: error });
      throw error;
    }
  };
  const [blobs, renderServer, checkServer] = await Promise.all([
    lookUp(BLOBS_CLASS).then((cls) => cls.instance()), lookUp(RENDER_CLASS).then((cls) => cls.instance()), lookUp(CHECK_CLASS),
  ]);

  /** Which of `files` (content hashes) and `generations` (brush generation keys) the Volume lacks, and the settings. */
  async function prepare(request: { files: readonly string[]; generations: readonly string[] }): Promise<RemotePrepareAnswer> {
    const answer: unknown = await blobs.method('prepare').remote([request]);
    if (!isRemotePrepareAnswer(answer)) throw new Error('the remote app answered prepare with something else: deploy it again (studio remote deploy)');
    return answer;
  }

  /** Runs `request` (a job and the files it needs) on a render server, each line its container logs told to `onLine`. */
  async function render(request: RemoteRenderRequest, onLine: (line: string) => void): Promise<RemoteRenderAnswer> {
    const answer = await followRemoteCall(await renderServer.method('run').spawn([request]), onLine, { what: 'a render', isAnswer: isRenderAnswerWire });
    return { ...answer, files: new Map(answer.files) };
  }

  /**
   * Runs `request` (a script and the checkout it reads) on a check server of `size`, kept warm `warmSeconds` after, each
   * line its container logs told to `onLine`.
   */
  async function check(request: RemoteCheckRequest, size: RemoteContainerSize, warmSeconds: number, onLine: (line: string) => void): Promise<RemoteCheckAnswer> {
    const sized = await checkServer.withOptions({
      ...(size.gpu === null ? {} : { gpu: size.gpu }),
      cpu: size.cpu.request, cpuLimit: size.cpu.limit, memoryMiB: size.memoryMiB.request, memoryLimitMiB: size.memoryMiB.limit, scaledownWindowMs: warmSeconds * 1000,
    }).instance();
    return followRemoteCall(await sized.method('run').spawn([request]), onLine, {
      what: 'a check', isAnswer: isCheckAnswer, linesIn: (answer) => remoteOutputLines(answer.output),
    });
  }

  return {
    prepare,
    put: (request: RemotePutRequest) => blobs.method('put').remote([request]),
    render,
    check,
    appId: async () => (await client.apps.fromName(REMOTE_APP)).appId,
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
export function deployRemoteApp(appFile: string, settingsFile: string): void {
  runModalCli(['deploy', appFile], { env: { STUDIO_REMOTE_SETTINGS: settingsFile, PYTHONDONTWRITEBYTECODE: '1' } });
}

/** A row of `modal container list --json`, keyed by its columns in snake case. */
function isListedContainer(value: unknown): value is { container_id: string } {
  return typeof value === 'object' && value !== null && 'container_id' in value && isText(value.container_id);
}

/** The ids of the app's containers up now, warm or busy, of every class. */
export function listRemoteContainers(appId: string): string[] {
  const listed = spawnSync('modal', ['container', 'list', '--json', '--app-id', appId], { encoding: 'utf8', stdio: ['ignore', 'pipe', 2] });
  if (listed.error || listed.status !== 0) throw new Error(`modal container list failed${listed.error ? `: ${listed.error.message}` : ''}`);
  const containers: unknown = JSON.parse(listed.stdout);
  if (!Array.isArray(containers) || !containers.every(isListedContainer)) throw new Error('modal container list answered in a shape this studio doesn\'t read');
  return containers.map((container) => container.container_id);
}

/** Stops each of `containers` now (a busy one's call fails). */
export function stopRemoteContainers(containers: readonly string[]): void {
  for (const container of containers) runModalCli(['container', 'stop', '--yes', container]);
}

// studio-app-daemon.ts: the main checkout's studio app as one background process, started by whoever needs it and
// stopped only by `studio app stop`. Callers return once it answers.
//
// The state file is evidence, not proof: a process is signalled only once `ps` shows it running our entry with the
// file's instance id, so a reused pid can't aim a kill elsewhere. A per-port lock serializes starts and stops.
//
// Freshness: HMR reloads web/, but the plugins vite.config.ts imports natively stay as they loaded, so a start
// restarts an instance whose code fingerprint moved. `status` only looks.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { askStudioAppIdentity, studioAppReadinessFailure } from './studio-app-server.ts';

const STUDIO_APP_STATE_DIR = join(homedir(), 'Library/Application Support/media-studio/studio-app');
const STUDIO_APP_ENTRY = join(import.meta.dirname, 'studio-app-daemon-entry.ts');
/** Vite's first start optimizes the player's dependencies, and the first page compiles routes. */
const STUDIO_APP_START_TIMEOUT_MS = 120_000;
const STUDIO_APP_STOP_TIMEOUT_MS = 10_000;

/** What the state file says about a running instance. */
export type StudioAppInstance = { instanceId: string; pid: number; port: number; root: string; fingerprint: string; startedAt: string; log: string };

/** The app as `studio app status --json` reports it, which Studio Recorder's menu reads. */
export type StudioAppStatus = {
  state: 'running' | 'stopped' | 'unhealthy' | 'foreign';
  url: string | null;
  pid: number | null;
  startedAt: string | null;
  /** Running on code that has changed since; the next start restarts it. */
  stale: boolean;
  /** Why it's unhealthy, or what holds the port. */
  detail: string | null;
  log: string;
};

const statePath = (port: number) => join(STUDIO_APP_STATE_DIR, `${port}.json`);
const lockPath = (port: number) => join(STUDIO_APP_STATE_DIR, `${port}.lock`);
export const studioAppLogPath = (port: number) => join(homedir(), 'Library/Logs', `StudioApp-${port}.log`);
const appUrl = (port: number) => `http://localhost:${port}`;

export function readStudioAppInstance(port: number): StudioAppInstance | null {
  if (!existsSync(statePath(port))) return null;
  // SAFETY: only this module writes the file, from a StudioAppInstance.
  return JSON.parse(readFileSync(statePath(port), 'utf8')) as StudioAppInstance;
}

function writeStudioAppInstance(instance: StudioAppInstance): void {
  mkdirSync(STUDIO_APP_STATE_DIR, { recursive: true });
  const temp = `${statePath(instance.port)}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(instance, null, 2));
  renameSync(temp, statePath(instance.port));
}

/** Removes the state file only while it still names `instanceId`: a newer instance's is left alone. */
export function forgetStudioAppInstance(port: number, instanceId: string): void {
  if (readStudioAppInstance(port)?.instanceId === instanceId) unlinkSync(statePath(port));
}

/** The code an instance serves: HEAD, the uncommitted diff, and untracked files' content. Ignored files (work/) don't count. */
export function studioCodeFingerprint(root: string): string {
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  const hash = createHash('sha256').update(git(['rev-parse', 'HEAD'])).update(git(['diff', 'HEAD', '--binary']));
  for (const file of git(['ls-files', '-z', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean)) {
    hash.update(file).update(readFileSync(join(root, file)));
  }
  return hash.digest('hex').slice(0, 16);
}

/** True only while `pid` runs our entry for this instance id: a reused pid runs something else. */
function isStudioAppProcess(instance: StudioAppInstance): boolean {
  let command: string;
  try {
    command = execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(instance.pid)], { encoding: 'utf8' });
  } catch {
    // ps exits 1 when there's no such process.
    return false;
  }
  return command.includes(STUDIO_APP_ENTRY) && command.includes(`--instance ${instance.instanceId}`);
}

/** The pid and command listening on `port`, for an error to name what to stop; null when lsof finds none. */
function portHolder(port: number): string | null {
  try {
    const pid = execFileSync('lsof', ['-nP', '-tiTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n')[0];
    return `pid ${pid} (${execFileSync('ps', ['-ww', '-o', 'command=', '-p', pid], { encoding: 'utf8' }).trim()})`;
  } catch {
    return null;
  }
}

/** Runs `work` holding the port's lock, waiting while another live process holds it. */
async function withStudioAppLock<T>(port: number, work: () => Promise<T>): Promise<T> {
  mkdirSync(STUDIO_APP_STATE_DIR, { recursive: true });
  await takeStudioAppLock(port, Date.now() + STUDIO_APP_START_TIMEOUT_MS + STUDIO_APP_STOP_TIMEOUT_MS);
  try {
    return await work();
  } finally {
    unlinkSync(lockPath(port));
  }
}

async function takeStudioAppLock(port: number, deadline: number): Promise<void> {
  try {
    writeFileSync(lockPath(port), String(process.pid), { flag: 'wx' });
    return;
  } catch (error) {
    // SAFETY: node:fs throws ErrnoExceptions.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const holder = Number(readFileSync(lockPath(port), 'utf8'));
  // An empty file is a holder between creating and writing it; a dead holder's lock is reclaimed.
  if (holder && !isAlive(holder)) unlinkSync(lockPath(port));
  else if (Date.now() > deadline) throw new Error(`the studio app's lock (${lockPath(port)}) is held by pid ${holder}, which is still starting or stopping it`);
  else await sleep(200);
  return takeStudioAppLock(port, deadline);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // SAFETY: process.kill throws ErrnoExceptions.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** How the app on `port` stands. Only looks: it never starts, stops or rewrites anything. */
export async function studioAppStatus(port: number): Promise<StudioAppStatus> {
  const log = studioAppLogPath(port);
  const stopped: StudioAppStatus = { state: 'stopped', url: null, pid: null, startedAt: null, stale: false, detail: null, log };
  const instance = readStudioAppInstance(port);
  const ours = instance !== null && isStudioAppProcess(instance) ? instance : null;
  const holder = await askStudioAppIdentity(port);
  if (!ours) {
    if (holder.kind === 'nothing') return stopped;
    const what = holder.kind === 'studio' ? `a studio app of ${holder.root} not started by \`studio app\`` : holder.detail;
    return { ...stopped, state: 'foreign', detail: `port ${port} is held by ${what}${portHolder(port) ? `: ${portHolder(port)}` : ''}` };
  }
  const base = { url: appUrl(port), pid: ours.pid, startedAt: ours.startedAt, stale: ours.fingerprint !== studioCodeFingerprint(ours.root), log };
  if (holder.kind !== 'studio' || holder.instanceId !== ours.instanceId) {
    return { ...base, state: 'unhealthy', detail: holder.kind === 'nothing' ? 'it is running but not listening yet, or has stopped listening' : 'another server answers on its port' };
  }
  const failure = await studioAppReadinessFailure(port);
  return failure ? { ...base, state: 'unhealthy', detail: failure } : { ...base, state: 'running', detail: null };
}

/**
 * The app on `port`, running on this checkout's current code: reused when it's ours, healthy and fresh, else
 * restarted or started. Refuses a port something else holds, naming it, rather than stop what isn't ours.
 */
export function ensureStudioAppRunning(port: number): Promise<StudioAppStatus> {
  return withStudioAppLock(port, async () => {
    const instance = readStudioAppInstance(port);
    if (instance && !isStudioAppProcess(instance)) forgetStudioAppInstance(port, instance.instanceId);
    else if (instance) {
      if (instance.root !== STUDIO_ROOT) throw new Error(`port ${port} is held by the studio app of ${instance.root}: stop it from there with \`studio app stop\``);
      const status = await studioAppStatus(port);
      if (status.state === 'running' && !status.stale) return status;
      process.stderr.write(`restarting the studio app: ${status.stale ? 'its code has changed' : status.detail}\n`);
      await stopStudioAppInstance(instance);
    }
    const holder = await askStudioAppIdentity(port);
    if (holder.kind !== 'nothing') {
      const what = holder.kind === 'studio' ? `a studio app of ${holder.root} that \`studio app\` didn't start` : holder.detail;
      throw new Error(`port ${port} is held by ${what}${portHolder(port) ? `, ${portHolder(port)}` : ''}: stop it, then try again`);
    }
    await spawnStudioAppInstance(port);
    return studioAppStatus(port);
  });
}

/** Stops the app on `port` if `studio app` started it; true when one was stopped. */
export function stopStudioApp(port: number): Promise<boolean> {
  return withStudioAppLock(port, async () => {
    const instance = readStudioAppInstance(port);
    if (!instance) return false;
    if (!isStudioAppProcess(instance)) {
      forgetStudioAppInstance(port, instance.instanceId);
      return false;
    }
    await stopStudioAppInstance(instance);
    return true;
  });
}

async function stopStudioAppInstance(instance: StudioAppInstance): Promise<void> {
  process.kill(instance.pid, 'SIGTERM');
  const gone = await pollStudioApp(STUDIO_APP_STOP_TIMEOUT_MS, 100, () => Promise.resolve(isStudioAppProcess(instance) ? null : true));
  if (!gone) process.kill(instance.pid, 'SIGKILL');
  forgetStudioAppInstance(instance.port, instance.instanceId);
}

/** Asks `check` every `everyMs` until it answers non-null or `withinMs` pass; null on timing out. */
async function pollStudioApp<T>(withinMs: number, everyMs: number, check: () => Promise<T | null>, deadline = Date.now() + withinMs): Promise<T | null> {
  const answer = await check();
  if (answer !== null) return answer;
  if (Date.now() > deadline) return null;
  await sleep(everyMs);
  return pollStudioApp(withinMs, everyMs, check, deadline);
}

/** Starts a detached instance and waits until it serves pages, failing with its log's tail if it exits first. */
async function spawnStudioAppInstance(port: number): Promise<void> {
  const instanceId = randomUUID();
  const log = studioAppLogPath(port);
  const logFd = openSync(log, 'a');
  writeFileSync(logFd, `\n${new Date().toISOString()} starting the studio app ${instanceId} on port ${port}\n`);
  // Detached, with its output in its own log and no pipe back here: a caller (the recorder reads its commands' pipes
  // to their end) returns once it answers, not once it exits.
  const child = spawn(process.execPath, [...process.execArgv, STUDIO_APP_ENTRY, '--port', String(port), '--instance', instanceId], {
    cwd: STUDIO_ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  closeSync(logFd);
  let exited: number | null = null;
  child.on('exit', (code, signal) => {
    exited = code ?? (signal ? 128 : 1);
  });
  child.unref();
  writeStudioAppInstance({ instanceId, pid: child.pid!, port, root: STUDIO_ROOT, fingerprint: studioCodeFingerprint(STUDIO_ROOT), startedAt: new Date().toISOString(), log });
  const outcome = await pollStudioApp(STUDIO_APP_START_TIMEOUT_MS, 250, async () => {
    if (exited !== null) return { exited };
    const holder = await askStudioAppIdentity(port);
    const ready = holder.kind === 'studio' && holder.instanceId === instanceId && (await studioAppReadinessFailure(port)) === null;
    return ready ? { exited: null } : null;
  });
  if (outcome === null) throw new Error(`the studio app didn't answer within ${STUDIO_APP_START_TIMEOUT_MS / 1000} s; see ${log}`);
  if (outcome.exited !== null) {
    forgetStudioAppInstance(port, instanceId);
    const tail = readFileSync(log, 'utf8').trimEnd().split('\n').slice(-5).join('\n');
    // The reason comes last: Studio Recorder shows a failed command's last stderr line.
    throw new Error(`its log (${log}) ends:\n${tail}\nthe studio app exited ${outcome.exited} while starting`);
  }
}

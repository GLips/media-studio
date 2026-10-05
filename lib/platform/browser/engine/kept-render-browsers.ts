// kept-render-browsers.ts: render browsers kept open across commands on a machine that only renders (a remote-render
// container), so each command finds a browser's GPU process, adapter and compiled shaders warm. A keeper process
// (keepRenderBrowsers) opens them and reopens any that dies; while STUDIO_KEPT_RENDER_BROWSERS names its folder, a
// render borrows a free one wherever it would open its own (inRenderBrowser). Node only.
//
// The folder holds `keeper.json`, the keeper's identity and how many it keeps, and per browser i: `<i>.json`, its pid
// and DevTools endpoint, or the error that keeps it from opening; `<i>.lock`, its borrower's identity while lent; and
// `<i>.sh`, the shim a borrower attaches through (attachRenderBrowser).
import { chmodSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { HeadlessBrowser } from '@remotion/renderer';
import { processPidAlive, studioProcessRunning, thisStudioProcess, type StudioProcessIdentity } from '#lib/platform/process/engine/studio-process.ts';
import { attachRenderBrowser, openRenderBrowser, sendRenderBrowserCommand } from './render-browser-launch.ts';

/** Names the keeper's folder to every render of a process that borrows kept browsers. */
export const KEPT_RENDER_BROWSERS_ENV = 'STUDIO_KEPT_RENDER_BROWSERS';

const KEEPER_POLL_MS = 1000, BORROW_POLL_MS = 200;
/** A browser that failed to open is tried again after this, not every poll. */
const REOPEN_AFTER_FAILURE_MS = 10_000;

/** A kept browser as its record says: open at `endpoint` as process `pid`, or failing to open. */
type KeptRenderBrowser = { readonly pid: number; readonly endpoint: string } | { readonly error: string };
type RenderBrowserKeeper = StudioProcessIdentity & { readonly count: number };

/** A borrowed browser: given back once, `broken` when it failed as a browser, which ends it for the keeper to reopen. */
export type KeptRenderBrowserLoan = { readonly browser: HeadlessBrowser; readonly waited: number; readonly giveBack: (broken: boolean) => Promise<void> };

const isIdentity = (value: object): value is StudioProcessIdentity =>
  'pid' in value && typeof value.pid === 'number' && 'started' in value && typeof value.started === 'number';

function isRenderBrowserKeeper(value: unknown): value is RenderBrowserKeeper {
  return typeof value === 'object' && value !== null && isIdentity(value) && 'count' in value && typeof value.count === 'number';
}

function isKeptRenderBrowser(value: unknown): value is KeptRenderBrowser {
  if (typeof value !== 'object' || value === null) return false;
  if ('error' in value) return typeof value.error === 'string';
  return 'pid' in value && typeof value.pid === 'number' && 'endpoint' in value && typeof value.endpoint === 'string';
}

function isStudioProcessIdentity(value: unknown): value is StudioProcessIdentity {
  return typeof value === 'object' && value !== null && isIdentity(value);
}

/** The file at `path` read as JSON and held to `is`; undefined when it's missing or isn't one. */
function readKeptFile<T>(path: string, is: (value: unknown) => value is T): T | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return is(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Written whole: a reader finds the old file or the new one, never half of one. */
function writeKeptFile(path: string, value: KeptRenderBrowser | RenderBrowserKeeper) {
  writeFileSync(`${path}.${process.pid}`, JSON.stringify(value));
  renameSync(`${path}.${process.pid}`, path);
}

const recordPath = (dir: string, slot: number) => join(dir, `${slot}.json`);
const lockPath = (dir: string, slot: number) => join(dir, `${slot}.lock`);

// ---------- the keeper ----------

const isText = (value: unknown): value is string => typeof value === 'string';

function isCdpProcess(value: unknown): value is { type: string; id: number } {
  return typeof value === 'object' && value !== null && 'type' in value && isText(value.type) && 'id' in value && typeof value.id === 'number';
}

/** CDP's SystemInfo.getProcessInfo answer, the browser's own process among the rest. */
function isCdpProcessList(value: unknown): value is { processInfo: { type: string; id: number }[] } {
  return typeof value === 'object' && value !== null && 'processInfo' in value && Array.isArray(value.processInfo) && value.processInfo.every(isCdpProcess);
}

function isCommandLineAnswer(value: unknown): value is { arguments: string[] } {
  return typeof value === 'object' && value !== null && 'arguments' in value && Array.isArray(value.arguments) && value.arguments.every(isText);
}

/** Where a browser Remotion opened listens, from the DevToolsActivePort Chrome writes in its profile. */
async function keptBrowserRecord(browser: HeadlessBrowser): Promise<KeptRenderBrowser> {
  const { value: processes } = await sendRenderBrowserCommand(browser, 'SystemInfo.getProcessInfo');
  const pid = isCdpProcessList(processes) ? processes.processInfo.find((p) => p.type === 'browser')?.id : undefined;
  // Answered only with --enable-automation on the command line, which Remotion passes.
  const { value: commandLine } = await sendRenderBrowserCommand(browser, 'Browser.getBrowserCommandLine');
  const profile = isCommandLineAnswer(commandLine) ? commandLine.arguments.find((a) => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length) : undefined;
  if (pid === undefined || profile === undefined) throw new Error('a kept render browser didn\'t say its process or its profile');
  const [port, path] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n');
  return { pid, endpoint: `ws://127.0.0.1:${port}${path}` };
}

/**
 * Keeps `count` render browsers open for borrowers until the process is stopped, reopening any whose process ends (a
 * crash, or a borrower ending a broken one). Clears `dir` first: a keeper before it left only stale records.
 */
export async function keepRenderBrowsers(dir: string, count: number): Promise<never> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const kept = new Map<number, HeadlessBrowser>(), failedAt = new Map<number, number>();
  const closeAll = () => Promise.all([...kept.values()].map((browser) => browser.close({ silent: true })));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => void closeAll().finally(() => process.exit(0)));

  async function open(slot: number) {
    const old = kept.get(slot);
    kept.delete(slot);
    // Its process is gone; closing drops Remotion's hold on it and its profile folder.
    await old?.close({ silent: true });
    rmSync(recordPath(dir, slot), { force: true });
    try {
      const browser = await openRenderBrowser();
      kept.set(slot, browser);
      writeKeptFile(recordPath(dir, slot), await keptBrowserRecord(browser));
      failedAt.delete(slot);
    } catch (error) {
      // SAFETY: Remotion and CDP throw Errors.
      writeKeptFile(recordPath(dir, slot), { error: (error as Error).message });
      failedAt.set(slot, performance.now());
    }
  }

  const slots = Array.from({ length: count }, (_, i) => i);
  writeKeptFile(join(dir, 'keeper.json'), { ...thisStudioProcess(), count });
  await Promise.all(slots.map(open));
  process.stderr.write(`keeping ${count} render browsers in ${dir}\n`);
  const ended = (slot: number) => {
    const record = readKeptFile(recordPath(dir, slot), isKeptRenderBrowser);
    if (record && 'pid' in record && processPidAlive(record.pid)) return false;
    return performance.now() - (failedAt.get(slot) ?? -Infinity) >= REOPEN_AFTER_FAILURE_MS;
  };
  const watch = async (): Promise<never> => {
    await sleep(KEEPER_POLL_MS);
    await Promise.all(slots.filter(ended).map(open));
    return watch();
  };
  return watch();
}

// ---------- borrowing ----------

/**
 * Takes `slot`'s lock for this process, unless another running process holds it. A lock is linked in whole from a
 * file of this process's own, so a reader never finds it empty; one whose holder ended is taken over.
 */
function lockSlot(dir: string, slot: number): boolean {
  const lock = lockPath(dir, slot), mine = `${lock}.${process.pid}`;
  writeFileSync(mine, JSON.stringify(thisStudioProcess()));
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        linkSync(mine, lock);
        return true;
      } catch (error) {
        // SAFETY: node:fs throws ErrnoExceptions.
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const holder = readKeptFile(lock, isStudioProcessIdentity);
        if (!holder || studioProcessRunning(holder)) return false;
        rmSync(lock, { force: true });
      }
    }
    return false;
  } finally {
    rmSync(mine, { force: true });
  }
}

/** A page or other target in a browser, as CDP's Target.getTargets lists it. */
type CdpTarget = { readonly targetId: string; readonly type: string };
/** What the CDP commands sent here answer: Target.getTargets its targets, the rest nothing read. */
type CdpResult = { readonly targetInfos?: readonly CdpTarget[] };

function isCdpTarget(value: unknown): value is CdpTarget {
  return typeof value === 'object' && value !== null && 'targetId' in value && isText(value.targetId) && 'type' in value && isText(value.type);
}

function isCdpResult(value: unknown): value is CdpResult {
  return typeof value === 'object' && value !== null && (!('targetInfos' in value) || (Array.isArray(value.targetInfos) && value.targetInfos.every(isCdpTarget)));
}

function isCdpError(value: unknown): value is { message: string } {
  return typeof value === 'object' && value !== null && 'message' in value && isText(value.message);
}

function isCdpAnswer(value: unknown): value is { id: number; result?: CdpResult; error?: { message: string } } {
  return typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'number' &&
    (!('result' in value) || isCdpResult(value.result)) && (!('error' in value) || isCdpError(value.error));
}

/**
 * Closes every page a borrower before left in the browser at `endpoint` (one that crashed leaves its tabs), then opens
 * a blank one: Remotion attaches only once it finds a page, and closes that first one itself.
 */
async function clearKeptBrowserPages(endpoint: string): Promise<void> {
  const socket = new WebSocket(endpoint), waiting = new Map<number, { resolve: (result: CdpResult) => void; reject: (error: Error) => void }>();
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error(`a kept render browser at ${endpoint} refused its DevTools connection`)), { once: true });
  });
  socket.addEventListener('message', (event) => {
    const answer: unknown = JSON.parse(String(event.data));
    if (!isCdpAnswer(answer)) return;
    const waiter = waiting.get(answer.id);
    waiting.delete(answer.id);
    if (answer.error) waiter?.reject(new Error(`a kept render browser refused a command: ${answer.error.message}`));
    else waiter?.resolve(answer.result ?? {});
  });
  let sent = 0;
  const send = (method: string, params: Readonly<Record<string, string>> = {}) => new Promise<CdpResult>((resolve, reject) => {
    waiting.set(++sent, { resolve, reject });
    socket.send(JSON.stringify({ id: sent, method, params }));
  });
  try {
    const { targetInfos = [] } = await send('Target.getTargets');
    await Promise.all(targetInfos.filter((t) => t.type === 'page').map(({ targetId }) => send('Target.closeTarget', { targetId })));
    await send('Target.createTarget', { url: 'about:blank' });
  } finally {
    socket.close();
  }
}

/** Kills a kept browser's process; the keeper sees it gone and opens another. */
function endKeptBrowser(pid: number) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    // SAFETY: process.kill throws ErrnoExceptions.
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function attachKeptBrowser(dir: string, slot: number, { pid, endpoint }: { pid: number; endpoint: string }): Promise<Omit<KeptRenderBrowserLoan, 'waited'>> {
  await clearKeptBrowserPages(endpoint);
  const shim = join(dir, `${slot}.sh`);
  writeFileSync(shim, `#!/bin/sh\necho 'DevTools listening on ${endpoint}' >&2\nexec sleep 2147483647\n`);
  chmodSync(shim, 0o755);
  const browser = await attachRenderBrowser(shim);
  return {
    browser,
    async giveBack(broken) {
      await browser.close({ silent: true });
      if (broken) endKeptBrowser(pid);
      rmSync(lockPath(dir, slot), { force: true });
    },
  };
}

/**
 * Borrows a free browser from the keeper whose folder is `dir`, waiting while every one is lent or opening. Fails when
 * no keeper runs there, or every browser it keeps fails to open. `waited` is the seconds it waited.
 */
export async function borrowKeptRenderBrowser(dir: string): Promise<KeptRenderBrowserLoan> {
  const asked = performance.now();
  const { slot, held } = await lockKeptSlot(dir);
  const waited = (performance.now() - asked) / 1000;
  try {
    return { ...(await attachKeptBrowser(dir, slot, held)), waited };
  } catch (error) {
    endKeptBrowser(held.pid);
    rmSync(lockPath(dir, slot), { force: true });
    throw error;
  }
}

type LockedKeptSlot = { readonly slot: number; readonly held: { readonly pid: number; readonly endpoint: string } };

/** A slot of the keeper in `dir` whose browser is open and free, locked for this process, polling until one is. */
async function lockKeptSlot(dir: string): Promise<LockedKeptSlot> {
  const keeper = readKeptFile(join(dir, 'keeper.json'), isRenderBrowserKeeper);
  if (!keeper || !studioProcessRunning(keeper)) throw new Error(`no render browser keeper runs in ${dir}`);
  const records = Array.from({ length: keeper.count }, (_, slot) => ({ slot, record: readKeptFile(recordPath(dir, slot), isKeptRenderBrowser) }));
  for (const { slot, record } of records) {
    if (!record || 'error' in record || !processPidAlive(record.pid) || !lockSlot(dir, slot)) continue;
    // Read again under the lock: the keeper may have reopened it since.
    const held = readKeptFile(recordPath(dir, slot), isKeptRenderBrowser);
    if (held && !('error' in held) && processPidAlive(held.pid)) return { slot, held };
    rmSync(lockPath(dir, slot), { force: true });
  }
  const failing = records.flatMap(({ record }) => (record && 'error' in record ? [record.error] : []));
  if (failing.length === keeper.count) throw new Error(`no kept render browser opens: ${failing[0]}`);
  await sleep(BORROW_POLL_MS);
  return lockKeptSlot(dir);
}
